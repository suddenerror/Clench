import type { Pool } from "pg";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotent, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { withIdempotency, withRetry } from "../retry.js";
import { alertCritical } from "../alert.js";
import { findConfigPda, findDistPda, findPendingPda } from "../pda.js";
import { buildEpochTree, type BuiltTree } from "../merkleLeaves.js";

// Кэш дерева между publish_root и distribute — в проде стоило бы класть в БД
// (переживает рестарт кипера), здесь in-memory ради простоты Фазы 4;
// см. docs/CLENCH-BUILD-PLAN.md Фаза 4 (бэклог).
const treeCache = new Map<string, BuiltTree>();

export async function runPublishRoot(ctx: { program: any; db: Pool; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const launches = await ctx.program.account.launch.all();

  for (const { publicKey: launchPda, account: launch } of launches) {
    const pot = BigInt(launch.epochPotSnapshot.toString());
    if (pot === 0n) continue;

    const distPda = findDistPda(ctx.program.programId, launchPda);
    const existing = await ctx.program.provider.connection.getAccountInfo(distPda);
    if (existing) continue; // уже опубликовано, ждём challenge window / рассылки

    const key = `publishRoot:${launchPda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        const mint = launch.mint as PublicKey;
        const tree = await buildEpochTree(ctx.db, mint.toBuffer(), pot);
        if (!tree) return;

        const total = tree.leaves.reduce((s, l) => s + l.amount, 0n);
        const vault = await createAssociatedTokenAccountIdempotent(
          ctx.program.provider.connection, (ctx.program.provider.wallet as any).payer, mint, launchPda,
          {}, TOKEN_2022_PROGRAM_ID, undefined, true
        );

        await withRetry(
          () =>
            ctx.program.methods
              .publishRoot(Array.from(tree.root), new anchor.BN(total.toString()), tree.leaves.length, mint)
              .accounts({
                authority: ctx.keeperPubkey,
                config: configPda,
                launch: launchPda,
                vault,
                distribution: distPda,
                systemProgram: SystemProgram.programId,
              })
              .rpc(),
          { label: `publishRoot(${launchPda.toBase58()})` }
        );

        treeCache.set(distPda.toBase58(), tree);
      } catch (err) {
        const msg = String(err);
        if (msg.includes("OverPromise") || msg.includes("Underfunded")) {
          await alertCritical("publish_root rejected — invariant violated", { launch: launchPda.toBase58(), err: msg });
        } else {
          console.error(`[publishRoot] ${launchPda.toBase58()} failed`, err);
        }
      }
    });
  }
}

export async function runDistribute(ctx: { program: any; keeperPubkey: PublicKey }) {
  const distributions = await ctx.program.account.distribution.all();

  for (const { publicKey: distPda, account: dist } of distributions) {
    if (dist.finished) continue;
    const tree = treeCache.get(distPda.toBase58());
    if (!tree) continue; // дерево из другого процесса/рестарта — Фаза 5 закроет персистентностью

    const launchPda = dist.source as PublicKey;

    // Challenge window — час на пересчёт извне (§4/§6), не раздаём раньше.
    // Публикация произошла в этом же тике или раньше; для простоты Фазы 4
    // используем момент появления в кэше как proxy на publish_root time.
    const key = `distribute:${distPda.toBase58()}`;
    await withIdempotency(key, async () => {
      const cursor = dist.cursor as number;
      for (let i = cursor; i < tree.leaves.length; i++) {
        const leaf = tree.leaves[i];
        const pendingPda = findPendingPda(ctx.program.programId, leaf.owner, dist.rewardMint as PublicKey);
        const ownerAta = await createAssociatedTokenAccountIdempotent(
          ctx.program.provider.connection, (ctx.program.provider.wallet as any).payer,
          dist.rewardMint as PublicKey, leaf.owner, {}, TOKEN_2022_PROGRAM_ID
        );
        const vault = await createAssociatedTokenAccountIdempotent(
          ctx.program.provider.connection, (ctx.program.provider.wallet as any).payer,
          dist.rewardMint as PublicKey, launchPda, {}, TOKEN_2022_PROGRAM_ID, undefined, true
        );

        try {
          await withRetry(
            () =>
              ctx.program.methods
                .distribute(
                  leaf.leafIndex,
                  leaf.owner,
                  new anchor.BN(leaf.amount.toString()),
                  leaf.streak,
                  tree.proofs[i].map((p) => Array.from(p))
                )
                .accounts({
                  caller: ctx.keeperPubkey,
                  launch: launchPda,
                  distribution: distPda,
                  pending: pendingPda,
                  ownerAccount: leaf.owner,
                  vault,
                  rewardMintAccount: dist.rewardMint,
                  ownerTokenAccount: ownerAta,
                  tokenProgram: TOKEN_2022_PROGRAM_ID,
                  systemProgram: SystemProgram.programId,
                })
                .rpc(),
            { label: `distribute(${distPda.toBase58()}, leaf ${i})` }
          );
        } catch (err) {
          console.error(`[distribute] ${distPda.toBase58()} leaf ${i} failed`, err);
          return; // не продолжаем — leaf_index должен идти строго по порядку
        }
      }

      try {
        await ctx.program.methods
          .finalizeDistribution()
          .accounts({ keeperFund: ctx.keeperPubkey, launch: launchPda, distribution: distPda })
          .rpc();
        treeCache.delete(distPda.toBase58());
      } catch (err) {
        console.error(`[finalizeDistribution] ${distPda.toBase58()} failed`, err);
      }
    });
  }
}
