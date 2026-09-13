"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchHolders, fetchEpochs, type HolderRow, type EpochSummary } from "@/lib/api";
import { multiplier, daysToCap } from "@/lib/multiplier";

export function CoinClient({ mint }: { mint: string }) {
  const { publicKey } = useWallet();
  const [holders, setHolders] = useState<HolderRow[] | null>(null);
  const [epochs, setEpochs] = useState<EpochSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHolders(mint)
      .then((r) => setHolders(r.holders))
      .catch(() => setError("Индексер недоступен"));
    fetchEpochs(mint)
      .then((r) => setEpochs(r.epochs))
      .catch(() => {});
  }, [mint]);

  const me = publicKey && holders ? holders.find((h) => h.owner === publicKey.toBase58()) : undefined;

  return (
    <div className="space-y-8">
      {/* Личный блок холдера — заметнее всего на странице (§8). */}
      <div className="rounded border border-white/10 bg-surface p-6">
        {!publicKey ? (
          <p className="text-sm text-ink/50">Подключите кошелёк, чтобы увидеть свой множитель.</p>
        ) : error ? (
          <p className="text-sm text-ink/50">{error}</p>
        ) : !me ? (
          <p className="text-sm text-ink/50">Вы пока не держите эту монету в последней эпохе.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink/60">Ваш холд</span>
              <span className="tabular text-sm text-ink/60">{me.streak} дней</span>
              <span className="tabular text-2xl font-semibold text-gold">
                ×{multiplier(me.streak, false).toFixed(1)}
              </span>
            </div>
            <div className="mt-4 h-1 w-full overflow-hidden rounded-none bg-white/10">
              <div
                className="score-bar-fill h-full bg-gold"
                style={{ width: `${Math.min(100, (me.streak / 20) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ink/40">
              {daysToCap(me.streak, false) > 0
                ? `до ×3.0: ${daysToCap(me.streak, false)} дней`
                : "потолок достигнут"}
            </p>
            <p className="mt-6 text-sm leading-relaxed text-ink/70">
              80% выплаты вы получаете всегда. Продажа отнимет надбавку с
              остальных 20% и вернёт множитель к ×1.0.
            </p>
          </>
        )}
      </div>

      {/* История эпох вместо графика/клейма — «лента выплат» (§8). */}
      <div>
        <h2 className="mb-3 text-sm text-ink/60">История эпох</h2>
        {!epochs || epochs.length === 0 ? (
          <p className="text-sm text-ink/40">Пока нет данных.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-ink/50">
                  <th className="px-4 py-2 font-normal">Эпоха</th>
                  <th className="px-4 py-2 font-normal">Держателей</th>
                  <th className="px-4 py-2 font-normal">Баланс</th>
                </tr>
              </thead>
              <tbody>
                {epochs
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((e) => (
                    <tr key={e.epoch_index} className="border-b border-white/5 last:border-0">
                      <td className="tabular px-4 py-2">{e.epoch_index}</td>
                      <td className="tabular px-4 py-2">{e.holders}</td>
                      <td className="tabular px-4 py-2">{Number(e.total_balance).toLocaleString("en-US")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
