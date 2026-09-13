import type { Pool } from "pg";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { withRetry } from "../retry.js";
import { computeCompositeScore } from "../compositeScore.js";

/// §3.3 плана: update_leader — доверенный вход. Кипер считает composite_score
/// офчейн (индексер) и передаёт готовое число; программа лишь узду
/// правдоподобности (см. update_leader.rs), не пересчитывает сама.
export async function runUpdateLeader(ctx: { program: any; db: Pool; keeperPubkey: PublicKey }) {
  const races = await ctx.program.account.race.all();
  const allLaunches = await ctx.program.account.launch.all();

  for (const { publicKey: racePda, account: race } of races) {
    if (race.status.running === undefined && race.status.extended === undefined) continue;

    // В Фазе 3 нет ончейн-списка претендентов — фильтруем по launch.race
    // среди уже загруженных Launch-аккаунтов (кипер видит все Launch'и).
    const claimants = allLaunches.filter(
      ({ account }: any) => account.race && (account.race as PublicKey).toBase58() === racePda.toBase58()
    );

    for (const { publicKey: launchPda, account: launch } of claimants) {
      try {
        let dbScore = 0;
        try {
          dbScore = await computeCompositeScore(
            ctx.db,
            (launch.mint as PublicKey).toBuffer(),
            new Date(Number(race.roundStartedAt) * 1000),
            new Date(),
            1n
          );
        } catch {
          // Индексер мог ещё не проиндексировать этот минт (реалтайм-инжест —
          // Фаза 5) — не блокируем турнир, используем ончейн-фолбэк ниже.
        }
        // Фолбэк на ончейн-факт, когда индексер по этому минту пуст/недоступен:
        // lifetime_tax_collected растёт только от реальных сделок, так что
        // турнир двигается вперёд даже без работающего realtime-индексера.
        const scoreInt = Math.max(0, Math.floor(dbScore)) + Number(launch.lifetimeTaxCollected);

        await withRetry(
          () =>
            ctx.program.methods
              .updateLeader(new anchor.BN(scoreInt))
              .accounts({ caller: ctx.keeperPubkey, launch: launchPda, race: racePda })
              .rpc(),
          { label: `updateLeader(${launchPda.toBase58()})` }
        );
      } catch (err) {
        console.error(`[updateLeader] ${launchPda.toBase58()} failed`, err);
      }
    }
  }
}
