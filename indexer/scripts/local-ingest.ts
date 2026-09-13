import { Connection } from "@solana/web3.js";
import { migrate } from "../src/db/pool.js";
import { ingestHistorical } from "../src/ingest/historical.js";
import { PgBalanceEventWriter } from "../src/ingest/writer.js";
import { runEpochAggregation } from "../src/aggregate/epoch.js";

// Разовый инструмент для Фазы 4 демо: реалтайм-индексер (Фаза 5) ещё не
// существует, а keeper'у нужны epoch_holders, чтобы publish_root мог
// построить дерево. Это НЕ замена Фазе 5 — тот же батч-путь, что и Фаза 1
// калибровка, но нацеленный на localnet вместо mainnet.
const MINT = process.argv[2];
const CREATED_UNIX = Number(process.argv[3]);
const EPOCH_DURATION = Number(process.argv[4] ?? 15);

async function main() {
  await migrate();
  const connection = new Connection(process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
  const writer = new PgBalanceEventWriter();
  const { processedSignatures } = await ingestHistorical({ mint: MINT, connection, writer, sinceUnixSeconds: CREATED_UNIX });
  console.log("processed", processedSignatures, "signatures");

  const epochCount = Math.ceil((Date.now() / 1000 - CREATED_UNIX) / EPOCH_DURATION) + 1;
  await runEpochAggregation({
    mint: MINT,
    epochStart0: new Date(CREATED_UNIX * 1000),
    epochDurationSeconds: EPOCH_DURATION,
    epochCount,
  });
  console.log("aggregation done");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
