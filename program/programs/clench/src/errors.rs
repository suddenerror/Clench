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

    // Фаза 3 — турнир и OG.
    #[msg("ticker/name hash does not match between the two launches")]
    NoMatch,
    #[msg("launch already has the OG plaque")]
    AlreadyOg,
    #[msg("launch lost a tournament and can never claim OG for this pair")]
    OgBarred,
    #[msg("launch is already attached to a race")]
    AlreadyInRace,
    #[msg("launch has not crossed VOLUME_FLOOR yet")]
    VolumeFloorNotCrossed,
    #[msg("launch is not attached to this race")]
    NotInThisRace,
    #[msg("join window (first two rounds) has closed")]
    JoinWindowClosed,
    #[msg("ticker/name pair is already locked to an OG launch")]
    TickerLocked,
    #[msg("composite score exceeds the plausible ceiling for this round")]
    ScoreImplausible,
    #[msg("round has not finished yet")]
    RoundNotFinished,
    #[msg("race has already reached its round target — call settle_race")]
    RaceNotYetSettleable,
    #[msg("race is not in a state that can be settled")]
    RaceNotSettleable,
    #[msg("race has not been settled yet")]
    RaceNotSettled,
    #[msg("this launch is the race winner, not a loser")]
    NotALoser,
    #[msg("launch has not crossed the OG floors (volume/holders/mcap)")]
    OgFloorNotCrossed,
    #[msg("launch already has an active, unresolved race")]
    RaceStillRunning,

    // Фаза 4 — кипер.
    #[msg("pending balance is empty, nothing to sweep")]
    NothingToSweep,
    #[msg("pending balance is still below the payout threshold")]
    BelowThreshold,

    // Фаза 6 — аудит.
    #[msg("challenge window has not elapsed since publish_root")]
    ChallengeWindowNotElapsed,
}
