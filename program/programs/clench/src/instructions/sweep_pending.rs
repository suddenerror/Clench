use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction as token_ix;

use crate::errors::ClenchError;
use crate::payout::payout_threshold;
use crate::state::launch::Launch;
use crate::state::pending::Pending;

/// §5 `sweep_pending(owner, asset)`: для края, когда `pending` перевалил
/// порог, но владелец больше нигде не участвует (обычная рассылка его не
/// заденет). Permissionless, кипер обходит раз в сутки (§4).
#[derive(Accounts)]
pub struct SweepPending<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Box<Account<'info, Launch>>,

    #[account(mut, seeds = [Pending::SEED, pending.owner.as_ref(), pending.reward_mint.as_ref()], bump)]
    pub pending: Account<'info, Pending>,

    /// CHECK: получатель (SOL-кошелёк либо владелец ATA под reward_mint).
    #[account(mut, address = pending.owner)]
    pub owner_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub reward_mint_account: Option<Box<InterfaceAccount<'info, Mint>>>,
    /// CHECK: ATA получателя под reward_mint.
    #[account(mut)]
    pub owner_token_account: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token2022>>,

    pub system_program: Program<'info, System>,
}

pub fn sweep_pending_handler(ctx: Context<SweepPending>) -> Result<()> {
    let is_native_sol = ctx.accounts.pending.reward_mint == Pubkey::default();
    let due = ctx.accounts.pending.amount;
    require!(due > 0, ClenchError::NothingToSweep);

    let threshold = if is_native_sol {
        0
    } else {
        let rent_exempt = Rent::get()?.minimum_balance(spl_token_2022::state::Account::LEN);
        payout_threshold(false, rent_exempt, 0)
    };
    require!(due >= threshold, ClenchError::BelowThreshold);

    let launch_key = ctx.accounts.launch.key();
    let mint_key = ctx.accounts.launch.mint;
    let bump = ctx.accounts.launch.bump;
    let signer_seeds: &[&[u8]] = &[Launch::SEED, mint_key.as_ref(), &[bump]];

    if is_native_sol {
        invoke(
            &system_instruction::transfer(&launch_key, &ctx.accounts.pending.owner, due),
            &[ctx.accounts.launch.to_account_info(), ctx.accounts.owner_account.to_account_info()],
        )?;
    } else {
        let vault = ctx.accounts.vault.as_ref().expect("vault required");
        let mint = ctx.accounts.reward_mint_account.as_ref().expect("mint required");
        let owner_ata = ctx.accounts.owner_token_account.as_ref().expect("owner ATA required");
        let token_program = ctx.accounts.token_program.as_ref().expect("token program required");

        invoke_signed(
            &token_ix::transfer_checked(
                &token_program.key(),
                &vault.key(),
                &mint.key(),
                owner_ata.key,
                &launch_key,
                &[],
                due,
                mint.decimals,
            )?,
            &[vault.to_account_info(), mint.to_account_info(), owner_ata.to_account_info(), ctx.accounts.launch.to_account_info()],
            &[signer_seeds],
        )?;
    }

    ctx.accounts.launch.total_owed = ctx.accounts.launch.total_owed.saturating_sub(due);
    ctx.accounts.pending.amount = 0;
    Ok(())
}
