import { PublicKey } from "@solana/web3.js";
import { getPool } from "../db/pool.js";

// dust_tolerance_bps из Config (§5 спеки), 50 = 0.5%.
export const DUST_TOLERANCE_BPS = 50;

export interface EpochWindowRow {
  owner: Buffer;
  balanceOpen: bigint;
  balanceMin: bigint;
}

/**
 * "Ловушка открывающего баланса" (§7, дословно): держатель без событий внутри
 * окна получает баланс последнего события до начала окна. Общая для батча
 * (Фаза 1) и будущего реалтайм-агрегатора (Фаза 5) — интерфейс не меняется.
 */
export async function computeEpochWindow(mint: string, start: Date, end: Date): Promise<EpochWindowRow[]> {
  const mintBytes = Buffer.from(new PublicKey(mint).toBytes());
  const { rows } = await getPool().query(
    `WITH opening AS (
       SELECT DISTINCT ON (owner) owner, balance FROM balance_events
       WHERE mint = $1 AND block_time < $2 ORDER BY owner, block_time DESC, slot DESC),
     inside AS (
       SELECT owner, MIN(balance) lo FROM balance_events
       WHERE mint = $1 AND block_time >= $2 AND block_time < $3 GROUP BY owner)
     SELECT o.owner, o.balance AS balance_open,
            LEAST(o.balance, COALESCE(i.lo, o.balance)) AS balance_min
     FROM opening o LEFT JOIN inside i USING (owner)`,
    [mintBytes, start, end]
  );
  return rows.map((r) => ({
    owner: r.owner as Buffer,
    balanceOpen: BigInt(r.balance_open),
    balanceMin: BigInt(r.balance_min)
  }));
}

/** Правило стрика §2: продажа (падение ниже допуска) обнуляет, иначе +1. */
export function nextStreak(streakIn: number, balanceOpen: bigint, balanceMin: bigint): number {
  if (balanceOpen === 0n) return 0;
  // balanceMin >= balanceOpen * (1 - dust_tolerance_bps/10000)
  const threshold = (balanceOpen * BigInt(10_000 - DUST_TOLERANCE_BPS)) / 10_000n;
  return balanceMin >= threshold ? streakIn + 1 : 0;
}

export interface EpochRunOptions {
  mint: string;
  epochStart0: Date;
  epochDurationSeconds: number;
  epochCount: number;
}

/** Прогоняет посуточную агрегацию за epochCount эпох и пишет epoch_holders. */
export async function runEpochAggregation(opts: EpochRunOptions): Promise<void> {
  const { mint, epochStart0, epochDurationSeconds, epochCount } = opts;
  const mintBytes = Buffer.from(new PublicKey(mint).toBytes());
  const streakByOwner = new Map<string, number>();

  for (let i = 0; i < epochCount; i++) {
    const start = new Date(epochStart0.getTime() + i * epochDurationSeconds * 1000);
    const end = new Date(start.getTime() + epochDurationSeconds * 1000);
    const rows = await computeEpochWindow(mint, start, end);

    if (rows.length === 0) continue;

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) {
        const ownerKey = row.owner.toString("hex");
        const streakIn = streakByOwner.get(ownerKey) ?? 0;
        const streakOut = nextStreak(streakIn, row.balanceOpen, row.balanceMin);
        streakByOwner.set(ownerKey, streakOut);

        await client.query(
          `INSERT INTO epoch_holders
             (mint, owner, epoch_index, epoch_start, epoch_end, balance_open, balance_min, streak_in, streak_out)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (mint, owner, epoch_index) DO UPDATE SET
             balance_open = EXCLUDED.balance_open,
             balance_min = EXCLUDED.balance_min,
             streak_in = EXCLUDED.streak_in,
             streak_out = EXCLUDED.streak_out`,
          [mintBytes, row.owner, i, start, end, row.balanceOpen.toString(), row.balanceMin.toString(), streakIn, streakOut]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
