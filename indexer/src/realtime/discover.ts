import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import idl from "../../idl/clench.json" with { type: "json" };

const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
const coder = new anchor.BorshAccountsCoder(idl as anchor.Idl);

export interface DiscoveredLaunch {
  pubkey: PublicKey;
  mint: PublicKey;
  bornAt: number;
}

/// Список активных Launch'ов через getProgramAccounts + Anchor-дискриминатор,
/// без нужды в подписывающем кошельке (только чтение).
export async function discoverLaunches(connection: Connection): Promise<DiscoveredLaunch[]> {
  const discriminator = coder.accountDiscriminator("Launch");
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(discriminator) } }],
  });

  return accounts.map(({ pubkey, account }) => {
    const decoded = coder.decode("Launch", account.data);
    return { pubkey, mint: decoded.mint as PublicKey, bornAt: Number(decoded.bornAt) };
  });
}
