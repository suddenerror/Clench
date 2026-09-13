use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchKind {
    Ticker,
    Name,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RaceStatus {
    Running,
    Extended,
    Settled,
    Void,
}

// §5, §3: живой лидер вместо списка претендентов — O(1) при любом числе участников.
#[account]
pub struct Race {
    pub match_hash: [u8; 32],
    pub match_kind: MatchKind,
    pub claimant_count: u32,
    pub started_at: i64,
    pub current_round: u8,
    pub round_started_at: i64,
    pub round_ends_at: i64,
    pub leader: Pubkey,
    pub leader_score: u64,
    pub overall_leader: Pubkey,
    pub overall_rounds_won: u8,
    pub runner_up: Pubkey,
    pub runner_up_rounds_won: u8,
    pub extra_rounds_used: u8,
    pub status: RaceStatus,
    pub bump: u8,
}

impl Race {
    pub const SEED: &'static [u8] = b"race";
    pub const SPACE: usize =
        8 + 32 + 1 + 4 + 8 + 1 + 8 + 8 + 32 + 8 + 32 + 1 + 32 + 1 + 1 + 1 + 1;
}
