import Fastify from "fastify";
import { PublicKey } from "@solana/web3.js";
import { getPool } from "./db.js";
import { cached } from "./cache.js";

const app = Fastify({ logger: true });
const CACHE_TTL_MS = Number(process.env.API_CACHE_TTL_MS ?? 15_000);

app.get("/health", async () => ({ ok: true }));

function mintToBytes(mint: string): Buffer {
  return Buffer.from(new PublicKey(mint).toBytes());
}

/// Держатели последней (или указанной) эпохи монеты — витрина страницы
/// монеты (§8): личный блок холдера читает отсюда свою запись.
app.get<{ Params: { mint: string }; Querystring: { epoch?: string } }>(
  "/coins/:mint/holders",
  async (req) => {
    const mintBytes = mintToBytes(req.params.mint);
    return cached(`holders:${req.params.mint}:${req.query.epoch ?? "latest"}`, CACHE_TTL_MS, async () => {
      const db = getPool();
      let epochIdx: number;
      if (req.query.epoch) {
        epochIdx = Number(req.query.epoch);
      } else {
        const { rows } = await db.query(`SELECT MAX(epoch_index) AS m FROM epoch_holders WHERE mint = $1`, [mintBytes]);
        epochIdx = rows[0]?.m ?? -1;
      }
      if (epochIdx < 0) return { epoch: null, holders: [] };

      const { rows } = await db.query(
        `SELECT owner, balance_min, streak_out FROM epoch_holders
         WHERE mint = $1 AND epoch_index = $2 ORDER BY balance_min DESC`,
        [mintBytes, epochIdx]
      );
      return {
        epoch: epochIdx,
        holders: rows.map((r) => ({
          owner: new PublicKey(r.owner as Buffer).toBase58(),
          balanceMin: r.balance_min,
          streak: r.streak_out,
        })),
      };
    });
  }
);

/// Сводка по эпохам монеты — для графика/истории на странице монеты.
app.get<{ Params: { mint: string } }>("/coins/:mint/epochs", async (req) => {
  const mintBytes = mintToBytes(req.params.mint);
  return cached(`epochs:${req.params.mint}`, CACHE_TTL_MS, async () => {
    const { rows } = await getPool().query(
      `SELECT epoch_index, COUNT(*) AS holders, SUM(balance_min) AS total_balance
       FROM epoch_holders WHERE mint = $1 GROUP BY epoch_index ORDER BY epoch_index`,
      [mintBytes]
    );
    return { epochs: rows };
  });
});

/// §8 «Карточка бойца» — биография кошелька сквозь все монеты.
app.get<{ Params: { owner: string } }>("/fighters/:owner", async (req) => {
  return cached(`fighter:${req.params.owner}`, CACHE_TTL_MS, async () => {
    const ownerBytes = Buffer.from(new PublicKey(req.params.owner).toBytes());
    const { rows } = await getPool().query(`SELECT * FROM fighter_stats WHERE owner = $1`, [ownerBytes]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      owner: req.params.owner,
      coins: Number(r.coins),
      daysHeld: Number(r.days_held),
      bestStreak: Number(r.best_streak),
      breaks: Number(r.breaks),
      worstBreak: r.worst_break === null ? null : Number(r.worst_break),
    };
  });
});

/// §8 «Зал славы и позора»: длиннейшие живые холды слева, свежесломанные справа.
app.get("/hall-of-fame", async () => {
  return cached("hall-of-fame", CACHE_TTL_MS, async () => {
    const db = getPool();
    const { rows: fameRows } = await db.query(
      `SELECT owner, mint, streak_out FROM epoch_holders
       WHERE epoch_index = (SELECT MAX(epoch_index) FROM epoch_holders eh2 WHERE eh2.mint = epoch_holders.mint)
       AND streak_out > 0 ORDER BY streak_out DESC LIMIT 20`
    );
    const { rows: shameRows } = await db.query(
      `SELECT owner, mint, streak_in AS broken_streak FROM epoch_holders
       WHERE streak_in > 0 AND streak_out = 0 ORDER BY streak_in DESC LIMIT 20`
    );
    const fmt = (r: { owner: Buffer; mint: Buffer; streak_out?: number; broken_streak?: number }) => ({
      owner: new PublicKey(r.owner).toBase58(),
      mint: new PublicKey(r.mint).toBase58(),
      streak: r.streak_out ?? r.broken_streak,
    });
    return { fame: fameRows.map(fmt), shame: shameRows.map(fmt) };
  });
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
