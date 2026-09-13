use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::hashing;
use crate::state::config::Config;
use crate::state::launch::Launch;
use crate::state::ticker_lock::TickerLock;

#[derive(Accounts)]
pub struct ClaimOg<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(
        init_if_needed,
        payer = caller,
        space = TickerLock::SPACE,
        seeds = [TickerLock::SEED, hashing::pair_hash(&launch.name, &launch.ticker).as_ref()],
        bump
    )]
    pub ticker_lock: Account<'info, TickerLock>,

    pub system_program: Program<'info, System>,
}

/// Плашка без соперников — только пороги, без турнира (§5, §3 «Как получают
/// плашку OG»). Permissionless, «проверяется кипером ежесуточно, пока связка
/// свободна» — не разовая попытка, можно звать снова, пока `og_barred=false`
/// и `TickerLock` не занят кем-то другим.
///
/// `floors_met` — доверенный вход кипера для holders/mcap (нет ончейн-оракула
/// числа держателей/капитализации-с-поправкой-на-ликвидность); volume
/// проверяется на цепи через `lifetime_tax_collected`. См. те же оговорки,
/// что у `update_leader`/`settle_race` (§3.3 плана).
pub fn claim_og_handler(ctx: Context<ClaimOg>, floors_met: bool) -> Result<()> {
    let launch = &ctx.accounts.launch;
    require!(launch.competitive, ClenchError::WrongLaunchMode);
    require!(!launch.is_og, ClenchError::AlreadyOg);
    require!(!launch.og_barred, ClenchError::OgBarred);
    require!(launch.race.is_none(), ClenchError::RaceStillRunning);

    let lock = &ctx.accounts.ticker_lock;
    let already_claimed_by_other = lock.og_launch != Pubkey::default() && lock.og_launch != launch.key();
    require!(!already_claimed_by_other, ClenchError::TickerLocked);

    let crossed_volume = (launch.lifetime_tax_collected as u128) * 10_000
        >= (ctx.accounts.config.og_volume_floor as u128) * (launch.tax_bps as u128);
    require!(crossed_volume && floors_met, ClenchError::OgFloorNotCrossed);

    let now = Clock::get()?.unix_timestamp;
    let pair_hash = hashing::pair_hash(&launch.name, &launch.ticker);

    let lock = &mut ctx.accounts.ticker_lock;
    lock.key_hash = pair_hash;
    lock.og_launch = launch.key();
    lock.won_at = now;
    lock.bump = ctx.bumps.ticker_lock;

    ctx.accounts.launch.is_og = true;
    Ok(())
}
