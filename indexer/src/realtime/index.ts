import { Connection } from "@solana/web3.js";
import { migrate } from "../db/pool.js";
import { PgBalanceEventWriter } from "../ingest/writer.js";
import { discoverLaunches } from "./discover.js";
import { MintWatcher } from "./watcher.js";
import { runEpochAggregation } from "../aggregate/epoch.js";
import { refreshFighterStats } from "../db/refresh.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const DISCOVER_INTERVAL_MS = Number(process.env.DISCOVER_INTERVAL_MS ?? 30_000);
const AGGREGATE_INTERVAL_MS = Number(process.env.AGGREGATE_INTERVAL_MS ?? 60_000);
const EPOCH_DURATION_SECONDS = Number(process.env.EPOCH_DURATION_SECONDS ?? 86_400);

async function main() {
  await migrate();
  const connection = new Connection(RPC_URL, "confirmed");
  const writer = new PgBalanceEventWriter();
  const watcher = new MintWatcher(connection, writer);

  const bornAtByMint = new Map<string, number>();

  const discoverTick = async () => {
    try {
      const launches = await discoverLaunches(connection);
      for (const l of launches) {
        bornAtByMint.set(l.mint.toBase58(), l.bornAt);
        if (!watcher.isWatching(l.mint)) watcher.watch(l.mint);
      }
      console.log(`[realtime] tracking ${bornAtByMint.size} launches`);
    } catch (err) {
      console.error("[realtime] discover failed", err);
    } finally {
      setTimeout(discoverTick, DISCOVER_INTERVAL_MS);
    }
  };

  // §8: materialized view fighter_stats — REFRESH по расписанию после
  // close_epoch. Точного event-хука на close_epoch у индексера нет (для
  // этого нужна была бы подписка на программные логи) — простое упрощение
  // Фазы 5: периодический refresh раз в AGGREGATE_INTERVAL_MS, достаточно
  // свежо для витрины, не идеально сразу-после-события.
  const aggregateTick = async () => {
    try {
      for (const [mintBase58, bornAt] of bornAtByMint) {
        const epochCount = Math.ceil((Date.now() / 1000 - bornAt) / EPOCH_DURATION_SECONDS) + 1;
        await runEpochAggregation({
          mint: mintBase58,
          epochStart0: new Date(bornAt * 1000),
          epochDurationSeconds: EPOCH_DURATION_SECONDS,
          epochCount,
        });
      }
      await refreshFighterStats();
    } catch (err) {
      console.error("[realtime] aggregate/refresh failed", err);
    } finally {
      setTimeout(aggregateTick, AGGREGATE_INTERVAL_MS);
    }
  };

  discoverTick();
  aggregateTick();

  process.on("SIGINT", async () => {
    await watcher.unwatchAll();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[realtime] fatal", err);
  process.exit(1);
});
