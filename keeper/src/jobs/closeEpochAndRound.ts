import { PublicKey, SystemProgram } from "@solana/web3.js";
import { withIdempotency, withRetry } from "../retry.js";
import { findConfigPda, findRoundResultPda, findRoundsWonPda } from "../pda.js";

export async function runCloseEpoch(ctx: { program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const config = await ctx.program.account.config.fetch(configPda);
  const now = Math.floor(Date.now() / 1000);
  const launches = await ctx.program.account.launch.all();

  for (const { publicKey: launchPda, account: launch } of launches) {
    if (now < Number(launch.epochStartedAt) + Number(config.epochDuration)) continue;
    const key = `closeEpoch:${launchPda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        await withRetry(
          () =>
            ctx.program.methods
              .closeEpoch()
              .accounts({ caller: ctx.keeperPubkey, config: configPda, launch: launchPda })
              .rpc(),
          { label: `closeEpoch(${launchPda.toBase58()})` }
        );
      } catch (err) {
        console.error(`[closeEpoch] ${launchPda.toBase58()} failed`, err);
      }
    });
  }
}

// §3: джиттер закрытия раунда (±15 минут) живёт на цепи (close_round сам
// назначает следующий round_ends_at со свежим джиттером) — кипер просто
// зовёт close_round, как только now >= round_ends_at, не решая момент сам.
export async function runCloseRound(ctx: { program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const now = Math.floor(Date.now() / 1000);
  const races = await ctx.program.account.race.all();

  for (const { publicKey: racePda, account: race } of races) {
    if (race.status.running === undefined && race.status.extended === undefined) continue; // Settled/Void
    if (now < Number(race.roundEndsAt)) continue;

    const key = `closeRound:${racePda.toBase58()}:${race.currentRound}`;
    await withIdempotency(key, async () => {
      try {
        const roundResultPda = findRoundResultPda(ctx.program.programId, racePda, race.currentRound);
        const roundsWonPda = findRoundsWonPda(ctx.program.programId, racePda, race.leader as PublicKey);
        await withRetry(
          () =>
            ctx.program.methods
              .closeRound()
              .accounts({
                caller: ctx.keeperPubkey,
                config: configPda,
                race: racePda,
                roundResult: roundResultPda,
                roundsWon: roundsWonPda,
                systemProgram: SystemProgram.programId,
              })
              .rpc(),
          { label: `closeRound(${racePda.toBase58()}, round ${race.currentRound})` }
        );
      } catch (err) {
        console.error(`[closeRound] ${racePda.toBase58()} failed`, err);
      }
    });
  }
}
