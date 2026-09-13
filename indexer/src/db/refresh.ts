import { getPool } from "./pool.js";

export async function refreshFighterStats(): Promise<void> {
  await getPool().query("REFRESH MATERIALIZED VIEW CONCURRENTLY fighter_stats");
}
