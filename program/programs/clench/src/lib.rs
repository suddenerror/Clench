use anchor_lang::prelude::*;

declare_id!("CLENCHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

// Каркас Фазы 0. Аккаунты и инструкции — с Фазы 2 (см. docs/CLENCH-BUILD-PLAN.md).
#[program]
pub mod clench {
    use super::*;

    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}
