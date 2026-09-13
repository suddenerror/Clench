use anchor_lang::prelude::*;

#[account]
pub struct RoundsWon {
    pub race: Pubkey,
    pub launch: Pubkey,
    pub wins: u8,
    pub bump: u8,
}

impl RoundsWon {
    pub const SEED: &'static [u8] = b"wins";
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1;
}
