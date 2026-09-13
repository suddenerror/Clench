import { Connection, PublicKey, type ConfirmedSignatureInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { BalanceEvent, BalanceEventWriter } from "./types.js";

export interface HistoricalIngestOptions {
  mint: string;
  connection: Connection;
  writer: BalanceEventWriter;
  /** Не идти раньше этого unix-времени (секунды). Обычно — момент создания монеты. */
  sinceUnixSeconds?: number;
  /** Ограничение на число обработанных сигнатур — страховка от бесконечного прогона на паблик RPC. */
  maxSignatures?: number;
  onProgress?: (info: { processedSignatures: number; oldestBlockTime: number | null }) => void;
}

const PAGE_SIZE = 1000;
const RATE_LIMIT_DELAY_MS = 350;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 6): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts) throw err;
      const backoff = Math.min(30_000, 500 * 2 ** attempt);
      console.warn(`[historical] ${label} failed (attempt ${attempt}): ${(err as Error).message}. Retry in ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

/**
 * Разовый исторический батч-прогон для калибровки (Фаза 1). Идёт назад по сигнатурам
 * минта и извлекает (slot, mint, owner, balance_after) из pre/postTokenBalances —
 * без Yellowstone gRPC/Helius, только публичный RPC. Реалтайм-версия (Фаза 5)
 * переиспользует общий BalanceEventWriter, не эту функцию.
 */
export async function ingestHistorical(opts: HistoricalIngestOptions): Promise<{ processedSignatures: number }> {
  const { mint, connection, writer, sinceUnixSeconds, maxSignatures, onProgress } = opts;
  const mintKey = new PublicKey(mint);

  let before: string | undefined;
  let processedSignatures = 0;
  let oldestBlockTime: number | null = null;
  let reachedFloor = false;

  while (!reachedFloor) {
    const sigs: ConfirmedSignatureInfo[] = await withRetry(
      () => connection.getSignaturesForAddress(mintKey, { before, limit: PAGE_SIZE }),
      "getSignaturesForAddress"
    );
    await sleep(RATE_LIMIT_DELAY_MS);

    if (sigs.length === 0) break;

    for (const sig of sigs) {
      if (sig.blockTime && sinceUnixSeconds && sig.blockTime < sinceUnixSeconds) {
        reachedFloor = true;
        break;
      }

      const tx: ParsedTransactionWithMeta | null = await withRetry(
        () => connection.getParsedTransaction(sig.signature, { maxSupportedTransactionVersion: 0 }),
        `getParsedTransaction(${sig.signature})`
      );
      await sleep(RATE_LIMIT_DELAY_MS);

      processedSignatures += 1;
      if (sig.blockTime) oldestBlockTime = sig.blockTime;

      if (!tx || !tx.meta || tx.meta.err) continue;

      const post = tx.meta.postTokenBalances ?? [];
      const events: BalanceEvent[] = [];
      for (const balance of post) {
        if (balance.mint !== mint || !balance.owner) continue;
        events.push({
          slot: tx.slot,
          blockTime: new Date((tx.blockTime ?? sig.blockTime ?? 0) * 1000),
          mint,
          owner: balance.owner,
          balance: BigInt(balance.uiTokenAmount.amount)
        });
      }
      if (events.length > 0) await writer.write(events);

      if (maxSignatures && processedSignatures >= maxSignatures) {
        reachedFloor = true;
        break;
      }
    }

    onProgress?.({ processedSignatures, oldestBlockTime });

    before = sigs[sigs.length - 1]?.signature;
    if (sigs.length < PAGE_SIZE) break;
  }

  return { processedSignatures };
}
