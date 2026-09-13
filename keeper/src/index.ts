import pg from "pg";
import { config } from "./config.js";
import { buildProgram } from "./client.js";
import { runHarvestTax } from "./jobs/harvestTax.js";
import { runCloseEpoch, runCloseRound } from "./jobs/closeEpochAndRound.js";
import { runUpdateLeader } from "./jobs/updateLeader.js";
import { runSettleRace } from "./jobs/settleRace.js";
import { runOpenRace } from "./jobs/openRace.js";
import { runClaimOg } from "./jobs/claimOg.js";
import { runPublishRoot, runDistribute } from "./jobs/distribute.js";
import { runSweepPending } from "./jobs/sweepPending.js";

const { Pool } = pg;

function loop(name: string, intervalMs: number, fn: () => Promise<void>) {
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[${name}] unhandled error`, err);
    } finally {
      setTimeout(tick, intervalMs);
    }
  };
  tick();
}

async function main() {
  const { program, keypair } = buildProgram();
  const db = new Pool({ connectionString: config.databaseUrl });
  const keeperPubkey = keypair.publicKey;

  console.log(`[keeper] starting, keeper=${keeperPubkey.toBase58()}, program=${program.programId.toBase58()}`);

  // §4: каждые 5 минут — harvest_tax по всем живым Launch.
  loop("harvestTax", config.harvestTaxIntervalMs, () => runHarvestTax({ connection: program.provider.connection, program, keeperPubkey }));

  // Таймеры эпохи/раунда — проверяются чаще, чем сами длительности, чтобы не
  // проспать закрытие (джиттер уже на цепи, см. close_round.rs).
  loop("closeEpoch", config.epochRoundCheckIntervalMs, () => runCloseEpoch({ program, keeperPubkey }));
  loop("closeRound", config.epochRoundCheckIntervalMs, () => runCloseRound({ program, keeperPubkey }));
  loop("settleRace", config.epochRoundCheckIntervalMs, () => runSettleRace({ program, keeperPubkey }));
  loop("openRace", config.epochRoundCheckIntervalMs, () => runOpenRace({ program, keeperPubkey }));

  loop("updateLeader", config.updateLeaderIntervalMs, () => runUpdateLeader({ program, db, keeperPubkey }));
  loop("claimOg", config.claimOgIntervalMs, () => runClaimOg({ program, keeperPubkey }));

  loop("publishRoot", config.distributeIntervalMs, () => runPublishRoot({ program, db, keeperPubkey }));
  loop("distribute", config.distributeIntervalMs, () => runDistribute({ program, keeperPubkey }));

  loop("sweepPending", config.sweepPendingIntervalMs, () => runSweepPending({ program, keeperPubkey }));

  process.on("SIGINT", async () => {
    console.log("[keeper] shutting down");
    await db.end();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[keeper] fatal", err);
  process.exit(1);
});
