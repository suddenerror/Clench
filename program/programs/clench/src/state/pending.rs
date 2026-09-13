use anchor_lang::prelude::*;

// §5, §4: обязательство протокола, не сгорает и не перераспределяется.
#[account]
pub struct Pending {
    pub owner: Pubkey,
    pub reward_mint: Pubkey,
    pub amount: u64,
    pub bump: u8,
}

impl Pending {
    pub const SEED: &'static [u8] = b"pending";
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}
