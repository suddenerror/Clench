use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::state::config::Config;
use crate::state::launch::Launch;

#[derive(Accounts)]
pub struct CloseEpoch<'info> {
    /// Permissionless — любой может закрыть эпоху после дедлайна.
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,
}

/// Только после `epoch_duration`. Фиксация pot_snapshot, обнуление счётчика (§5).
pub fn close_epoch_handler(ctx: Context<CloseEpoch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;

    require!(
        now >= launch.epoch_started_at + ctx.accounts.config.epoch_duration,
        ClenchError::EpochNotFinished
    );

    launch.epoch_pot_snapshot = launch.tax_this_epoch;
    launch.tax_this_epoch = 0;
    launch.epoch_index = launch.epoch_index.saturating_add(1);
    launch.epoch_started_at = now;

    Ok(())
}
