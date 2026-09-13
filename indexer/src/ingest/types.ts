// Общий интерфейс агрегатора для батч-ingest (Фаза 1) и реалтайм-ingest (Фаза 5),
// чтобы не переписывать дважды (см. docs/CLENCH-BUILD-PLAN.md §1.2).
export interface BalanceEvent {
  slot: number;
  blockTime: Date;
  mint: string; // base58
  owner: string; // base58
  balance: bigint; // raw units, до decimals
}

export interface BalanceEventWriter {
  write(events: BalanceEvent[]): Promise<void>;
}
