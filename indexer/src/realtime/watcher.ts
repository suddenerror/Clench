import { Connection, PublicKey } from "@solana/web3.js";
import { unpackAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { BalanceEventWriter } from "../ingest/types.js";

/// Реалтайм-версия батч-ingest'а Фазы 1 (§7, «Ingest worker»). Спека называет
/// Yellowstone gRPC/Helius — у нас нет Helius API-ключа в этом окружении, и
/// это не блокер: `onProgramAccountChange` над публичным RPC даёт тот же
/// поток (mint, owner, balance_after) с задержкой в доли секунды вместо
/// микросекунд у gRPC. Для MVP-нагрузки (не HFT) разница не критична;
/// переезд на Yellowstone, когда появится Helius-ключ, — замена только этого
/// файла, интерфейс BalanceEventWriter не меняется (см. Фазу 1.2 плана).
export class MintWatcher {
  private subscriptionIds = new Map<string, number>();

  constructor(
    private connection: Connection,
    private writer: BalanceEventWriter
  ) {}

  watch(mint: PublicKey): void {
    const key = mint.toBase58();
    if (this.subscriptionIds.has(key)) return;

    const id = this.connection.onProgramAccountChange(
      TOKEN_2022_PROGRAM_ID,
      async (info, context) => {
        try {
          const decoded = unpackAccount(info.accountId, info.accountInfo, TOKEN_2022_PROGRAM_ID);
          const slot = context.slot;
          await this.writer.write([
            {
              slot,
              blockTime: new Date(), // приближение — точный block_time потребовал бы доп. getBlock (Фаза 5.1 доработка)
              mint: decoded.mint.toBase58(),
              owner: decoded.owner.toBase58(),
              balance: decoded.amount,
            },
          ]);
        } catch (err) {
          console.error(`[watcher] failed to process update for mint ${key}`, err);
        }
      },
      { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] }
    );

    this.subscriptionIds.set(key, id);
    console.log(`[watcher] watching mint ${key}`);
  }

  async unwatchAll(): Promise<void> {
    for (const [key, id] of this.subscriptionIds) {
      await this.connection.removeProgramAccountChangeListener(id);
      this.subscriptionIds.delete(key);
    }
  }

  isWatching(mint: PublicKey): boolean {
    return this.subscriptionIds.has(mint.toBase58());
  }
}
