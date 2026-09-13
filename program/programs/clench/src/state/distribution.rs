use anchor_lang::prelude::*;

// Дословно по §5. `source` в Фазе 2 — это Launch (эпоха обычного холдерского
// пула); RoundResult (турнир) появится в Фазе 3, но поле уже общее.
#[account]
pub struct Distribution {
    pub source: Pubkey,
    pub root: [u8; 32],
    pub total: u64,
    pub sent: u64,
    pub deferred: u64,
    pub cursor: u32,
    pub leaf_count: u32,
    pub finished: bool,
    /// Актив выплаты этой раздачи. `Pubkey::default()` = нативный SOL.
    /// Спека допускает корзину до 5 активов (§2) — не MVP, вне Фазы 2:
    /// здесь один актив на Distribution (SingleAsset|Sol из §11 списка).
    pub reward_mint: Pubkey,
    pub bump: u8,
}

impl Distribution {
    pub const SEED: &'static [u8] = b"dist";
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 4 + 4 + 1 + 32 + 1;
}
