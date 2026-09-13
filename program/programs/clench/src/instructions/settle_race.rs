use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::state::config::Config;
use crate::state::launch::Launch;
use crate::state::race::{Race, RaceStatus};
use crate::state::ticker_lock::TickerLock;

#[derive(Accounts)]
pub struct SettleRace<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [Race::SEED, race.match_hash.as_ref()], bump = race.bump)]
    pub race: Box<Account<'info, Race>>,

    /// Должен быть = race.overall_leader на момент вызова.
    #[account(mut, seeds = [Launch::SEED, launch_leader.mint.as_ref()], bump = launch_leader.bump)]
    pub launch_leader: Box<Account<'info, Launch>>,

    /// Должен быть = race.runner_up на момент вызова.
    #[account(mut, seeds = [Launch::SEED, launch_runner_up.mint.as_ref()], bump = launch_runner_up.bump)]
    pub launch_runner_up: Box<Account<'info, Launch>>,

    #[account(
        init_if_needed,
        payer = caller,
        space = TickerLock::SPACE,
        seeds = [TickerLock::SEED, &pair_hash_of_leader(&launch_leader)],
        bump
    )]
    pub ticker_lock: Box<Account<'info, TickerLock>>,

    pub system_program: Program<'info, System>,
}

fn pair_hash_of_leader(launch: &Account<Launch>) -> [u8; 32] {
    crate::hashing::pair_hash(&launch.name, &launch.ticker)
}

fn crossed_volume_floor(launch: &Launch, config: &Config) -> bool {
    (launch.lifetime_tax_collected as u128) * 10_000 >= (config.og_volume_floor as u128) * (launch.tax_bps as u128)
}

/// §5 `settle_race`: сравнивает overall_rounds_won и runner_up_rounds_won.
/// Ничья до потолка доп. раундов — продлевает race (Extended) прямо здесь.
/// Ничья после потолка — тай-брейк по `lifetime_tax_collected` (ончейн-прокси
/// суммарного налога за турнир, §3 «Итог»); первым пересёкшего VOLUME_FLOOR
/// на цепи не восстановить без доп. состояния, поэтому финальный тай-брейк
/// после исчерпания доп. раундов сделан по объёму, а не по хронологии.
///
/// `holders_floor`/`mcap_floor` (OG-пороги) — как и `update_leader`, они
/// требуют офчейн-данных (число держателей, капитализация с поправкой на
/// ликвидность) и приходят как доверенный вход кипера через `floors_met`.
/// Это ВТОРОЕ и последнее доверенное место в системе помимо `update_leader`
/// (см. §3.3 плана) — worst case компрометации так же ограничен исходом
/// одного турнира/OG-плашки, не кражей средств.
///
/// Известное ограничение: `og_barred` здесь простреливается только
/// победителю/runner-up (единственные две отслеживаемые личности при паттерне
/// живого лидера). Для гонок с >2 претендентами остальные проигравшие не
/// блокируются автоматически этим вызовом — задокументированный пробел,
/// см. docs/CLENCH-BUILD-PLAN.md Фаза 3 (бэклог).
pub fn settle_race_handler(ctx: Context<SettleRace>, floors_met: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.race.status == RaceStatus::Running, ClenchError::RaceNotSettleable);
    require!(now >= ctx.accounts.race.round_ends_at, ClenchError::RoundNotFinished);

    require_keys_eq!(ctx.accounts.launch_leader.key(), ctx.accounts.race.overall_leader, ClenchError::NotInThisRace);
    // При чистой победе (например 4:0) runner_up никогда не выигрывал раунд,
    // поэтому Race не знает его pubkey (паттерн живого лидера не хранит
    // список участников). В этом случае принимаем клиентски указанного
    // runner_up, проверяя его напрямую через launch.race — тот факт, что он
    // вообще присоединился к этой гонке, уже зафиксирован в его собственном
    // аккаунте через open_race/join_race.
    if ctx.accounts.race.runner_up != Pubkey::default() {
        require_keys_eq!(ctx.accounts.launch_runner_up.key(), ctx.accounts.race.runner_up, ClenchError::NotInThisRace);
    } else {
        require!(ctx.accounts.launch_runner_up.race == Some(ctx.accounts.race.key()), ClenchError::NotInThisRace);
        require!(
            ctx.accounts.launch_runner_up.key() != ctx.accounts.race.overall_leader,
            ClenchError::NotInThisRace
        );
    }

    let target_rounds = ctx.accounts.config.rounds_in_race + ctx.accounts.race.extra_rounds_used;
    require!(ctx.accounts.race.current_round == target_rounds, ClenchError::RaceNotYetSettleable);

    let tied = ctx.accounts.race.overall_rounds_won == ctx.accounts.race.runner_up_rounds_won;

    if tied && ctx.accounts.race.extra_rounds_used < ctx.accounts.config.max_extra_rounds {
        let race = &mut ctx.accounts.race;
        race.extra_rounds_used += 1;
        race.status = RaceStatus::Extended;
        race.current_round += 1;
        race.round_started_at = now;
        race.round_ends_at = now + ctx.accounts.config.round_duration;
        race.leader = Pubkey::default();
        race.leader_score = 0;
        return Ok(());
    }

    let (winner_is_leader, winner_key) = if tied {
        // Тай-брейк после исчерпания доп. раундов — по накопленному налогу.
        if ctx.accounts.launch_leader.lifetime_tax_collected >= ctx.accounts.launch_runner_up.lifetime_tax_collected {
            (true, ctx.accounts.launch_leader.key())
        } else {
            (false, ctx.accounts.launch_runner_up.key())
        }
    } else {
        (true, ctx.accounts.race.overall_leader)
    };
    let _ = winner_key;

    let (winner_crossed_floor, winner_lamports_ok) = if winner_is_leader {
        (crossed_volume_floor(&ctx.accounts.launch_leader, &ctx.accounts.config), true)
    } else {
        (crossed_volume_floor(&ctx.accounts.launch_runner_up, &ctx.accounts.config), true)
    };
    let _ = winner_lamports_ok;

    if winner_crossed_floor && floors_met {
        let lock = &mut ctx.accounts.ticker_lock;
        lock.key_hash = pair_hash_of_leader(if winner_is_leader { &ctx.accounts.launch_leader } else { &ctx.accounts.launch_runner_up });
        lock.og_launch = if winner_is_leader { ctx.accounts.launch_leader.key() } else { ctx.accounts.launch_runner_up.key() };
        lock.won_at = now;
        lock.bump = ctx.bumps.ticker_lock;

        if winner_is_leader {
            ctx.accounts.launch_leader.is_og = true;
            ctx.accounts.launch_runner_up.og_barred = true;
        } else {
            ctx.accounts.launch_runner_up.is_og = true;
            ctx.accounts.launch_leader.og_barred = true;
        }
        ctx.accounts.race.status = RaceStatus::Settled;
    } else {
        // Победитель не дотянул пороги — плашка не выдаётся никому, тикер
        // остаётся свободным (§3 «Итог»), но проигравший всё равно навсегда
        // отрезан от этой связки.
        if winner_is_leader {
            ctx.accounts.launch_runner_up.og_barred = true;
        } else {
            ctx.accounts.launch_leader.og_barred = true;
        }
        ctx.accounts.race.status = RaceStatus::Void;
    }

    Ok(())
}
