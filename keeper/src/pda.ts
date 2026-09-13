import { PublicKey } from "@solana/web3.js";
import pkg from "js-sha3";
const { keccak_256 } = pkg;

const CONFIG_SEED = Buffer.from("config");
const LAUNCH_SEED = Buffer.from("launch");
const DIST_SEED = Buffer.from("dist");
const PENDING_SEED = Buffer.from("pending");
const RACE_SEED = Buffer.from("race");
const ROUND_SEED = Buffer.from("round");
const WINS_SEED = Buffer.from("wins");
const LOCK_SEED = Buffer.from("lock");

export function findConfigPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}
export function findLaunchPda(programId: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync([LAUNCH_SEED, mint.toBuffer()], programId)[0];
}
export function findDistPda(programId: PublicKey, launch: PublicKey) {
  return PublicKey.findProgramAddressSync([DIST_SEED, launch.toBuffer()], programId)[0];
}
export function findPendingPda(programId: PublicKey, owner: PublicKey, rewardMint: PublicKey) {
  return PublicKey.findProgramAddressSync([PENDING_SEED, owner.toBuffer(), rewardMint.toBuffer()], programId)[0];
}
export function findRacePda(programId: PublicKey, matchHash: Buffer) {
  return PublicKey.findProgramAddressSync([RACE_SEED, matchHash], programId)[0];
}
export function findRoundResultPda(programId: PublicKey, race: PublicKey, round: number) {
  return PublicKey.findProgramAddressSync([ROUND_SEED, race.toBuffer(), Buffer.from([round])], programId)[0];
}
export function findRoundsWonPda(programId: PublicKey, race: PublicKey, launch: PublicKey) {
  return PublicKey.findProgramAddressSync([WINS_SEED, race.toBuffer(), launch.toBuffer()], programId)[0];
}
export function findTickerLockPda(programId: PublicKey, pairHash: Buffer) {
  return PublicKey.findProgramAddressSync([LOCK_SEED, pairHash], programId)[0];
}

function norm(s: string): string {
  const trimmed = s.trim();
  const stripped = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  return stripped.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
// Anchor декодирует [u8;N] как обычный number[], не Buffer/Uint8Array.
function bytesToStr(bytes: Buffer | number[]): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString("utf-8");
}
export function tickerHashFromBytes(ticker: Buffer | number[]): Buffer {
  return Buffer.from(keccak_256.arrayBuffer(Buffer.from(norm(bytesToStr(ticker)), "utf-8")));
}
export function nameHashFromBytes(name: Buffer | number[]): Buffer {
  return Buffer.from(keccak_256.arrayBuffer(Buffer.from(norm(bytesToStr(name)), "utf-8")));
}
export function pairHashFromBytes(name: Buffer | number[], ticker: Buffer | number[]): Buffer {
  const data = Buffer.concat([
    Buffer.from(norm(bytesToStr(name)), "utf-8"),
    Buffer.from([0]),
    Buffer.from(norm(bytesToStr(ticker)), "utf-8"),
  ]);
  return Buffer.from(keccak_256.arrayBuffer(data));
}
