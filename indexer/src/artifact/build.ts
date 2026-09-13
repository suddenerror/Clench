import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// §6 спеки, формат дословно:
// { "source": "…", "kind": "epoch|round", "mint": "…",
//   "start_slot": …, "end_slot": …, "pool": "…", "root": "0x…",
//   "leaves": [{"i":0,"owner":"…","amount":"…","streak":14}, …] }
export interface EpochArtifactInput {
  source: string;
  kind: "epoch" | "round";
  mint: string;
  startSlot: number;
  endSlot: number;
  pool: string;
  root: string; // "0x" + hex
  leaves: { i: number; owner: string; amount: string; streak: number }[];
}

export interface BuiltArtifact {
  json: string;
  sha256: string;
  localPath: string;
}

/// Строит артефакт эпохи/раунда и сохраняет локально. Любой может скачать
/// и пересчитать из публичного RPC — единственное, что делает офчейн-расчёт
/// проверяемым (§6). Пин в Arweave — отдельный шаг (см. `pinToArweave`
/// ниже): в этом окружении нет Arweave-кошелька/финансирования, поэтому
/// сейчас это ЗАГЛУШКА, а не фиктивная "успешная" публикация — не
/// притворяемся, что запинили, когда не запинили.
export function buildEpochArtifact(input: EpochArtifactInput, outDir = "data/artifacts"): BuiltArtifact {
  const payload = {
    source: input.source,
    kind: input.kind,
    mint: input.mint,
    start_slot: input.startSlot,
    end_slot: input.endSlot,
    pool: input.pool,
    root: input.root,
    leaves: input.leaves,
  };
  const json = JSON.stringify(payload, null, 2);
  const sha256 = createHash("sha256").update(json).digest("hex");

  mkdirSync(outDir, { recursive: true });
  const localPath = join(outDir, `${input.kind}-${input.source}-${sha256.slice(0, 8)}.json`);
  writeFileSync(localPath, json, "utf-8");

  return { json, sha256, localPath };
}

export interface ArweavePinResult {
  txId: string;
  url: string;
}

/// §6 «Пин в Arweave, хеш в X ботом». Требует Arweave-кошелёк с балансом —
/// не настроен в этом окружении (не Anthropic-провижинг, нужен реальный
/// AR-кошелёк деплоера). Явно бросает, а не молча возвращает фиктивный URL —
/// вызывающий код обязан обработать это как «пин не настроен», не как успех.
export async function pinToArweave(_artifact: BuiltArtifact): Promise<ArweavePinResult> {
  throw new Error(
    "Arweave pinning is not configured in this environment (no funded Arweave wallet). " +
      "Set ARWEAVE_WALLET_PATH and implement upload via `arweave` SDK before relying on this in production."
  );
}
