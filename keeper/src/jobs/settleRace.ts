import { PublicKey, SystemProgram } from "@solana/web3.js";
import { withIdempotency, withRetry } from "../retry.js";
import { findConfigPda, findTickerLockPda, pairHashFromBytes } from "../pda.js";

/// Не входит явно в список §4, но необходим, чтобы турнир доходил до конца
/// автономно (DoD Фазы 4 требует полного цикла «включая один турнир» без
/// единого ручного вызова) — вызывается после close_round, когда race
/// добралась до целевого числа раундов.
export async function runSettleRace(ctx: { program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const races = await ctx.program.account.race.all();

  for (const { publicKey: racePda, account: race } of races) {
    if (race.status.running === undefined) continue; // только Running можно settle

    const config = await ctx.program.account.config.fetch(configPda);
    const targetRounds = config.roundsInRace + race.extraRoundsUsed;
    if (race.currentRound !== targetRounds) continue;

    const now = Math.floor(Date.now() / 1000);
    if (now < Number(race.roundEndsAt)) continue;

    const leader = race.overallLeader as PublicKey;
    let runnerUp = race.runnerUp as PublicKey;
    if (runnerUp.equals(PublicKey.default)) {
      const launches = await ctx.program.account.launch.all();
      const other = launches.find(
        ({ publicKey, account }: any) =>
          account.race && (account.race as PublicKey).toBase58() === racePda.toBase58() && !publicKey.equals(leader)
      );
      if (!other) continue;
      runnerUp = other.publicKey;
    }

    const key = `settleRace:${racePda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        const leaderLaunch = await ctx.program.account.launch.fetch(leader);
        const pairHash = pairHashFromBytes(leaderLaunch.name as Buffer, leaderLaunch.ticker as Buffer);
        const tickerLockPda = findTickerLockPda(ctx.program.programId, pairHash);

        await withRetry(
          () =>
            ctx.program.methods
              .settleRace(true)
              .accounts({
                caller: ctx.keeperPubkey,
                config: configPda,
                race: racePda,
                launchLeader: leader,
                launchRunnerUp: runnerUp,
                tickerLock: tickerLockPda,
                systemProgram: SystemProgram.programId,
              })
              .rpc(),
          { label: `settleRace(${racePda.toBase58()})` }
        );
      } catch (err) {
        console.error(`[settleRace] ${racePda.toBase58()} failed`, err);
      }
    });
  }
}
