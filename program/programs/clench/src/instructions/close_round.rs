use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::state::config::Config;
use crate::state::race::Race;
use crate::state::round_result::RoundResult;
use crate::state::rounds_won::RoundsWon;

#[derive(Accounts)]
pub struct CloseRound<'info> {
    /// Permissionless после round_ends_at (§5).
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [Race::SEED, race.match_hash.as_ref()], bump = race.bump)]
    pub race: Account<'info, Race>,

    #[account(
        init,
        payer = caller,
        space = RoundResult::SPACE,
        seeds = [RoundResult::SEED, race.key().as_ref(), &[race.current_round]],
        bump
    )]
    pub round_result: Account<'info, RoundResult>,

    /// Только если у раунда есть победитель (race.leader != default) —
    /// иначе клиент передаёт этот же адрес, но init_if_needed не запишется
    /// осмысленно (winner=default никогда не совпадёт с реальным launch).
    #[account(
        init_if_needed,
        payer = caller,
        space = RoundsWon::SPACE,
        seeds = [RoundsWon::SEED, race.key().as_ref(), race.leader.as_ref()],
        bump
    )]
    pub rounds_won: Account<'info, RoundsWon>,

    pub system_program: Program<'info, System>,
}

/// Фиксирует победителя из `leader`, инкрементит RoundsWon, обновляет
/// overall_leader/runner_up, назначает следующий раунд со свежим джиттером,
/// либо — если это последний раунд текущей цели — оставляет race готовой к
/// `settle_race` (§5).
///
/// Джиттер (§3 «Снайп закрытия раунда»): случайное закрытие в последние 15
/// минут. У нас нет VRF на Solana без доп. оракула, поэтому используем
/// текущий slot как источник псевдослучайности — недостаточно для
/// криптографической непредсказуемости, но ломает ТОЧНОЕ таймирование
/// снайпера, которое и есть реальная угроза здесь. Задокументировано как
/// известное ограничение для аудита (Фаза 6).
pub fn close_round_handler(ctx: Context<CloseRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.race.round_ends_at, ClenchError::RoundNotFinished);

    let race = &mut ctx.accounts.race;
    let winner = race.leader;
    let winner_score = race.leader_score;

    let result = &mut ctx.accounts.round_result;
    result.race = race.key();
    result.round = race.current_round;
    result.winner = winner;
    result.winner_score = winner_score;
    result.bank_entries = 0; // сбор/распределение банка раунда — бэклог, не в этой фазе
    result.closed_at = now;
    result.bump = ctx.bumps.round_result;

    if winner != Pubkey::default() {
        let rounds_won = &mut ctx.accounts.rounds_won;
        rounds_won.race = race.key();
        rounds_won.launch = winner;
        rounds_won.wins = rounds_won.wins.saturating_add(1);
        let wins = rounds_won.wins;

        if wins > race.overall_rounds_won || race.overall_leader == Pubkey::default() {
            if race.overall_leader != winner {
                race.runner_up = race.overall_leader;
                race.runner_up_rounds_won = race.overall_rounds_won;
            }
            race.overall_rounds_won = wins;
            race.overall_leader = winner;
        } else if winner != race.overall_leader && wins > race.runner_up_rounds_won {
            race.runner_up = winner;
            race.runner_up_rounds_won = wins;
        }
    }

    let target_rounds = ctx.accounts.config.rounds_in_race + race.extra_rounds_used;
    let next_round = race.current_round + 1;
    if next_round <= target_rounds {
        let slot = Clock::get()?.slot;
        let jitter = (slot % ctx.accounts.config.round_jitter.max(1) as u64) as i64;
        race.current_round = next_round;
        race.round_started_at = now;
        race.round_ends_at = now + ctx.accounts.config.round_duration - ctx.accounts.config.round_jitter + jitter;
        race.leader = Pubkey::default();
        race.leader_score = 0;
    }
    // next_round > target_rounds: раунды кончились, ждём settle_race.

    Ok(())
}
