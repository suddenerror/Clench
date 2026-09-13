import { Header } from "@/components/Header";
import { CoinClient } from "./CoinClient";

export default async function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="mb-1 font-mono text-xs text-ink/40">{mint}</p>
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">Coin</h1>
        <CoinClient mint={mint} />
      </main>
    </>
  );
}
