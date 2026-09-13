import { Connection } from "@solana/web3.js";
import { migrate } from "../src/db/pool.js";
import { ingestHistorical } from "../src/ingest/historical.js";
import { PgBalanceEventWriter } from "../src/ingest/writer.js";
import { runEpochAggregation } from "../src/aggregate/epoch.js";

const MINT = process.env.CALIBRATION_MINT ?? "3GeC4vdVVGuC64oyjQ3oPY7pp8GdAJj8yqovZ3dPpump";
const CREATED_UNIX = Number(process.env.CALIBRATION_CREATED_UNIX ?? 1779311314);
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

async function main() {
  await migrate();

  const connection = new Connection(RPC_URL, "confirmed");
  const writer = new PgBalanceEventWriter();

  console.log(`[calibration] ingesting ${MINT} since ${new Date(CREATED_UNIX * 1000).toISOString()}`);
  const { processedSignatures } = await ingestHistorical({
    mint: MINT,
    connection,
    writer,
    sinceUnixSeconds: CREATED_UNIX,
    onProgress: ({ processedSignatures, oldestBlockTime }) => {
      console.log(
        `[calibration] processed=${processedSignatures} oldest=${oldestBlockTime ? new Date(oldestBlockTime * 1000).toISOString() : "?"}`
      );
    }
  });
  console.log(`[calibration] ingest done, ${processedSignatures} signatures processed`);

  const epochStart0 = new Date(CREATED_UNIX * 1000);
  const ageDays = Math.ceil((Date.now() - epochStart0.getTime()) / 86_400_000);
  console.log(`[calibration] aggregating ${ageDays} daily epochs`);

  await runEpochAggregation({
    mint: MINT,
    epochStart0,
    epochDurationSeconds: 86_400,
    epochCount: ageDays
  });

  console.log("[calibration] aggregation done");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
