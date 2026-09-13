use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::extension::transfer_fee::instruction as fee_ix;
use spl_token_2022::instruction as token_ix;

use crate::state::launch::Launch;

#[derive(Accounts)]
pub struct HarvestTax<'info> {
    /// Permissionless — любой может дёрнуть (кипер, Фаза 4).
    pub caller: Signer<'info>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    // Boxed — иначе try_accounts с пятью InterfaceAccount<...> под Token-2022
    // (с расширениями) превышает лимит стека SBF (4096 байт).
    #[account(mut, address = launch.mint)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// ATA под минт, owner = launch PDA — сюда стекается withheld fee перед сплитом.
    #[account(mut)]
    pub tax_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub keeper_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
    // remaining_accounts: список токен-аккаунтов, с которых собирается withheld fee
    // в минт (harvest_withheld_tokens_to_mint) перед withdraw.
}

/// Забор, сплит по fee_split и запись `tax_this_epoch` — одной инструкцией (§5).
/// Anchor откатывает всю инструкцию при провале любой CPI, так что рассинхрон
/// между сбором и записью счёта невозможен по конструкции — отдельного
/// «двухфазного» коммита не требуется.
pub fn harvest_tax_handler<'info>(ctx: Context<'_, '_, '_, 'info, HarvestTax<'info>>) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let token_program_id = ctx.accounts.token_program.key();

    let source_infos: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
    if !source_infos.is_empty() {
        let mut accounts = vec![ctx.accounts.mint.to_account_info()];
        accounts.extend(source_infos.iter().cloned());
        let source_keys: Vec<&Pubkey> = source_infos.iter().map(|a| a.key).collect();
        anchor_lang::solana_program::program::invoke(
            &fee_ix::harvest_withheld_tokens_to_mint(&token_program_id, &mint_key, &source_keys)?,
            &accounts,
        )?;
    }

    let balance_before = ctx.accounts.tax_vault.amount;

    let launch_key = ctx.accounts.launch.key();
    let bump = ctx.accounts.launch.bump;
    let signer_seeds: &[&[u8]] = &[Launch::SEED, mint_key.as_ref(), &[bump]];

    invoke_signed(
        &fee_ix::withdraw_withheld_tokens_from_mint(
            &token_program_id,
            &mint_key,
            &ctx.accounts.tax_vault.key(),
            &launch_key,
            &[],
        )?,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.tax_vault.to_account_info(),
            ctx.accounts.launch.to_account_info(),
        ],
        &[signer_seeds],
    )?;

    ctx.accounts.tax_vault.reload()?;
    let harvested = ctx.accounts.tax_vault.amount.saturating_sub(balance_before);
    if harvested == 0 {
        return Ok(());
    }

    let fee_split = ctx.accounts.launch.fee_split;
    let treasury_amount = (harvested as u128 * fee_split.treasury_bps as u128 / 10_000) as u64;
    let keeper_amount = (harvested as u128 * fee_split.keeper_bps as u128 / 10_000) as u64;
    let creator_amount = (harvested as u128 * fee_split.creator_bps as u128 / 10_000) as u64;
    // holders_bps остаётся в tax_vault — это пул текущей эпохи, публикуется
    // и раздаётся через close_epoch → publish_root → distribute.
    let holders_amount = harvested
        .saturating_sub(treasury_amount)
        .saturating_sub(keeper_amount)
        .saturating_sub(creator_amount);

    let decimals = ctx.accounts.mint.decimals;

    let transfer = |amount: u64, destination: &AccountInfo<'info>| -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        invoke_signed(
            &token_ix::transfer_checked(
                &token_program_id,
                &ctx.accounts.tax_vault.key(),
                &mint_key,
                destination.key,
                &launch_key,
                &[],
                amount,
                decimals,
            )?,
            &[
                ctx.accounts.tax_vault.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                destination.clone(),
                ctx.accounts.launch.to_account_info(),
            ],
            &[signer_seeds],
        )?;
        Ok(())
    };

    transfer(treasury_amount, &ctx.accounts.treasury_token_account.to_account_info())?;
    transfer(keeper_amount, &ctx.accounts.keeper_token_account.to_account_info())?;
    transfer(creator_amount, &ctx.accounts.creator_token_account.to_account_info())?;

    ctx.accounts.launch.tax_this_epoch = ctx.accounts.launch.tax_this_epoch.saturating_add(holders_amount);
    ctx.accounts.launch.tax_this_round = ctx.accounts.launch.tax_this_round.saturating_add(holders_amount);
    ctx.accounts.launch.lifetime_tax_collected =
        ctx.accounts.launch.lifetime_tax_collected.saturating_add(harvested);

    let _ = balance_before; // читаемость: явно показываем, что это дельта, а не абсолют
    Ok(())
}
