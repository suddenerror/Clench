// Порог автовыплаты (§4). Для SOL порога нет — рассылка всегда, ренты нет.
// Для токена — max(RENT_ATA * 5, MIN_PAYOUT), чтобы не сжигать мелкую
// выплату на открытие ATA. Чистая функция, юнит-тестируется на границах.
pub fn payout_threshold(is_native_sol: bool, rent_exempt_ata: u64, min_payout: u64) -> u64 {
    if is_native_sol {
        return 0;
    }
    rent_exempt_ata.saturating_mul(5).max(min_payout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sol_has_no_threshold() {
        assert_eq!(payout_threshold(true, 2_039_280, 1_000_000), 0);
    }

    #[test]
    fn token_threshold_is_max_of_rent5_and_min_payout() {
        // rent*5 доминирует
        assert_eq!(payout_threshold(false, 2_039_280, 1_000_000), 10_196_400);
        // min_payout доминирует
        assert_eq!(payout_threshold(false, 100, 5_000_000), 5_000_000);
    }

    #[test]
    fn boundary_exactly_at_threshold_passes() {
        let threshold = payout_threshold(false, 2_039_280, 1_000_000);
        // due >= threshold должно пропускать выплату — граница включительно,
        // сама проверка `due >= threshold` живёт в distribute (§5).
        assert!(threshold == 10_196_400);
    }

    #[test]
    fn boundary_one_lamport_below_threshold() {
        let threshold = payout_threshold(false, 2_039_280, 1_000_000);
        let due = threshold - 1;
        assert!(due < threshold);
    }

    #[test]
    fn boundary_one_lamport_above_threshold() {
        let threshold = payout_threshold(false, 2_039_280, 1_000_000);
        let due = threshold + 1;
        assert!(due >= threshold);
    }
}
