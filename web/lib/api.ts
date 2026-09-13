const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface HolderRow {
  owner: string;
  balanceMin: string;
  streak: number;
}

export interface HoldersResponse {
  epoch: number | null;
  holders: HolderRow[];
}

export interface EpochSummary {
  epoch_index: number;
  holders: string;
  total_balance: string;
}

export async function fetchHolders(mint: string): Promise<HoldersResponse> {
  const res = await fetch(`${API_URL}/coins/${mint}/holders`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function fetchEpochs(mint: string): Promise<{ epochs: EpochSummary[] }> {
  const res = await fetch(`${API_URL}/coins/${mint}/epochs`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface CoinRow {
  mint: string;
  epoch: number;
  holders: number;
  totalBalance: string;
}

export async function fetchCoins(): Promise<{ coins: CoinRow[] }> {
  const res = await fetch(`${API_URL}/coins`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface HallOfFameEntry {
  owner: string;
  mint: string;
  streak: number;
}

export async function fetchHallOfFame(): Promise<{ fame: HallOfFameEntry[]; shame: HallOfFameEntry[] }> {
  const res = await fetch(`${API_URL}/hall-of-fame`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
