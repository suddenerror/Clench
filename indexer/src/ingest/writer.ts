import { PublicKey } from "@solana/web3.js";
import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import type { BalanceEvent, BalanceEventWriter } from "./types.js";

// Общий писатель balance_events: используется и историческим батчем (Фаза 1),
// и будущим реалтайм-ingest (Фаза 5) — один и тот же путь записи.
export class PgBalanceEventWriter implements BalanceEventWriter {
  async write(events: BalanceEvent[]): Promise<void> {
    if (events.length === 0) return;
    const client: PoolClient = await getPool().connect();
    try {
      await client.query("BEGIN");
      const values: unknown[] = [];
      const rows: string[] = [];
      events.forEach((e, i) => {
        const base = i * 5;
        rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
          e.slot,
          e.blockTime,
          Buffer.from(new PublicKey(e.mint).toBytes()),
          Buffer.from(new PublicKey(e.owner).toBytes()),
          e.balance.toString()
        );
      });
      await client.query(
        `INSERT INTO balance_events (slot, block_time, mint, owner, balance)
         VALUES ${rows.join(",")}
         ON CONFLICT (mint, owner, slot, block_time) DO UPDATE SET balance = EXCLUDED.balance`,
        values
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
