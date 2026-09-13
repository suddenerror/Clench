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
///
/// `epoch_pot_snapshot` НАКАПЛИВАЕТСЯ, а не перезаписывается: если кипер не
/// успел вызвать `publish_root` до того, как закрылась следующая эпоха
/// (например, отстаёт из-за перегрузки/деградации сети — §4 «Ретраи»), налог
/// прошлой эпохи не должен молча пропасть из учёта. Токены и так уже лежат
/// в vault (harvest_tax их туда переместил) — простое присваивание тут
/// означало бы, что часть уже собранного налога никогда не попадёт ни в один
/// будущий publish_root/distribute, оставшись в vault, но не будучи ничьим
/// обязательством. `publish_root` сам вычитает опубликованное из снапшота
/// (см. publish_root.rs), так что накопление корректно схлопывается к нулю
/// после успешной публикации.
pub fn close_epoch_handler(ctx: Context<CloseEpoch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let launch = &mut ctx.accounts.launch;

    require!(
        now >= launch.epoch_started_at + ctx.accounts.config.epoch_duration,
        ClenchError::EpochNotFinished
    );

    launch.epoch_pot_snapshot = launch.epoch_pot_snapshot.saturating_add(launch.tax_this_epoch);
    launch.tax_this_epoch = 0;
    launch.epoch_index = launch.epoch_index.saturating_add(1);
    launch.epoch_started_at = now;

    Ok(())
}
