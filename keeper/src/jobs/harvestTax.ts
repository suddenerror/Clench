import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotent, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { withIdempotency, withRetry } from "../retry.js";
import { findConfigPda } from "../pda.js";

// Tx помещает ограниченное число аккаунтов — берём разумный потолок за один
// вызов; остаток withheld fee просто дождётся следующего тика (§4: harvest_tax
// каждые 5 минут — не разово, деградация не теряет деньги, только откладывает).
const MAX_SOURCE_ACCOUNTS_PER_CALL = 20;

export async function runHarvestTax(ctx: { connection: any; program: any; keeperPubkey: PublicKey }) {
  const configPda = findConfigPda(ctx.program.programId);
  const config = await ctx.program.account.config.fetch(configPda);
  const launches = await ctx.program.account.launch.all();

  for (const { publicKey: launchPda, account: launch } of launches) {
    const key = `harvestTax:${launchPda.toBase58()}`;
    await withIdempotency(key, async () => {
      try {
        const mint = launch.mint as PublicKey;

        const sourceAccounts = await ctx.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
          filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        });
        const remainingAccounts = sourceAccounts
          .slice(0, MAX_SOURCE_ACCOUNTS_PER_CALL)
          .map((a: { pubkey: PublicKey }) => ({ pubkey: a.pubkey, isWritable: true, isSigner: false }));

        if (remainingAccounts.length === 0) return; // никто ещё не торговал — нечего собирать

        const taxVault = await createAssociatedTokenAccountIdempotent(
          ctx.connection, (ctx.program.provider.wallet as any).payer, mint, launchPda,
          { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID, undefined, true
        );
        const treasuryAta = await createAssociatedTokenAccountIdempotent(
          ctx.connection, (ctx.program.provider.wallet as any).payer, mint, config.treasury,
          {}, TOKEN_2022_PROGRAM_ID
        );
        const keeperAta = await createAssociatedTokenAccountIdempotent(
          ctx.connection, (ctx.program.provider.wallet as any).payer, mint, ctx.keeperPubkey,
          {}, TOKEN_2022_PROGRAM_ID
        );
        const creatorAta = await createAssociatedTokenAccountIdempotent(
          ctx.connection, (ctx.program.provider.wallet as any).payer, mint, launch.creator,
          {}, TOKEN_2022_PROGRAM_ID
        );

        await withRetry(
          () =>
            ctx.program.methods
              .harvestTax()
              .accounts({
                caller: ctx.keeperPubkey,
                launch: launchPda,
                mint,
                taxVault,
                treasuryTokenAccount: treasuryAta,
                keeperTokenAccount: keeperAta,
                creatorTokenAccount: creatorAta,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
              })
              .remainingAccounts(remainingAccounts)
              .rpc(),
          { label: `harvestTax(${launchPda.toBase58()})` }
        );
      } catch (err) {
        console.error(`[harvestTax] ${launchPda.toBase58()} failed`, err);
      }
    });
  }
}
