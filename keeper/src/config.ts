export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
  keeperKeypairPath: process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://clench:clench@localhost:5432/clench",

  // Интервалы (§4 плана). В --accelerated режиме (тесты) переопределяются
  // через env на секунды вместо минут/часов.
  harvestTaxIntervalMs: Number(process.env.HARVEST_TAX_INTERVAL_MS ?? 5 * 60_000),
  epochRoundCheckIntervalMs: Number(process.env.EPOCH_ROUND_CHECK_INTERVAL_MS ?? 30_000),
  updateLeaderIntervalMs: Number(process.env.UPDATE_LEADER_INTERVAL_MS ?? 60_000),
  claimOgIntervalMs: Number(process.env.CLAIM_OG_INTERVAL_MS ?? 24 * 60 * 60_000),
  distributeIntervalMs: Number(process.env.DISTRIBUTE_INTERVAL_MS ?? 60_000),
  sweepPendingIntervalMs: Number(process.env.SWEEP_PENDING_INTERVAL_MS ?? 24 * 60 * 60_000),

  challengeWindowSeconds: Number(process.env.CHALLENGE_WINDOW_SECONDS ?? 3600),

  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
};
