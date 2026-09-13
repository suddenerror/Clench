use anchor_lang::prelude::*;

// §5: существование = связка закрыта для турниров. PDA от хеша связки —
// проверка бесплатна, без списков и модерации.
#[account]
pub struct TickerLock {
    pub key_hash: [u8; 32],
    pub og_launch: Pubkey,
    pub won_at: i64,
    pub bump: u8,
}

impl TickerLock {
    pub const SEED: &'static [u8] = b"lock";
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}
