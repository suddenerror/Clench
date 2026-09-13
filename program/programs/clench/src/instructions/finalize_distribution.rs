use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::state::distribution::Distribution;
use crate::state::launch::Launch;

#[derive(Accounts)]
pub struct FinalizeDistribution<'info> {
    /// Кому возвращается рента закрываемого аккаунта — keeper fund (§5).
    #[account(mut)]
    pub keeper_fund: SystemAccount<'info>,

    #[account(seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(
        mut,
        seeds = [Distribution::SEED, launch.key().as_ref()],
        bump = distribution.bump,
        close = keeper_fund
    )]
    pub distribution: Account<'info, Distribution>,
}

pub fn finalize_distribution_handler(ctx: Context<FinalizeDistribution>) -> Result<()> {
    let dist = &mut ctx.accounts.distribution;

    require!(dist.cursor == dist.leaf_count, ClenchError::DistributionNotFinished);
    require!(dist.sent.saturating_add(dist.deferred) == dist.total, ClenchError::DistributionMismatch);

    dist.finished = true;
    Ok(())
}
