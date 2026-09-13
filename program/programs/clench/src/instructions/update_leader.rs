use anchor_lang::prelude::*;

use crate::errors::ClenchError;
use crate::state::launch::Launch;
use crate::state::race::Race;

#[derive(Accounts)]
pub struct UpdateLeader<'info> {
    /// Permissionless, зовётся кипером по всем претендентам (§5).
    pub caller: Signer<'info>,

    #[account(seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(mut, seeds = [Race::SEED, race.match_hash.as_ref()], bump = race.bump)]
    pub race: Account<'info, Race>,
}

/// §3.3 плана: **единственное доверенное место в системе**. `composite_score`
/// приходит от кипера, посчитан офчейн из направленного оборота (индексер),
/// который на цепи не восстановить. Программа не может проверить его точность
/// — только правдоподобность (не выше физически возможного по фактически
/// собранному налогу за раунд), и это явно не гарантия корректности, а просто
/// защита от совсем абсурдных значений. Worst case при компрометации кипера —
/// искажение исхода ОДНОГО турнира (кто получит плашку/банк), а не кража
/// средств: сами переводы в `distribute`/`harvest_tax` никак не зависят от
/// этого значения. См. также аудиторский чек-лист Фазы 6.
pub fn update_leader_handler(ctx: Context<UpdateLeader>, composite_score: u64) -> Result<()> {
    let launch = &ctx.accounts.launch;
    require!(launch.race == Some(ctx.accounts.race.key()), ClenchError::NotInThisRace);

    // Правдоподобность: составной счёт не может физически превысить объём,
    // на который вообще был способен пул за раунд — грубая, но дешёвая узда
    // против абсурдных чисел от скомпрометированного кипера. tax_this_round
    // уже ончейн-факт (harvest_tax), масштаб оборота им ограничен снизу
    // тривиально (оборот >= выплаченный_налог / tax_bps), так что даём
    // щедрый, но конечный потолок.
    let plausible_ceiling = (launch.tax_this_round as u128)
        .saturating_mul(10_000)
        .saturating_div(launch.tax_bps.max(1) as u128)
        .saturating_mul(100); // запас x100 — не точная модель, а страховка от переполнения/абсурда
    require!(
        (composite_score as u128) <= plausible_ceiling || launch.tax_this_round == 0,
        ClenchError::ScoreImplausible
    );

    let race = &mut ctx.accounts.race;
    if composite_score > race.leader_score {
        race.leader = launch.key();
        race.leader_score = composite_score;
    }
    Ok(())
}
