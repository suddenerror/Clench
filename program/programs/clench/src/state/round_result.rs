use anchor_lang::prelude::*;

#[account]
pub struct RoundResult {
    pub race: Pubkey,
    pub round: u8,
    pub winner: Pubkey,
    pub winner_score: u64,
    pub bank_entries: u8,
    pub closed_at: i64,
    pub bump: u8,
}

impl RoundResult {
    pub const SEED: &'static [u8] = b"round";
    pub const SPACE: usize = 8 + 32 + 1 + 32 + 8 + 1 + 8 + 1;
}
