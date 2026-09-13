use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_token_2022::instruction as token_ix;

use crate::errors::ClenchError;
use crate::merkle;
use crate::payout::payout_threshold;
use crate::state::config::Config;
use crate::state::distribution::Distribution;
use crate::state::launch::Launch;
use crate::state::pending::Pending;

/// Один лист за один вызов. Спека пакует `leaves[]`/`proofs[]` в одну
/// инструкцию — здесь это делается пакетом ОТДЕЛЬНЫХ вызовов `distribute`
/// внутри одной транзакции (Solana допускает несколько инструкций на
/// транзакцию), что и даёт бюджет ~18 на транзакцию из §4 спеки.
#[derive(Accounts)]
#[instruction(leaf_index: u32, owner: Pubkey, amount: u64, streak: u32, proof: Vec<[u8; 32]>)]
pub struct Distribute<'info> {
    /// Permissionless, но платит за возможный init_if_needed Pending.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [Launch::SEED, launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, Launch>,

    #[account(mut, seeds = [Distribution::SEED, launch.key().as_ref()], bump = distribution.bump)]
    pub distribution: Account<'info, Distribution>,

    #[account(
        init_if_needed,
        payer = caller,
        space = Pending::SPACE,
        seeds = [Pending::SEED, owner.as_ref(), distribution.reward_mint.as_ref()],
        bump
    )]
    pub pending: Account<'info, Pending>,

    /// CHECK: получатель — либо системный кошелёк (SOL), либо владелец ATA (токен);
    /// адрес заранее известен из листа, здесь только для CPI-переводов.
    #[account(mut, address = owner)]
    pub owner_account: UncheckedAccount<'info>,

    // --- Только для токен-пути (reward_mint != default) ---
    // Boxed: без этого try_accounts превышает лимит стека SBF (4096 байт) —
    // Option<InterfaceAccount<...>> кладёт данные аккаунта в стек фрейма,
    // Box переносит их в кучу.
    #[account(mut)]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub reward_mint_account: Option<Box<InterfaceAccount<'info, Mint>>>,
    /// CHECK: ATA получателя под reward_mint; создаётся при необходимости в хендлере.
    #[account(mut)]
    pub owner_token_account: Option<UncheckedAccount<'info>>,
    pub token_program: Option<Program<'info, Token2022>>,

    pub system_program: Program<'info, System>,
}

pub fn distribute_handler(
    ctx: Context<Distribute>,
    leaf_index: u32,
    owner: Pubkey,
    amount: u64,
    streak: u32,
    proof: Vec<[u8; 32]>,
) -> Result<()> {
    let dist = &mut ctx.accounts.distribution;

    // Найдено аудитом Фазы 6: challenge_window (§4/§6 — «час на то, чтобы
    // кто-то пересчитал листья и поймал расхождение») существовал в Config,
    // но никогда не проверялся здесь. Без этой проверки заявленная в спеке
    // митигация для «Индексер считает неправильно» была фиктивной.
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= dist.published_at + ctx.accounts.config.challenge_window,
        ClenchError::ChallengeWindowNotElapsed
    );

    require!(leaf_index == dist.cursor, ClenchError::OutOfOrder);

    let leaf = merkle::hash_leaf(leaf_index, &owner, amount, streak);
    require!(merkle::verify(leaf, &proof, dist.root), ClenchError::InvalidMerkleProof);

    let is_native_sol = dist.reward_mint == Pubkey::default();
    let pending = &mut ctx.accounts.pending;
    let due = amount.saturating_add(pending.amount);

    let threshold = if is_native_sol {
        0
    } else {
        let rent_exempt = Rent::get()?.minimum_balance(spl_token_2022::state::Account::LEN);
        payout_threshold(false, rent_exempt, 0)
    };

    if due >= threshold {
        if is_native_sol {
            invoke(
                &system_instruction::transfer(&ctx.accounts.launch.key(), &owner, due),
                &[ctx.accounts.launch.to_account_info(), ctx.accounts.owner_account.to_account_info()],
            )?;
        } else {
            let vault = ctx.accounts.vault.as_ref().expect("vault required for token payout");
            let mint = ctx.accounts.reward_mint_account.as_ref().expect("reward mint required");
            let owner_ata = ctx.accounts.owner_token_account.as_ref().expect("owner ATA required");
            let token_program = ctx.accounts.token_program.as_ref().expect("token program required");

            let launch_key = ctx.accounts.launch.key();
            let mint_key = ctx.accounts.launch.mint;
            let bump = ctx.accounts.launch.bump;
            let signer_seeds: &[&[u8]] = &[Launch::SEED, mint_key.as_ref(), &[bump]];

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
                &[
                    vault.to_account_info(),
                    mint.to_account_info(),
                    owner_ata.to_account_info(),
                    ctx.accounts.launch.to_account_info(),
                ],
                &[signer_seeds],
            )?;
        }

        pending.owner = owner;
        pending.reward_mint = dist.reward_mint;
        pending.amount = 0;
        dist.sent = dist.sent.saturating_add(due);
        ctx.accounts.launch.total_owed = ctx.accounts.launch.total_owed.saturating_sub(due);
    } else {
        pending.owner = owner;
        pending.reward_mint = dist.reward_mint;
        pending.amount = due;
        dist.deferred = dist.deferred.saturating_add(amount);
    }

    dist.cursor += 1;
    Ok(())
}
