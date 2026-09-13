use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_2022::Token2022;
use spl_token_2022::extension::ExtensionType;
use spl_token_2022::instruction as token_ix;
use spl_token_2022::extension::transfer_fee::instruction as fee_ix;

use crate::errors::ClenchError;
use crate::state::config::FeeSplit;
use crate::state::launch::{Launch, LaunchMode};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateLaunchArgs {
    pub name: [u8; 32],
    pub ticker: [u8; 16],
    pub tax_bps: u16,
    pub decimals: u8,
    pub mode: LaunchMode,
    pub competitive: bool,
    pub reward_assets: [Pubkey; 5],
    pub reward_weights: [u16; 5],
}

#[derive(Accounts)]
pub struct CreateLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: свежий keypair минта, инициализируется вручную в хендлере
    /// (расширения Token-2022 не создать через `#[account(init, mint::…)]`).
    #[account(mut)]
    pub mint: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = Launch::SPACE,
        seeds = [Launch::SEED, mint.key().as_ref()],
        bump
    )]
    pub launch: Account<'info, Launch>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn create_launch_handler(ctx: Context<CreateLaunch>, args: CreateLaunchArgs) -> Result<()> {
    require!(args.tax_bps >= 100 && args.tax_bps <= 300, ClenchError::InvalidTaxBps);

    let fee_split = match args.mode {
        LaunchMode::Standard => FeeSplit::standard_default(),
        LaunchMode::Reward | LaunchMode::Competitive => FeeSplit::reward_default(),
    };
    require!(fee_split.is_valid(), ClenchError::InvalidFeeSplit);

    let launch_key = ctx.accounts.launch.key();
    let mint_key = ctx.accounts.mint.key();
    let mint_ai = ctx.accounts.mint.to_account_info();
    let token_program_id = ctx.accounts.token_program.key();

    // 1. Аккаунт минта с местом под расширение TransferFeeConfig.
    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[
        ExtensionType::TransferFeeConfig,
    ])
    .map_err(|_| error!(ClenchError::InvalidFeeSplit))?;
    let rent_lamports = Rent::get()?.minimum_balance(space);

    invoke(
        &system_instruction::create_account(
            &ctx.accounts.creator.key(),
            &mint_key,
            rent_lamports,
            space as u64,
            &token_program_id,
        ),
        &[ctx.accounts.creator.to_account_info(), mint_ai.clone(), ctx.accounts.system_program.to_account_info()],
    )?;

    // 2. Инициализация расширения ДО initialize_mint2 (требование Token-2022).
    // Authority на fee-конфиг и withdraw временно = Launch PDA, чтобы иметь
    // право её тут же отозвать (шаг 4) — после этого шага её нет ни у кого.
    invoke(
        &fee_ix::initialize_transfer_fee_config(
            &token_program_id,
            &mint_key,
            Some(&launch_key),
            Some(&launch_key),
            args.tax_bps,
            u64::MAX,
        )?,
        &[mint_ai.clone()],
    )?;

    // 3. Обычная инициализация минта. Mint authority временно = creator —
    // бондинг-кривая/пул (эмиссия и её передача пулу) вне скоупа Фазы 2,
    // это разовый выпуск под тесты; см. docs/CLENCH-BUILD-PLAN.md §2.1.
    invoke(
        &token_ix::initialize_mint2(&token_program_id, &mint_key, &ctx.accounts.creator.key(), None, args.decimals)?,
        &[mint_ai.clone()],
    )?;

    // 4. Необратимость: authority на transfer-fee отзывается в этой же
    // транзакции создания (§5). Подписываем сидами Launch PDA.
    let bump = ctx.bumps.launch;
    let signer_seeds: &[&[u8]] = &[Launch::SEED, mint_key.as_ref(), &[bump]];
    invoke_signed(
        &token_ix::set_authority(
            &token_program_id,
            &mint_key,
            None,
            spl_token_2022::instruction::AuthorityType::TransferFeeConfig,
            &launch_key,
            &[],
        )?,
        &[mint_ai.clone(), ctx.accounts.launch.to_account_info()],
        &[signer_seeds],
    )?;

    let launch = &mut ctx.accounts.launch;
    launch.mint = mint_key;
    launch.pool = Pubkey::default(); // бондинг-кривая/пул — вне скоупа Фазы 2
    launch.creator = ctx.accounts.creator.key();
    launch.name = args.name;
    launch.ticker = args.ticker;
    launch.mode = args.mode;
    launch.tax_bps = args.tax_bps;
    launch.reward_assets = args.reward_assets;
    launch.reward_weights = args.reward_weights;
    launch.fee_split = fee_split;
    launch.excluded = [Pubkey::default(); 8];
    launch.race = None;
    launch.competitive = args.competitive;
    launch.is_og = false;
    launch.og_barred = false;
    let now = Clock::get()?.unix_timestamp;
    launch.born_at = now;
    launch.epoch_started_at = now;
    launch.tax_this_round = 0;
    launch.tax_this_epoch = 0;
    launch.epoch_pot_snapshot = 0;
    launch.epoch_index = 0;
    launch.total_owed = 0;
    launch.tax_vault_bump = 0;
    launch.bump = bump;

    Ok(())
}
