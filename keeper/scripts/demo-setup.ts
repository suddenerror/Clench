// Разовая настройка для демонстрации Фазы 4: создаёт Config (ускоренные
// тайминги), один Reward-запуск с реальными переводами (генерируют tax),
// и два Competitive-запуска с одинаковым тикером (турнир). Дальше кипер
// должен провести всё это через полный жизненный цикл САМ, без единого
// ручного вызова инструкций протокола отсюда.
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  transferChecked,
} from "@solana/spl-token";
import { buildProgram } from "../src/client.js";
import { findConfigPda, findLaunchPda, findTickerLockPda, pairHashFromBytes } from "../src/pda.js";

function strToFixedBuffer(s: string, len: number): Buffer {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, "utf-8").copy(buf);
  return buf;
}

async function main() {
  const { program, provider, keypair } = buildProgram();
  const connection = provider.connection;
  const payer = keypair;

  const configPda = findConfigPda(program.programId);
  const existingConfig = await connection.getAccountInfo(configPda);
  if (!existingConfig) {
    await program.methods
      .initializeConfig({
        treasury: Keypair.generate().publicKey,
        epochDuration: new anchor.BN(15),
        roundDuration: new anchor.BN(10),
        roundsInRace: 4,
        maxExtraRounds: 8,
        bankBps: 2000,
        roundJitter: new anchor.BN(2),
        walletVolumeCapBps: 500,
        churnWeightBps: 1000,
        wVolumeBps: 5000,
        wHoldersBps: 3000,
        wMcapBps: 2000,
        // og_volume_floor намеренно ощутимо выше volume_floor (§3: пороги —
        // главный параметр, ставить с запасом вверх) — иначе claim_og может
        // выиграть гонку у open_race до того, как тот успеет сработать,
        // как и произошло в первом прогоне этого демо (см. keeper README).
        volumeFloor: new anchor.BN(0),
        ogVolumeFloor: new anchor.BN(1_000_000_000),
        ogHoldersFloor: 0,
        ogMcapFloor: new anchor.BN(0),
        multiplierStepBps: 1000,
        multiplierCapBps: 30000,
        ogMultiplierStepBps: 1500,
        ogMultiplierCapBps: 40000,
        prorataBps: 8000,
        dustToleranceBps: 50,
        minPayout: new anchor.BN(1000),
        challengeWindow: new anchor.BN(5),
      })
      .accounts({ authority: payer.publicKey, config: configPda, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("[setup] config initialized (accelerated timers)");
  } else {
    console.log("[setup] config already exists, reusing");
  }

  async function createLaunch(name: string, ticker: string, competitive: boolean) {
    const mint = Keypair.generate();
    const launchPda = findLaunchPda(program.programId, mint.publicKey);
    const pairHash = pairHashFromBytes(strToFixedBuffer(name, 32), strToFixedBuffer(ticker, 16));
    const tickerLockPda = findTickerLockPda(program.programId, pairHash);

    await program.methods
      .createLaunch({
        name: Array.from(strToFixedBuffer(name, 32)),
        ticker: Array.from(strToFixedBuffer(ticker, 16)),
        taxBps: 200,
        decimals: 6,
        mode: competitive ? { competitive: {} } : { reward: {} },
        competitive,
        rewardAssets: [PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default],
        rewardWeights: [0, 0, 0, 0, 0],
      })
      .accounts({
        creator: payer.publicKey,
        mint: mint.publicKey,
        launch: launchPda,
        tickerLockCheck: tickerLockPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([mint])
      .rpc();

    return { mint, launchPda };
  }

  // Reward-запуск + реальные переводы, чтобы harvest_tax'у было что собирать.
  const { mint: rewardMint } = await createLaunch("Demo Reward", "DEMOR", false);
  const creatorAta = await createAssociatedTokenAccountIdempotent(
    connection, payer, rewardMint.publicKey, payer.publicKey, {}, TOKEN_2022_PROGRAM_ID
  );
  await mintTo(connection, payer, rewardMint.publicKey, creatorAta, payer, BigInt(1_000_000) * BigInt(10 ** 6), [], {}, TOKEN_2022_PROGRAM_ID);

  const holders: Keypair[] = [];
  for (let i = 0; i < 3; i++) {
    const holder = Keypair.generate();
    const sig = await connection.requestAirdrop(holder.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    const ata = await createAssociatedTokenAccountIdempotent(
      connection, payer, rewardMint.publicKey, holder.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );
    await transferChecked(
      connection, payer, creatorAta, rewardMint.publicKey, ata, payer,
      BigInt(50_000) * BigInt(10 ** 6), 6, [], {}, TOKEN_2022_PROGRAM_ID
    );
    holders.push(holder);
  }
  console.log(`[setup] reward launch ${rewardMint.publicKey.toBase58()} funded, 3 holders traded (tax generated)`);

  // Два Competitive-запуска с одинаковым тикером — турнир. У A есть реальные
  // сделки (лидирует по lifetime_tax_collected — ончейн-фолбэк update_leader,
  // см. keeper/src/jobs/updateLeader.ts), у B — нет: детерминированный исход
  // без ручных вызовов update_leader/close_round/settle_race отсюда.
  const { mint: raceMintA, launchPda: raceLaunchA } = await createLaunch("Demo Racer A", "DEMOX", true);
  const { launchPda: raceLaunchB } = await createLaunch("Demo Racer B", "DEMOX", true);

  const raceCreatorAtaA = await createAssociatedTokenAccountIdempotent(
    connection, payer, raceMintA.publicKey, payer.publicKey, {}, TOKEN_2022_PROGRAM_ID
  );
  await mintTo(connection, payer, raceMintA.publicKey, raceCreatorAtaA, payer, BigInt(1_000_000) * BigInt(10 ** 6), [], {}, TOKEN_2022_PROGRAM_ID);
  const raceHolderA = Keypair.generate();
  const raceHolderAtaA = await createAssociatedTokenAccountIdempotent(
    connection, payer, raceMintA.publicKey, raceHolderA.publicKey, {}, TOKEN_2022_PROGRAM_ID
  );
  await transferChecked(
    connection, payer, raceCreatorAtaA, raceMintA.publicKey, raceHolderAtaA, payer,
    BigInt(200_000) * BigInt(10 ** 6), 6, [], {}, TOKEN_2022_PROGRAM_ID
  );

  console.log(`[setup] competitive launches ${raceLaunchA.toBase58()} vs ${raceLaunchB.toBase58()} (ticker DEMOX)`);

  console.log("[setup] done — hand off to keeper, no more manual protocol calls from here");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
