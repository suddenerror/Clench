import { keccak_256 } from "js-sha3";

// Дословно по программе (hashing.rs): trim, срезать $, uppercase, ASCII-алфанумерика.
function norm(s: string): string {
  const trimmed = s.trim();
  const stripped = trimmed.startsWith("$") ? trimmed.slice(1) : trimmed;
  return stripped.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function pairHash(name: string, ticker: string): Buffer {
  const data = Buffer.concat([Buffer.from(norm(name), "utf-8"), Buffer.from([0]), Buffer.from(norm(ticker), "utf-8")]);
  return Buffer.from(keccak_256.arrayBuffer(data));
}

export function strToFixedBuffer(s: string, len: number): Buffer {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(s, "utf-8").copy(buf, 0, 0, Math.min(Buffer.byteLength(s, "utf-8"), len));
  return buf;
}
