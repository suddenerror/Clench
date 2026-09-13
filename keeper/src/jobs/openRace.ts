import { PublicKey, SystemProgram } from "@solana/web3.js";
import { withIdempotency, withRetry } from "../retry.js";
import { findConfigPda, findRacePda, tickerHashFromBytes, nameHashFromBytes } from "../pda.js";

/// §5: «open_race / join_race — permissionless, зовутся кипером автоматически».
/// Не в явном списке §4 плана, но прямо в спеке — без этого турниры никогда
/// не начнутся сами по себе, что противоречит цели автономности Фазы 4.
export async function runOpenRace(ctx: { program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const launches = await ctx.program.account.launch.all();
  const candidates = launches.filter(
    ({ account }: any) => account.competitive && !account.isOg && !account.ogBarred && !account.race
  );

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const tickerA = tickerHashFromBytes(a.account.ticker as Buffer);
      const tickerB = tickerHashFromBytes(b.account.ticker as Buffer);
      const nameA = nameHashFromBytes(a.account.name as Buffer);
      const nameB = nameHashFromBytes(b.account.name as Buffer);

      let matchHash: Buffer | null = null;
      if (tickerA.equals(tickerB)) matchHash = tickerA;
      else if (nameA.equals(nameB)) matchHash = nameA;
      if (!matchHash) continue;

      const racePda = findRacePda(ctx.program.programId, matchHash);
      const key = `openRace:${racePda.toBase58()}`;
      await withIdempotency(key, async () => {
        try {
          const existing = await ctx.program.provider.connection.getAccountInfo(racePda);
          if (existing) return;
          await withRetry(
            () =>
              ctx.program.methods
                .openRace(Array.from(matchHash!))
                .accounts({
                  caller: ctx.keeperPubkey,
                  config: configPda,
                  launchA: a.publicKey,
                  launchB: b.publicKey,
                  race: racePda,
                  systemProgram: SystemProgram.programId,
                })
                .rpc(),
            { label: `openRace(${racePda.toBase58()})`, maxAttempts: 2 }
          );
        } catch {
          // VolumeFloorNotCrossed и т.п. — обычный исход, не ошибка.
        }
      });
    }
  }
}
