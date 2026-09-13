"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Header } from "@/components/Header";
import { buildBrowserProgram, findLaunchPda, findTickerLockPda } from "@/lib/program";
import { pairHash, strToFixedBuffer } from "@/lib/hashing";

type Mode = "standard" | "reward" | "competitive";

export default function CreatePage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const router = useRouter();

  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [mode, setMode] = useState<Mode>("reward");
  const [taxBps, setTaxBps] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!wallet.publicKey) {
      setError("Подключите кошелёк");
      return;
    }
    if (!name.trim() || !ticker.trim()) {
      setError("Название и тикер обязательны");
      return;
    }

    setBusy(true);
    try {
      const program = buildBrowserProgram(connection, wallet);
      const mint = Keypair.generate();
      const launchPda = findLaunchPda(program.programId, mint.publicKey);
      const lockPda = findTickerLockPda(program.programId, pairHash(name, ticker));

      const modeArg = mode === "standard" ? { standard: {} } : mode === "reward" ? { reward: {} } : { competitive: {} };

      await program.methods
        .createLaunch({
          name: Array.from(strToFixedBuffer(name, 32)),
          ticker: Array.from(strToFixedBuffer(ticker, 16)),
          taxBps,
          decimals: 6,
          mode: modeArg,
          competitive: mode === "competitive",
          rewardAssets: [PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default, PublicKey.default],
          rewardWeights: [0, 0, 0, 0, 0],
        })
        .accounts({
          creator: wallet.publicKey,
          mint: mint.publicKey,
          launch: launchPda,
          tickerLockCheck: lockPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([mint])
        .rpc();

      router.push(`/coin/${mint.publicKey.toBase58()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">Create a launch</h1>

        <div className="space-y-6">
          <div>
            <label className="mb-1 block text-sm text-ink/60">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-white/10 bg-surface px-3 py-2 outline-none focus:border-white/30"
              placeholder="Pepe the Frog"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-ink/60">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-full rounded border border-white/10 bg-surface px-3 py-2 outline-none focus:border-white/30"
              placeholder="PEPE"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-ink/60">Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {(["standard", "reward", "competitive"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded border px-3 py-2 text-sm capitalize ${
                    mode === m ? "border-white/40 bg-white/5" : "border-white/10 text-ink/50"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink/40">
              {mode === "standard" && "Комиссия делится 50/50 между вами и площадкой. Холдерам не платится ничего."}
              {mode === "reward" && "Налог идёт холдерам с множителем за холд. Вы не получаете ничего."}
              {mode === "competitive" && "То же, что Reward, плюс участие в борьбе за плашку OG, если кто-то зайдёт на тот же тикер/название."}
            </p>
          </div>

          <div>
            <label className="mb-1 flex items-center justify-between text-sm text-ink/60">
              <span>Tax rate</span>
              <span className="tabular text-ink">{(taxBps / 100).toFixed(1)}%</span>
            </label>
            <input
              type="range"
              min={100}
              max={300}
              step={10}
              value={taxBps}
              onChange={(e) => setTaxBps(Number(e.target.value))}
              className="w-full accent-gold"
            />
            {taxBps > 100 && (
              <p className="mt-2 rounded border border-side-orange/30 bg-side-orange/5 p-3 text-xs leading-relaxed text-ink/70">
                Ставка выше 1% снижает оборот (арбитражники обходят такие токены,
                агрегаторы роутят их в последнюю очередь), а выплаты зависят от
                оборота. Жадная ставка чаще даёт меньше в абсолюте.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-side-orange">{error}</p>}

          <button
            onClick={onSubmit}
            disabled={busy || !wallet.publicKey}
            className="w-full rounded bg-gold py-3 font-medium text-graphite disabled:opacity-40"
          >
            {busy ? "Deploying…" : wallet.publicKey ? "Create launch" : "Connect wallet first"}
          </button>
        </div>
      </main>
    </>
  );
}
