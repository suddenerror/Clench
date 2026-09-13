import { PublicKey } from "@solana/web3.js";
import pkg from "js-sha3";
const { keccak_256 } = pkg;
import type { Pool } from "pg";

// §2 формула, та же, что indexer/src/aggregate/epoch.ts — дублирование
// небольшое и намеренное (кипер не импортирует indexer как пакет в этой
// фазе); свести в общий модуль — задокументированный бэклог для Фазы 5.
const PRORATA_BPS = 8000;
function multiplier(streak: number): number {
  return Math.min(3.0, 1.0 + 0.1 * streak);
}

export interface Leaf {
  leafIndex: number;
  owner: PublicKey;
  amount: bigint;
  streak: number;
}

export interface BuiltTree {
  root: Buffer;
  leaves: Leaf[];
  proofs: Buffer[][];
}

function hashLeaf(leafIndex: number, owner: PublicKey, amount: bigint, streak: number): Buffer {
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
function buildTree(hashes: Buffer[]): { root: Buffer; proofs: Buffer[][] } {
  const levels: Buffer[][] = [hashes];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(hashPair(prev[i], i + 1 < prev.length ? prev[i + 1] : prev[i]));
    }
    levels.push(next);
  }
  const proofs = hashes.map((_, leafIdx) => {
    const proof: Buffer[] = [];
    let idx = leafIdx;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const level = levels[lvl];
      const siblingIdx = idx % 2 === 1 ? idx - 1 : idx + 1;
      proof.push(siblingIdx < level.length ? level[siblingIdx] : level[idx]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  });
  return { root: levels[levels.length - 1][0], proofs };
}

/// Строит эпохальное дерево выплат из epoch_holders (Фаза 1 схема), для
/// последней доступной эпохи данного минта. `pool` — сумма к распределению
/// (обычно = launch.epoch_pot_snapshot).
export async function buildEpochTree(db: Pool, mint: Buffer, pool: bigint): Promise<BuiltTree | null> {
  const { rows: maxRow } = await db.query(`SELECT MAX(epoch_index) AS m FROM epoch_holders WHERE mint = $1`, [mint]);
  const epochIdx = maxRow[0]?.m;
  if (epochIdx === null || epochIdx === undefined) return null;

  const { rows } = await db.query(
    `SELECT owner, balance_min, streak_out FROM epoch_holders
     WHERE mint = $1 AND epoch_index = $2 AND balance_min > 0
     ORDER BY owner`,
    [mint, epochIdx]
  );
  if (rows.length === 0) return null;

  // §7 спеки: до любого деления вычитаются бондинг-кривая/пул/creator vault/
  // хранилища протокола. Индексер (Фаза 1/5) пока не применяет Launch.excluded
  // при агрегации — здесь минимальный защитный фильтр: PDA (off-curve адрес)
  // не может быть обычным держателем-кошельком, значит это служебный аккаунт
  // (например, tax_vault) и его нельзя пускать в выплату. Полноценная
  // фильтрация по excluded[] — доработка индексера, см. Фазу 5 (бэклог).
  const holders = rows
    .map((r) => ({
      owner: new PublicKey(r.owner as Buffer),
      balance: BigInt(r.balance_min),
      streak: Number(r.streak_out),
    }))
    .filter((h) => PublicKey.isOnCurve(h.owner.toBytes()));

  const totalBalance = holders.reduce((s, h) => s + h.balance, 0n);
  const totalWeight = holders.reduce((s, h) => s + Number(h.balance) * multiplier(h.streak), 0);
  if (totalBalance === 0n || totalWeight === 0) return null;

  const leaves: Leaf[] = holders.map((h, i) => {
    const prorataShare = (Number(h.balance) / Number(totalBalance)) * (PRORATA_BPS / 10000);
    const prizeShare = ((Number(h.balance) * multiplier(h.streak)) / totalWeight) * ((10000 - PRORATA_BPS) / 10000);
    const amount = BigInt(Math.floor((prorataShare + prizeShare) * Number(pool)));
    return { leafIndex: i, owner: h.owner, amount, streak: h.streak };
  });

  const hashes = leaves.map((l) => hashLeaf(l.leafIndex, l.owner, l.amount, l.streak));
  const { root, proofs } = buildTree(hashes);
  return { root, leaves, proofs };
}
