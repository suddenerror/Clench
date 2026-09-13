use anchor_lang::prelude::*;

use super::config::FeeSplit;

// Три режима запуска (§2). Competitive создаётся в Фазе 2, но турнирная
// логика (Race и т.д.) реализуется только в Фазе 3 — здесь просто флаг.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchMode {
    Standard,
    Reward,
    Competitive,
}

// Аккаунты и поля дословно по §5 спеки, плюс `mode`/`epoch_started_at`,
// которых в структуре спеки нет явно, но требуются планом (§2.1) для
// различения трёх режимов запуска и таймера эпохи.
#[account]
pub struct Launch {
    pub mint: Pubkey,
    pub pool: Pubkey,
    pub creator: Pubkey,
    pub name: [u8; 32],
    pub ticker: [u8; 16],
    pub mode: LaunchMode,
    pub tax_bps: u16,             // 100..300, необратимо
    pub reward_assets: [Pubkey; 5],
    pub reward_weights: [u16; 5],
    pub fee_split: FeeSplit,      // заморожен на создании
    pub excluded: [Pubkey; 8],
    pub race: Option<Pubkey>,     // Фаза 3
    pub competitive: bool,        // режим при создании, необратим
    pub is_og: bool,              // Фаза 3
    pub og_barred: bool,          // Фаза 3
    pub born_at: i64,
    pub epoch_started_at: i64,
    pub tax_this_round: u64,      // Фаза 3
    pub tax_this_epoch: u64,
    /// Снапшот пула, зафиксированный `close_epoch`; расходуется `publish_root`
    /// как верхняя граница для проверки `total <= pool(source)` (§5).
    pub epoch_pot_snapshot: u64,
    pub epoch_index: u32,
    /// Сумма, которую vault обязан покрывать прямо сейчас: всё, что уже
    /// опубликовано в Distribution, но ещё не переведено получателю
    /// (аналог `sum_undistributed` из §5). Уменьшается в `distribute` при
    /// каждой реальной отправке, не уменьшается при уходе в `Pending`.
    pub total_owed: u64,
    pub tax_vault_bump: u8,
    pub bump: u8,
}

impl Launch {
    pub const SEED: &'static [u8] = b"launch";
    pub const TAX_VAULT_SEED: &'static [u8] = b"tax_vault";
    pub const SPACE: usize = 8
        + 32 + 32 + 32
        + 32 + 16
        + 1 // mode
        + 2
        + 32 * 5
        + 2 * 5
        + FeeSplit::SPACE
        + 32 * 8
        + 1 + 32 // Option<Pubkey>
        + 1 + 1 + 1
        + 8 + 8
        + 8 + 8
        + 8 + 4
        + 8
        + 1 + 1;
}
