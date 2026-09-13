import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  findConfigPda,
  findLaunchPda,
  findRacePda,
  findRoundResultPda,
  findRoundsWonPda,
  findTickerLockPda,
  tickerHash,
  pairHash,
  strToFixedBuffer,
} from "./utils";

describe("clench — Фаза 3 турнир и OG", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Clench as Program<any>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const [configPda] = findConfigPda(program.programId);

  async function ensureConfig() {
    const existing = await connection.getAccountInfo(configPda);
    if (existing) return;
    await program.methods
      .initializeConfig({
        treasury: Keypair.generate().publicKey,
        epochDuration: new anchor.BN(12),
        roundDuration: new anchor.BN(5),
        roundsInRace: 4,
        maxExtraRounds: 8,
        bankBps: 2000,
        roundJitter: new anchor.BN(2),
        walletVolumeCapBps: 500,
        churnWeightBps: 1000,
        wVolumeBps: 5000,
        wHoldersBps: 3000,
        wMcapBps: 2000,
        volumeFloor: new anchor.BN(0),
        ogVolumeFloor: new anchor.BN(0),
        ogHoldersFloor: 0,
        ogMcapFloor: new anchor.BN(0),
        multiplierStepBps: 1000,
        multiplierCapBps: 30000,
        ogMultiplierStepBps: 1500,
        ogMultiplierCapBps: 40000,
        prorataBps: 8000,
        dustToleranceBps: 50,
        minPayout: new anchor.BN(1000),
        challengeWindow: new anchor.BN(2),
      })
      .accounts({ authority: payer.publicKey, config: configPda, systemProgram: SystemProgram.programId })
      .rpc();
  }

  async function createCompetitiveLaunch(name: string, ticker: string) {
    const mint = Keypair.generate();
    const [launchPda] = findLaunchPda(program.programId, mint.publicKey);
    const pHash = pairHash(name, ticker);
    const [tickerLockPda] = findTickerLockPda(program.programId, pHash);

    await program.methods
      .createLaunch({
        name: Array.from(strToFixedBuffer(name, 32)),
        ticker: Array.from(strToFixedBuffer(ticker, 16)),
        taxBps: 200,
        decimals: 6,
        mode: { competitive: {} },
        competitive: true,
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

  it("турнир на 4 раунда без ничьей → settle_race → claim_og → og_barred у проигравшего → TickerLock блокирует новый турнир", async () => {
    await ensureConfig();

    // Один и тот же тикер у обеих монет — совпадение по ticker_hash.
    const ticker = "RACER";
    const { launchPda: launchA } = await createCompetitiveLaunch("Racer One", ticker);
    const { launchPda: launchB } = await createCompetitiveLaunch("Racer Two", ticker);

    const matchHash = tickerHash(ticker);
    const [racePda] = findRacePda(program.programId, matchHash);

    await program.methods
      .openRace(Array.from(matchHash))
      .accounts({
        caller: payer.publicKey,
        config: configPda,
        launchA,
        launchB,
        race: racePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let race = await program.account.race.fetch(racePda);
    assert.equal(race.currentRound, 1);
    assert.equal(race.claimantCount, 2);

    // launchA побеждает во всех 4 раундах — без ничьей.
    for (let round = 1; round <= 4; round++) {
      await program.methods
        .updateLeader(new anchor.BN(1000))
        .accounts({ caller: payer.publicKey, launch: launchA, race: racePda })
        .rpc();

      await new Promise((r) => setTimeout(r, 6000));

      const [roundResultPda] = findRoundResultPda(program.programId, racePda, round);
      const [roundsWonPda] = findRoundsWonPda(program.programId, racePda, launchA);

      await program.methods
        .closeRound()
        .accounts({
          caller: payer.publicKey,
          config: configPda,
          race: racePda,
          roundResult: roundResultPda,
          roundsWon: roundsWonPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    race = await program.account.race.fetch(racePda);
    assert.equal(race.overallRoundsWon, 4);
    assert.equal(race.runnerUpRoundsWon, 0);
    assert.equal(race.overallLeader.toString(), launchA.toString());

    const pHash = pairHash("Racer One", ticker);
    const [tickerLockPda] = findTickerLockPda(program.programId, pHash);

    await program.methods
      .settleRace(true)
      .accounts({
        caller: payer.publicKey,
        config: configPda,
        race: racePda,
        launchLeader: launchA,
        launchRunnerUp: launchB,
        tickerLock: tickerLockPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const launchAAfter = await program.account.launch.fetch(launchA);
    const launchBAfter = await program.account.launch.fetch(launchB);
    assert.isTrue(launchAAfter.isOg, "победитель должен получить плашку OG");
    assert.isTrue(launchBAfter.ogBarred, "проигравший должен быть навсегда отрезан от этой связки");

    const lock = await program.account.tickerLock.fetch(tickerLockPda);
    assert.equal(lock.ogLaunch.toString(), launchA.toString());

    // Третий запуск с той же связкой и включённым турниром — отклоняется.
    let rejected = false;
    try {
      await createCompetitiveLaunch("Racer One", ticker);
    } catch (e) {
      rejected = true;
      expect(String(e)).to.match(/TickerLocked/);
    }
    assert.isTrue(rejected, "занятая связка + явный запрос турнира должны провалиться");

    // Тот же запуск, но без турнира — проходит, competitive принудительно false.
    const mint3 = Keypair.generate();
    const [launch3Pda] = findLaunchPda(program.programId, mint3.publicKey);
    const [tickerLockPda3] = findTickerLockPda(program.programId, pairHash("Racer One", ticker));
    await program.methods
      .createLaunch({
        name: Array.from(strToFixedBuffer("Racer One", 32)),
        ticker: Array.from(strToFixedBuffer(ticker, 16)),
        taxBps: 200,
        decimals: 6,
        mode: { reward: {} },
        competitive: false,
        rewardAssets: [PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default],
        rewardWeights: [0, 0, 0, 0, 0],
      })
      .accounts({
        creator: payer.publicKey,
        mint: mint3.publicKey,
        launch: launch3Pda,
        tickerLockCheck: tickerLockPda3,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([mint3])
      .rpc();

    const launch3 = await program.account.launch.fetch(launch3Pda);
    assert.isFalse(launch3.competitive, "занятая связка с выключенным турниром — проходит, но competitive=false");
  });
});
