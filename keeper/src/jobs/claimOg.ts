import { PublicKey, SystemProgram } from "@solana/web3.js";
import { withIdempotency, withRetry } from "../retry.js";
import { findConfigPda, findTickerLockPda, pairHashFromBytes } from "../pda.js";

/// §5: «проверяется кипером ежесуточно, пока связка свободна». floorsMet
/// здесь всегда true в Фазе 4 (нет офчейн-метрик holders/mcap в этой сборке
/// кипера) — задокументированное упрощение, тот же характер, что у
/// update_leader (см. README кипера).
export async function runClaimOg(ctx: { program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const launches = await ctx.program.account.launch.all();

  for (const { publicKey: launchPda, account: launch } of launches) {
    if (!launch.competitive || launch.isOg || launch.ogBarred || launch.race) continue;

    const key = `claimOg:${launchPda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        const pairHash = pairHashFromBytes(launch.name as Buffer, launch.ticker as Buffer);
        const tickerLockPda = findTickerLockPda(ctx.program.programId, pairHash);
        await withRetry(
          () =>
            ctx.program.methods
              .claimOg(true)
              .accounts({
                caller: ctx.keeperPubkey,
                config: configPda,
                launch: launchPda,
                tickerLock: tickerLockPda,
                systemProgram: SystemProgram.programId,
              })
              .rpc(),
          { label: `claimOg(${launchPda.toBase58()})`, maxAttempts: 2 }
        );
      } catch {
        // OgFloorNotCrossed — обычный, не ошибочный исход большинства попыток.
      }
    });
  }
}
