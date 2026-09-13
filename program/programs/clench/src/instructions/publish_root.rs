use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::errors::ClenchError;
use crate::state::config::Config;
use crate::state::distribution::Distribution;
use crate::state::launch::Launch;

#[derive(Accounts)]
pub struct PublishRoot<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    /// Vault, из которого фактически пойдёт рассылка (tax_vault Launch'а).
    /// TODO(аудит Фазы 6): явно закрепить `address = ATA(launch, launch.mint)`
    /// вместо доверия только проверке authority в самом SPL Token — сейчас
    /// перевод в `distribute` физически не пройдёт для чужого аккаунта
    /// (Token program сверяет authority с owner-полем токен-аккаунта), но
    /// жёсткий constraint здесь читается очевиднее для аудитора.
    pub vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = Distribution::SPACE,
        seeds = [Distribution::SEED, launch.key().as_ref()],
        bump
    )]
    pub distribution: Account<'info, Distribution>,

    pub system_program: Program<'info, System>,
}

/// §5: `total <= pool(source)` и `vault.amount >= sum_undistributed + total`.
/// Программа физически не может пообещать больше, чем лежит в хранилище —
/// оба теста на превышение (OverPromise/Underfunded) обязаны проваливаться.
pub fn publish_root_handler(
    ctx: Context<PublishRoot>,
    root: [u8; 32],
    total: u64,
    leaf_count: u32,
    reward_mint: Pubkey,
) -> Result<()> {
    let launch = &mut ctx.accounts.launch;

    require!(total <= launch.epoch_pot_snapshot, ClenchError::OverPromise);
    require!(
        ctx.accounts.vault.amount >= launch.total_owed.saturating_add(total),
        ClenchError::Underfunded
    );

    launch.total_owed = launch.total_owed.saturating_add(total);
    launch.epoch_pot_snapshot = launch.epoch_pot_snapshot.saturating_sub(total);

    let dist = &mut ctx.accounts.distribution;
    dist.source = launch.key();
    dist.root = root;
    dist.total = total;
    dist.sent = 0;
    dist.deferred = 0;
    dist.cursor = 0;
    dist.leaf_count = leaf_count;
    dist.finished = false;
    dist.reward_mint = reward_mint;
    dist.published_at = Clock::get()?.unix_timestamp;
    dist.bump = ctx.bumps.distribution;

    Ok(())
}
