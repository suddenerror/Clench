use anchor_lang::prelude::*;

pub mod errors;
pub mod hashing;
pub mod instructions;
pub mod merkle;
pub mod payout;
pub mod state;

use instructions::*;

declare_id!("YS3nPRaMBL4unfow4iqs8rwrXnLLWx2MYucp9ba582m");

#[program]
pub mod clench {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        initialize_config_handler(ctx, args)
    }

    pub fn create_launch(ctx: Context<CreateLaunch>, args: CreateLaunchArgs) -> Result<()> {
        create_launch_handler(ctx, args)
    }

    pub fn harvest_tax<'info>(ctx: Context<'_, '_, '_, 'info, HarvestTax<'info>>) -> Result<()> {
        harvest_tax_handler(ctx)
    }

    pub fn close_epoch(ctx: Context<CloseEpoch>) -> Result<()> {
        close_epoch_handler(ctx)
    }

    pub fn publish_root(
        ctx: Context<PublishRoot>,
        root: [u8; 32],
        total: u64,
        leaf_count: u32,
        reward_mint: Pubkey,
    ) -> Result<()> {
        publish_root_handler(ctx, root, total, leaf_count, reward_mint)
    }

    pub fn distribute(
        ctx: Context<Distribute>,
        leaf_index: u32,
        owner: Pubkey,
        amount: u64,
        streak: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        distribute_handler(ctx, leaf_index, owner, amount, streak, proof)
    }

    pub fn finalize_distribution(ctx: Context<FinalizeDistribution>) -> Result<()> {
        finalize_distribution_handler(ctx)
    }

    pub fn open_race(ctx: Context<OpenRace>, match_hash: [u8; 32]) -> Result<()> {
        open_race_handler(ctx, match_hash)
    }

    pub fn join_race(ctx: Context<JoinRace>) -> Result<()> {
        join_race_handler(ctx)
    }

    pub fn update_leader(ctx: Context<UpdateLeader>, composite_score: u64) -> Result<()> {
        update_leader_handler(ctx, composite_score)
    }

    pub fn close_round(ctx: Context<CloseRound>) -> Result<()> {
        close_round_handler(ctx)
    }

    pub fn settle_race(ctx: Context<SettleRace>, floors_met: bool) -> Result<()> {
        settle_race_handler(ctx, floors_met)
    }

    pub fn claim_og(ctx: Context<ClaimOg>, floors_met: bool) -> Result<()> {
        claim_og_handler(ctx, floors_met)
    }
}

// re-export for tests/clients that only import the crate root
pub use state::launch::Launch;
