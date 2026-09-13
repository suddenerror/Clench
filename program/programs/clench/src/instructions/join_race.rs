use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::hashing;
use crate::state::launch::Launch;
use crate::state::race::{MatchKind, Race};
use crate::state::ticker_lock::TickerLock;

#[derive(Accounts)]
pub struct JoinRace<'info> {
    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(mut, seeds = [Race::SEED, race.match_hash.as_ref()], bump = race.bump)]
    pub race: Account<'info, Race>,

    /// CHECK: PDA под pair_hash этого launch'а; существование (ненулевой
    /// lamports/owner=программа) = связка закрыта для турниров (§5).
    /// Адрес проверяется в хендлере через find_program_address — так
    /// проще, чем городить `Option<Account>` с seeds внутри `#[instruction]`.
    pub ticker_lock_check: UncheckedAccount<'info>,
}

/// Добавляет претендента до конца второго раунда (§5, §3 «Вход» — первые 12ч).
pub fn join_race_handler(ctx: Context<JoinRace>) -> Result<()> {
    let launch = &ctx.accounts.launch;
    let race = &ctx.accounts.race;

    require!(launch.competitive, ClenchError::WrongLaunchMode);
    require!(!launch.is_og, ClenchError::AlreadyOg);
    require!(!launch.og_barred, ClenchError::OgBarred);
    require!(launch.race.is_none(), ClenchError::AlreadyInRace);
    require!(race.current_round <= 2, ClenchError::JoinWindowClosed);

    let pair_hash = hashing::pair_hash(&launch.name, &launch.ticker);
    let (expected_lock_pda, _) = Pubkey::find_program_address(&[TickerLock::SEED, pair_hash.as_ref()], ctx.program_id);
    require_keys_eq!(ctx.accounts.ticker_lock_check.key(), expected_lock_pda, ClenchError::NoMatch);
    require!(ctx.accounts.ticker_lock_check.data_is_empty(), ClenchError::TickerLocked);

    let matches = match race.match_kind {
        MatchKind::Ticker => hashing::ticker_hash(&launch.ticker) == race.match_hash,
        MatchKind::Name => hashing::name_hash(&launch.name) == race.match_hash,
    };
    require!(matches, ClenchError::NoMatch);

    ctx.accounts.launch.race = Some(race.key());
    ctx.accounts.race.claimant_count = ctx.accounts.race.claimant_count.saturating_add(1);
    Ok(())
}
