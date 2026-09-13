use anchor_lang::prelude::*;

#[error_code]
pub enum ClenchError {
    #[msg("tax_bps must be between 100 and 300 (1%-3%)")]
    InvalidTaxBps,
    #[msg("fee split shares must sum to 10000 bps")]
    InvalidFeeSplit,
    #[msg("epoch has not finished yet")]
    EpochNotFinished,
    #[msg("distribution would promise more than the pool holds (OverPromise)")]
    OverPromise,
    #[msg("vault balance insufficient to cover undistributed + new total (Underfunded)")]
    Underfunded,
    #[msg("leaf is out of order relative to distribution cursor")]
    OutOfOrder,
    #[msg("merkle proof failed to verify against distribution root")]
    InvalidMerkleProof,
    #[msg("distribution is not finished yet")]
    DistributionNotFinished,
    #[msg("sent + deferred does not equal total")]
    DistributionMismatch,
    #[msg("launch mode does not support this instruction")]
    WrongLaunchMode,
    #[msg("transfer fee authority must be revoked in the same instruction")]
    FeeAuthorityNotRevoked,
}
