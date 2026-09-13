import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idl from "../idl/clench.json";

export function buildBrowserProgram(connection: Connection, wallet: WalletContextState) {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error("Кошелёк не подключён");
  }
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction.bind(wallet),
      signAllTransactions: wallet.signAllTransactions?.bind(wallet) ?? (async (txs) => txs),
    },
    { commitment: "confirmed" }
  );
  return new anchor.Program(idl as anchor.Idl, provider);
}

export function findLaunchPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("launch"), mint.toBuffer()], programId)[0];
}

export function findTickerLockPda(programId: PublicKey, pairHash: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("lock"), pairHash], programId)[0];
}
