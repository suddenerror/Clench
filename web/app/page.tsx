import Link from "next/link";
import { Header } from "@/components/Header";
import { fetchCoins, type CoinRow } from "@/lib/api";

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatBalance(raw: string): string {
  const n = Number(raw);
  if (n > 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n > 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString("en-US");
}

async function getCoins(): Promise<CoinRow[]> {
  try {
    const { coins } = await fetchCoins();
    return coins;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const coins = await getCoins();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-16 text-center">
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
            Hold longer, earn more.
          </h1>
          <p className="mt-4 text-sm uppercase tracking-[0.2em] text-ink/50">
            Win the ticker, keep it forever.
          </p>
        </div>

        {/* §8: приоритетный визуальный блок турнира появится, когда есть Race
            с данными — сейчас нет отдельного /races эндпоинта (Фаза 7.2 бэклог). */}

        <div className="mb-6 flex items-center gap-6 border-b border-white/10 pb-3 text-sm">
          <button className="text-ink">Heat</button>
          <button className="text-ink/40 hover:text-ink/70">Market Cap</button>
          <button className="text-ink/40 hover:text-ink/70">New</button>
        </div>

        {coins.length === 0 ? (
          <div className="rounded border border-white/10 bg-surface p-10 text-center text-ink/50">
            Нет данных с индексера (API недоступен или ещё не проиндексировал ни одной монеты).
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coins.map((coin) => (
              <Link
                key={coin.mint}
                href={`/coin/${coin.mint}`}
                className="rounded border border-white/10 bg-surface p-5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-ink/70">{short(coin.mint)}</span>
                  <span className="text-xs text-ink/40">epoch {coin.epoch}</span>
                </div>
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="tabular text-2xl font-semibold">{formatBalance(coin.totalBalance)}</span>
                  <span className="tabular text-sm text-ink/50">{coin.holders} holders</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
