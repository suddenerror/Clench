use anchor_lang::prelude::*;

// Дословно по §5 спеки. Поля турнира/OG уже здесь — заготовка под Фазу 3,
// логика для них не реализуется в Фазе 2 (docs/CLENCH-BUILD-PLAN.md §2.1).
#[account]
pub struct Config {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_split: FeeSplit,
    pub epoch_duration: i64,        // 86400
    pub round_duration: i64,        // 21600
    pub rounds_in_race: u8,         // 4
    pub max_extra_rounds: u8,       // 8
    pub bank_bps: u16,              // 2000
    pub round_jitter: i64,          // 900
    pub wallet_volume_cap_bps: u16, // 500
    pub churn_weight_bps: u16,      // 1000
    pub w_volume_bps: u16,          // 5000
    pub w_holders_bps: u16,         // 3000
    pub w_mcap_bps: u16,            // 2000
    pub volume_floor: u64,
    pub og_volume_floor: u64,
    pub og_holders_floor: u32,
    pub og_mcap_floor: u64,
    pub multiplier_step_bps: u16,     // 1000
    pub multiplier_cap_bps: u16,      // 30000
    pub og_multiplier_step_bps: u16,  // 1500
    pub og_multiplier_cap_bps: u16,   // 40000
    pub prorata_bps: u16,             // 8000
    pub dust_tolerance_bps: u16,      // 50
    pub min_payout: u64,
    pub challenge_window: i64, // 3600
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
    pub const SPACE: usize = 8 + 32 + 32 + FeeSplit::SPACE + 8 + 8 + 1 + 1 + 2 + 8 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 4 + 8 + 2 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 1 + 1;
}

// Куда идёт налог (§4 для Reward/Competitive: 85/10/5; §2 для Standard: 0/50/0 + creator 50).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct FeeSplit {
    pub holders_bps: u16,
    pub treasury_bps: u16,
    pub keeper_bps: u16,
    pub creator_bps: u16,
}

impl FeeSplit {
    pub const SPACE: usize = 2 + 2 + 2 + 2;

    pub fn sum(&self) -> u32 {
        self.holders_bps as u32 + self.treasury_bps as u32 + self.keeper_bps as u32 + self.creator_bps as u32
    }

    pub fn is_valid(&self) -> bool {
        self.sum() == 10_000
    }

    pub fn reward_default() -> Self {
        Self { holders_bps: 8500, treasury_bps: 1000, keeper_bps: 500, creator_bps: 0 }
    }

    pub fn standard_default() -> Self {
        Self { holders_bps: 0, treasury_bps: 5000, keeper_bps: 0, creator_bps: 5000 }
    }
}
