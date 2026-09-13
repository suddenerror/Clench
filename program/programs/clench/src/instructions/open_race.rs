use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::hashing;
use crate::state::config::Config;
use crate::state::launch::Launch;
use crate::state::race::{MatchKind, Race, RaceStatus};

#[derive(Accounts)]
#[instruction(match_hash: [u8; 32])]
pub struct OpenRace<'info> {
    /// Permissionless, зовётся кипером автоматически (§5).
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [Launch::SEED, launch_a.mint.as_ref()], bump = launch_a.bump)]
    pub launch_a: Box<Account<'info, Launch>>,

    #[account(mut, seeds = [Launch::SEED, launch_b.mint.as_ref()], bump = launch_b.bump)]
    pub launch_b: Box<Account<'info, Launch>>,

    #[account(
        init,
        payer = caller,
        space = Race::SPACE,
        seeds = [Race::SEED, match_hash.as_ref()],
        bump
    )]
    pub race: Box<Account<'info, Race>>,

    pub system_program: Program<'info, System>,
}

fn crossed_volume_floor(launch: &Launch, config: &Config) -> bool {
    (launch.lifetime_tax_collected as u128) * 10_000 >= (config.volume_floor as u128) * (launch.tax_bps as u128)
}

/// `open_race` создаётся, когда нашлись два Competitive-запуска с совпавшим
/// ticker_hash/name_hash, оба без плашки и оба пересекли VOLUME_FLOOR (§5).
/// `match_hash` передаётся вызывающим (кипером) и валидируется здесь пересчётом
/// из ончейн-данных launch_a/launch_b — подделать нельзя, это просто способ
/// получить seed для `#[account(seeds=...)]` до чтения самих аккаунтов.
/// Порог оборота проверяется через ончейн-прокси `lifetime_tax_collected`
/// (см. комментарий на этом поле в launch.rs), а не через доверенный вход
/// кипера, в отличие от `update_leader` (§3.3 плана).
pub fn open_race_handler(ctx: Context<OpenRace>, match_hash: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts.launch_a;
    let b = &ctx.accounts.launch_b;

    require!(a.competitive && b.competitive, ClenchError::WrongLaunchMode);
    require!(!a.is_og && !b.is_og, ClenchError::AlreadyOg);
    require!(!a.og_barred && !b.og_barred, ClenchError::OgBarred);
    require!(a.race.is_none() && b.race.is_none(), ClenchError::AlreadyInRace);
    require!(crossed_volume_floor(a, &ctx.accounts.config), ClenchError::VolumeFloorNotCrossed);
    require!(crossed_volume_floor(b, &ctx.accounts.config), ClenchError::VolumeFloorNotCrossed);

    let ticker_a = hashing::ticker_hash(&a.ticker);
    let ticker_b = hashing::ticker_hash(&b.ticker);
    let (computed_hash, match_kind) = if ticker_a == ticker_b {
        (ticker_a, MatchKind::Ticker)
    } else {
        let name_a = hashing::name_hash(&a.name);
        let name_b = hashing::name_hash(&b.name);
        require!(name_a == name_b, ClenchError::NoMatch);
        (name_a, MatchKind::Name)
    };
    require!(computed_hash == match_hash, ClenchError::NoMatch);

    let now = Clock::get()?.unix_timestamp;
    let race = &mut ctx.accounts.race;
    race.match_hash = match_hash;
    race.match_kind = match_kind;
    race.claimant_count = 2;
    race.started_at = now;
    race.current_round = 1;
    race.round_started_at = now;
    race.round_ends_at = now + ctx.accounts.config.round_duration;
    race.leader = Pubkey::default();
    race.leader_score = 0;
    race.overall_leader = Pubkey::default();
    race.overall_rounds_won = 0;
    race.runner_up = Pubkey::default();
    race.runner_up_rounds_won = 0;
    race.extra_rounds_used = 0;
    race.status = RaceStatus::Running;
    race.bump = ctx.bumps.race;

    let race_key = race.key();
    ctx.accounts.launch_a.race = Some(race_key);
    ctx.accounts.launch_b.race = Some(race_key);

    Ok(())
}
