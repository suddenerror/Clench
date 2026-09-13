import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import pkg from "js-sha3";
const { keccak_256 } = pkg;

export const LAUNCH_SEED = Buffer.from("launch");
export const DIST_SEED = Buffer.from("dist");
export const PENDING_SEED = Buffer.from("pending");
export const CONFIG_SEED = Buffer.from("config");

export function findLaunchPda(programId: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LAUNCH_SEED, mint.toBuffer()], programId);
}

export function findDistPda(programId: PublicKey, launch: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([DIST_SEED, launch.toBuffer()], programId);
}

export function findPendingPda(programId: PublicKey, owner: PublicKey, rewardMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PENDING_SEED, owner.toBuffer(), rewardMint.toBuffer()], programId);
}

export function findConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

export const RACE_SEED = Buffer.from("race");
export const ROUND_SEED = Buffer.from("round");
export const WINS_SEED = Buffer.from("wins");
export const LOCK_SEED = Buffer.from("lock");

export function findRacePda(programId: PublicKey, matchHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([RACE_SEED, matchHash], programId);
}

export function findRoundResultPda(programId: PublicKey, race: PublicKey, round: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ROUND_SEED, race.toBuffer(), Buffer.from([round])], programId);
}

export function findRoundsWonPda(programId: PublicKey, race: PublicKey, launch: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([WINS_SEED, race.toBuffer(), launch.toBuffer()], programId);
}

export function findTickerLockPda(programId: PublicKey, pairHash: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LOCK_SEED, pairHash], programId);
}

// Дословно по hashing.rs: trim, срезать $, uppercase, только ASCII-алфанумерика.
export function norm(s: string): string {
  const trimmed = s.trim();
  const stripped = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  return stripped.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function tickerHash(ticker: string): Buffer {
  return Buffer.from(keccak_256.arrayBuffer(Buffer.from(norm(ticker), "utf-8")));
}

export function nameHash(name: string): Buffer {
  return Buffer.from(keccak_256.arrayBuffer(Buffer.from(norm(name), "utf-8")));
}

export function pairHash(name: string, ticker: string): Buffer {
  const data = Buffer.concat([Buffer.from(norm(name), "utf-8"), Buffer.from([0]), Buffer.from(norm(ticker), "utf-8")]);
  return Buffer.from(keccak_256.arrayBuffer(data));
}

export function strToFixedBuffer(s: string, len: number): Buffer {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, "utf-8").copy(buf);
  return buf;
}

// Дословно по merkle.rs: keccak256(be_bytes(leaf_index) || owner || be_bytes(amount) || be_bytes(streak)).
export function hashLeaf(leafIndex: number, owner: PublicKey, amount: bigint, streak: number): Buffer {
  const buf = Buffer.alloc(4 + 32 + 8 + 4);
  buf.writeUInt32BE(leafIndex, 0);
  owner.toBuffer().copy(buf, 4);
  buf.writeBigUInt64BE(amount, 36);
  buf.writeUInt32BE(streak, 44);
  return Buffer.from(keccak_256.arrayBuffer(buf));
}

function hashPair(a: Buffer, b: Buffer): Buffer {
  const [x, y] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return Buffer.from(keccak_256.arrayBuffer(Buffer.concat([x, y])));
}

export interface MerkleLeafInput {
  leafIndex: number;
  owner: PublicKey;
  amount: bigint;
  streak: number;
}

export interface BuiltMerkleTree {
  root: Buffer;
  proofs: Buffer[][]; // proofs[i] соответствует leaves[i]
}

// Простое (не оптимизированное) построение дерева по массиву листьев — только
// для тестов; продовый билдер живёт в индексере (Фаза 5).
export function buildMerkleTree(leaves: MerkleLeafInput[]): BuiltMerkleTree {
  const leafHashes = leaves.map((l) => hashLeaf(l.leafIndex, l.owner, l.amount, l.streak));
  let levels: Buffer[][] = [leafHashes];

  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      const left = prev[i];
      const right = i + 1 < prev.length ? prev[i + 1] : prev[i];
      next.push(hashPair(left, right));
    }
    levels.push(next);
  }

  const proofs: Buffer[][] = leaves.map((_, leafIdx) => {
    const proof: Buffer[] = [];
    let idx = leafIdx;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const level = levels[lvl];
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      const sibling = siblingIdx < level.length ? level[siblingIdx] : level[idx];
      proof.push(sibling);
      idx = Math.floor(idx / 2);
    }
    return proof;
  });

  return { root: levels[levels.length - 1][0], proofs };
}
