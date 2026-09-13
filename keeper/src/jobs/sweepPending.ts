import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotent, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { withIdempotency, withRetry } from "../retry.js";

/// §5 sweep_pending: раз в сутки для Pending, переросших порог, но не
/// задетых обычной рассылкой (владелец больше нигде не участвует).
export async function runSweepPending(ctx: { program: any; keeperPubkey: PublicKey }) {
  const pendings = await ctx.program.account.pending.all();

  for (const { publicKey: pendingPda, account: pending } of pendings) {
    if (BigInt(pending.amount.toString()) === 0n) continue;

    const key = `sweepPending:${pendingPda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        const isNativeSol = (pending.rewardMint as PublicKey).equals(PublicKey.default);
        // Launch нужен как источник средств (authority) — ищем по всем
        // Launch'ам, у кого reward-поток совпадает; в этой фазе допущение:
        // один Pending всегда привязан к ОДНОМУ launch'у через reward_mint,
        // который совпадает с launch.mint (см. ограничение в distribute.ts).
        const launches = await ctx.program.account.launch.all();
        const launch = launches.find(({ account }: any) => (account.mint as PublicKey).equals(pending.rewardMint));
        if (!launch) return;

        const accounts: Record<string, unknown> = {
          caller: ctx.keeperPubkey,
          launch: launch.publicKey,
          pending: pendingPda,
          ownerAccount: pending.owner,
          systemProgram: SystemProgram.programId,
        };

        if (!isNativeSol) {
          const vault = await createAssociatedTokenAccountIdempotent(
            ctx.program.provider.connection, (ctx.program.provider.wallet as any).payer,
            pending.rewardMint as PublicKey, launch.publicKey, {}, TOKEN_2022_PROGRAM_ID, undefined, true
          );
          const ownerAta = await createAssociatedTokenAccountIdempotent(
            ctx.program.provider.connection, (ctx.program.provider.wallet as any).payer,
            pending.rewardMint as PublicKey, pending.owner as PublicKey, {}, TOKEN_2022_PROGRAM_ID
          );
          accounts.vault = vault;
          accounts.rewardMintAccount = pending.rewardMint;
          accounts.ownerTokenAccount = ownerAta;
          accounts.tokenProgram = TOKEN_2022_PROGRAM_ID;
        }

        await withRetry(() => ctx.program.methods.sweepPending().accounts(accounts).rpc(), {
          label: `sweepPending(${pendingPda.toBase58()})`,
          maxAttempts: 2,
        });
      } catch {
        // BelowThreshold — ожидаемый исход для большинства Pending, не ошибка.
      }
    });
  }
}
