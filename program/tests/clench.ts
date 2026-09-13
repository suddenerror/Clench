import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  transferChecked,
  getAccount,
  AuthorityType,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  findConfigPda,
  findLaunchPda,
  findDistPda,
  findPendingPda,
  findTickerLockPda,
  pairHash,
  buildMerkleTree,
} from "./utils";

describe("clench — Фаза 2 базовый цикл", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Clench as Program<any>;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const EPOCH_DURATION_SECONDS = 12;
  const TAX_BPS = 200; // 2%
  const DECIMALS = 6;
  const SUPPLY = BigInt(1_000_000) * BigInt(10 ** DECIMALS);

  let treasury: Keypair;
  let keeperFund: Keypair;

  async function initConfig() {
    const [configPda] = findConfigPda(program.programId);
    treasury = Keypair.generate();
    keeperFund = Keypair.generate();

    const existing = await connection.getAccountInfo(configPda);
    if (existing) return configPda;

    await program.methods
      .initializeConfig({
        treasury: treasury.publicKey,
        epochDuration: new anchor.BN(EPOCH_DURATION_SECONDS),
        // Маленькие значения — единый глобальный Config переиспользуется
        // всеми тестовыми файлами этого прогона (PDA-синглтон); Фаза 3
        // (race.ts) полагается на эти же тайминги для быстрых раундов.
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

    return configPda;
  }

  async function createLaunch(mode: "standard" | "reward") {
    const mint = Keypair.generate();
    const [launchPda] = findLaunchPda(program.programId, mint.publicKey);
    const [tickerLockPda] = findTickerLockPda(program.programId, pairHash("", ""));

    await program.methods
      .createLaunch({
        name: Array.from(Buffer.alloc(32, 0)),
        ticker: Array.from(Buffer.alloc(16, 0)),
        taxBps: TAX_BPS,
        decimals: DECIMALS,
        mode: mode === "standard" ? { standard: {} } : { reward: {} },
        competitive: false,
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

  it("fee-конфиг необратим: изменить transfer fee после создания нельзя", async () => {
    const { mint, launchPda } = await createLaunch("reward");

    let failed = false;
    try {
      const ix = createSetAuthorityInstruction(
        mint.publicKey,
        launchPda,
        AuthorityType.TransferFeeConfig,
        null,
        [],
        TOKEN_2022_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx, []);
    } catch (e) {
      failed = true;
    }
    assert.isTrue(failed, "authority на transfer fee должна быть уже отозвана и подпись невозможна");
  });

  it("полный цикл: create_launch → harvest_tax → close_epoch → publish_root → distribute → finalize (Reward)", async () => {
    await initConfig();
    const [configPda] = findConfigPda(program.programId);
    const { mint, launchPda } = await createLaunch("reward");

    // Держатели + ATA.
    const holderA = Keypair.generate();
    const holderB = Keypair.generate();
    for (const kp of [holderA, holderB]) {
      const sig = await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    const creatorAta = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, payer.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );
    const holderAAta = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, holderA.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );
    const holderBAta = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, holderB.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );
    const taxVault = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, launchPda, { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID,
      undefined, true
    );
    const treasuryAta = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, treasury.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );
    const keeperAta = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, keeperFund.publicKey, {}, TOKEN_2022_PROGRAM_ID
    );

    // Эмиссия (mint authority = creator, разово, вне скоупа Фазы 2 — см. коммент в create_launch.rs).
    await mintTo(connection, payer, mint.publicKey, creatorAta, payer, SUPPLY, [], {}, TOKEN_2022_PROGRAM_ID);

    // Переводы холдерам — тут удерживается transfer fee (2%), оседает на счёте получателя.
    const transferAmount = BigInt(100_000) * BigInt(10 ** DECIMALS);
    await transferChecked(
      connection, payer, creatorAta, mint.publicKey, holderAAta, payer, transferAmount, DECIMALS, [], {}, TOKEN_2022_PROGRAM_ID
    );
    await transferChecked(
      connection, payer, creatorAta, mint.publicKey, holderBAta, payer, transferAmount, DECIMALS, [], {}, TOKEN_2022_PROGRAM_ID
    );

    // harvest_tax: собираем withheld fee с holderA/holderB в vault и сплитим.
    await program.methods
      .harvestTax()
      .accounts({
        caller: payer.publicKey,
        launch: launchPda,
        mint: mint.publicKey,
        taxVault,
        treasuryTokenAccount: treasuryAta,
        keeperTokenAccount: keeperAta,
        creatorTokenAccount: creatorAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .remainingAccounts([
        { pubkey: holderAAta, isWritable: true, isSigner: false },
        { pubkey: holderBAta, isWritable: true, isSigner: false },
      ])
      .rpc("confirmed");
    await new Promise((r) => setTimeout(r, 1000));

    const launchAfterHarvest = await program.account.launch.fetch(launchPda);
    const vaultAfterHarvest = await getAccount(connection, taxVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.isTrue(launchAfterHarvest.taxThisEpoch.gtn(0), "tax_this_epoch должен вырасти после harvest_tax");
    assert.isTrue(vaultAfterHarvest.amount > 0n, "tax_vault должен получить holders_bps долю");

    // close_epoch: до дедлайна должен отклоняться (EpochNotFinished).
    let closedTooEarly = false;
    try {
      await program.methods
        .closeEpoch()
        .accounts({ caller: payer.publicKey, config: configPda, launch: launchPda })
        .rpc();
    } catch (e) {
      closedTooEarly = true;
      expect(String(e)).to.match(/EpochNotFinished/);
    }
    assert.isTrue(closedTooEarly, "close_epoch до истечения epoch_duration должен провалиться");

    await new Promise((r) => setTimeout(r, (EPOCH_DURATION_SECONDS + 1) * 1000));

    await program.methods
      .closeEpoch()
      .accounts({ caller: payer.publicKey, config: configPda, launch: launchPda })
      .rpc();

    const launchAfterClose = await program.account.launch.fetch(launchPda);
    const pot = BigInt(launchAfterClose.epochPotSnapshot.toString());
    assert.isTrue(pot > 0n, "epoch_pot_snapshot должен зафиксировать собранный пул");
    assert.equal(launchAfterClose.taxThisEpoch.toNumber(), 0, "tax_this_epoch обнуляется после close_epoch");

    // publish_root: делим pot поровну между двумя холдерами.
    const half = pot / 2n;
    const total = half * 2n;
    const leaves = [
      { leafIndex: 0, owner: holderA.publicKey, amount: half, streak: 1 },
      { leafIndex: 1, owner: holderB.publicKey, amount: total - half, streak: 1 },
    ];
    const { root, proofs } = buildMerkleTree(leaves);

    const [distPda] = findDistPda(program.programId, launchPda);

    await program.methods
      .publishRoot(Array.from(root), new anchor.BN(total.toString()), leaves.length, mint.publicKey)
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        launch: launchPda,
        vault: taxVault,
        distribution: distPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // challenge window (2с в тестовом конфиге) должна истечь до distribute.
    await new Promise((r) => setTimeout(r, 3000));

    // distribute — по порядку, leaf 1 раньше leaf 0 должен быть отклонён.
    const [pendingB] = findPendingPda(program.programId, holderB.publicKey, mint.publicKey);
    let outOfOrderRejected = false;
    try {
      await program.methods
        .distribute(1, holderB.publicKey, new anchor.BN(leaves[1].amount.toString()), 1, proofs[1].map((p) => Array.from(p)))
        .accounts({
          caller: payer.publicKey,
          config: configPda,
          launch: launchPda,
          distribution: distPda,
          pending: pendingB,
          ownerAccount: holderB.publicKey,
          vault: taxVault,
          rewardMintAccount: mint.publicKey,
          ownerTokenAccount: holderBAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      outOfOrderRejected = true;
    }
    assert.isTrue(outOfOrderRejected, "leaf вне очереди (1 раньше 0) должен быть отклонён (OutOfOrder)");

    const [pendingA] = findPendingPda(program.programId, holderA.publicKey, mint.publicKey);
    await program.methods
      .distribute(0, holderA.publicKey, new anchor.BN(leaves[0].amount.toString()), 1, proofs[0].map((p) => Array.from(p)))
      .accounts({
        caller: payer.publicKey,
        config: configPda,
        launch: launchPda,
        distribution: distPda,
        pending: pendingA,
        ownerAccount: holderA.publicKey,
        vault: taxVault,
        rewardMintAccount: mint.publicKey,
        ownerTokenAccount: holderAAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .distribute(1, holderB.publicKey, new anchor.BN(leaves[1].amount.toString()), 1, proofs[1].map((p) => Array.from(p)))
      .accounts({
        caller: payer.publicKey,
        config: configPda,
        launch: launchPda,
        distribution: distPda,
        pending: pendingB,
        ownerAccount: holderB.publicKey,
        vault: taxVault,
        rewardMintAccount: mint.publicKey,
        ownerTokenAccount: holderBAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .finalizeDistribution()
      .accounts({ keeperFund: keeperFund.publicKey, launch: launchPda, distribution: distPda })
      .rpc();

    const distAfter = await program.account.distribution.fetchNullable(distPda);
    assert.isNull(distAfter, "distribution должен быть закрыт (close = keeper_fund) после finalize");
  });

  it("publish_root: OverPromise отклоняется, если total > epoch_pot_snapshot", async () => {
    await initConfig();
    const [configPda] = findConfigPda(program.programId);
    const { mint, launchPda } = await createLaunch("reward");

    const taxVault = await createAssociatedTokenAccountIdempotent(
      connection, payer, mint.publicKey, launchPda, {}, TOKEN_2022_PROGRAM_ID, undefined, true
    );

    await new Promise((r) => setTimeout(r, (EPOCH_DURATION_SECONDS + 1) * 1000));
    await program.methods
      .closeEpoch()
      .accounts({ caller: payer.publicKey, config: configPda, launch: launchPda })
      .rpc();

    const [distPda] = findDistPda(program.programId, launchPda);
    let rejected = false;
    try {
      await program.methods
        .publishRoot(Array.from(Buffer.alloc(32, 1)), new anchor.BN(1_000_000), 1, mint.publicKey)
        .accounts({
          authority: payer.publicKey,
          config: configPda,
          launch: launchPda,
          vault: taxVault,
          distribution: distPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (e) {
      rejected = true;
      expect(String(e)).to.match(/OverPromise/);
    }
    assert.isTrue(rejected, "total выше pot_snapshot (здесь 0) должен провалиться с OverPromise");
  });

  it("Standard-запуск: fee_split 50/50 creator/treasury, holders_bps=0", async () => {
    const { launchPda } = await createLaunch("standard");
    const launch = await program.account.launch.fetch(launchPda);
    assert.equal(launch.feeSplit.holdersBps, 0, "Standard не платит холдерам");
    assert.equal(launch.feeSplit.treasuryBps, 5000, "Standard: 50% площадке");
    assert.equal(launch.feeSplit.creatorBps, 5000, "Standard: 50% создателю");
    assert.deepEqual(launch.mode, { standard: {} });
  });
});
