import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { config } from "./config.js";
import idl from "../idl/clench.json" with { type: "json" };

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

export function loadKeeperKeypair(): Keypair {
  const raw = JSON.parse(readFileSync(expandHome(config.keeperKeypairPath), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function buildProgram() {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const keypair = loadKeeperKeypair();
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as anchor.Idl, provider);
  return { connection, provider, program, keypair };
}
