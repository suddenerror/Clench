"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export function Header() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          clench
        </Link>
        <nav className="flex items-center gap-6 text-sm text-ink/70">
          <Link href="/" className="hover:text-ink">
            Explore
          </Link>
          <Link href="/create" className="hover:text-ink">
            Create
          </Link>
          <Link href="/hall" className="hover:text-ink">
            Hall of fame
          </Link>
        </nav>
        <WalletMultiButton style={{ backgroundColor: "#1F2229", borderRadius: 4, fontFamily: "inherit" }} />
      </div>
    </header>
  );
}
