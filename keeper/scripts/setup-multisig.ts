// Фаза 6: настройка Squads-мультисига на devnet для отработки механики
// (передача authority программы под мультисиг + таймлок), НЕ настоящая
// защита с реальными подписантами — это явно требует решения пользователя
// (см. docs/audit-checklist-v1.md, «Squads multisig + таймлок»).
//
// По умолчанию создаёт мультисиг с ОДНИМ участником (deploy-кошелёк) и
// threshold=1 — это ТОЛЬКО проверка механизма на devnet, не реальная
// многоподписная защита. Реальные подписанты передаются через
// MULTISIG_MEMBERS (запятая, base58 pubkeys) и MULTISIG_THRESHOLD.
import * as multisig from "@sqds/multisig";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(expandHome(path), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const keypairPath = process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json";
  const connection = new Connection(rpcUrl, "confirmed");
  const creator = loadKeypair(keypairPath);

  const memberPubkeys = (process.env.MULTISIG_MEMBERS ?? creator.publicKey.toBase58())
    .split(",")
    .map((s) => new PublicKey(s.trim()));
  const threshold = Number(process.env.MULTISIG_THRESHOLD ?? 1);

  if (memberPubkeys.length === 1) {
    console.warn(
      "[setup-multisig] ВНИМАНИЕ: один участник, threshold=1 — это проверка МЕХАНИЗМА," +
        " не защита. Для mainnet передайте реальных подписантов через MULTISIG_MEMBERS."
    );
  }

  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });

  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, programConfigPda);
  const configTreasury = programConfig.treasury;

  const ix = multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey,
    creator: creator.publicKey,
    multisigPda,
    configAuthority: null, // autonomous — только через ончейн-предложения/голосование
    timeLock: Number(process.env.MULTISIG_TIMELOCK_SECONDS ?? 0), // 48ч = 172800, см. ниже
    members: memberPubkeys.map((key) => ({ key, permissions: multisig.types.Permissions.all() })),
    threshold,
    rentCollector: null,
    treasury: configTreasury,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([creator, createKey]);

  const sig = await connection.sendTransaction(tx);
  await connection.confirmTransaction(sig, "confirmed");

  console.log(`[setup-multisig] Multisig created: ${multisigPda.toBase58()}`);
  console.log(`[setup-multisig] tx: ${sig}`);
  console.log(
    `[setup-multisig] Следующий шаг (вручную, отдельным решением): ` +
      `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority ${multisigPda.toBase58()}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
