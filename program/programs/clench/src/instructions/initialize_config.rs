use anchor_lang::prelude::*;

use crate::state::config::{Config, FeeSplit};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub treasury: Pubkey,
    pub epoch_duration: i64,
    pub round_duration: i64,
    pub rounds_in_race: u8,
    pub max_extra_rounds: u8,
    pub bank_bps: u16,
    pub round_jitter: i64,
    pub wallet_volume_cap_bps: u16,
    pub churn_weight_bps: u16,
    pub w_volume_bps: u16,
    pub w_holders_bps: u16,
    pub w_mcap_bps: u16,
    pub volume_floor: u64,
    pub og_volume_floor: u64,
    pub og_holders_floor: u32,
    pub og_mcap_floor: u64,
    pub multiplier_step_bps: u16,
    pub multiplier_cap_bps: u16,
    pub og_multiplier_step_bps: u16,
    pub og_multiplier_cap_bps: u16,
    pub prorata_bps: u16,
    pub dust_tolerance_bps: u16,
    pub min_payout: u64,
    pub challenge_window: i64,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = Config::SPACE, seeds = [Config::SEED], bump)]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config_handler(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.treasury = args.treasury;
    config.fee_split = FeeSplit::reward_default();
    config.epoch_duration = args.epoch_duration;
    config.round_duration = args.round_duration;
    config.rounds_in_race = args.rounds_in_race;
    config.max_extra_rounds = args.max_extra_rounds;
    config.bank_bps = args.bank_bps;
    config.round_jitter = args.round_jitter;
    config.wallet_volume_cap_bps = args.wallet_volume_cap_bps;
    config.churn_weight_bps = args.churn_weight_bps;
    config.w_volume_bps = args.w_volume_bps;
    config.w_holders_bps = args.w_holders_bps;
    config.w_mcap_bps = args.w_mcap_bps;
    config.volume_floor = args.volume_floor;
    config.og_volume_floor = args.og_volume_floor;
    config.og_holders_floor = args.og_holders_floor;
    config.og_mcap_floor = args.og_mcap_floor;
    config.multiplier_step_bps = args.multiplier_step_bps;
    config.multiplier_cap_bps = args.multiplier_cap_bps;
    config.og_multiplier_step_bps = args.og_multiplier_step_bps;
    config.og_multiplier_cap_bps = args.og_multiplier_cap_bps;
    config.prorata_bps = args.prorata_bps;
    config.dust_tolerance_bps = args.dust_tolerance_bps;
    config.min_payout = args.min_payout;
    config.challenge_window = args.challenge_window;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}
