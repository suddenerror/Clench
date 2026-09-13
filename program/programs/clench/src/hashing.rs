use anchor_lang::solana_program::keccak;

/// §5, дословно: trim, срезать ведущий `$`, uppercase, оставить только ASCII-алфанумерику.
/// Гомоглифы не склеиваются намеренно (кириллическая `Е` — не latin `E`).
pub fn norm(s: &str) -> String {
    let trimmed = s.trim();
    let stripped = trimmed.strip_prefix('$').unwrap_or(trimmed);
    stripped
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// name/ticker хранятся как fixed-size `[u8; N]` (нулями дополненные) — обрезаем
/// нули и трактуем как UTF-8 (lossy на случай мусора, некритично для нормализации).
pub fn bytes_to_str(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

pub fn ticker_hash(ticker: &[u8]) -> [u8; 32] {
    keccak::hash(norm(&bytes_to_str(ticker)).as_bytes()).0
}

pub fn name_hash(name: &[u8]) -> [u8; 32] {
    keccak::hash(norm(&bytes_to_str(name)).as_bytes()).0
}

pub fn pair_hash(name: &[u8], ticker: &[u8]) -> [u8; 32] {
    let mut data = norm(&bytes_to_str(name)).into_bytes();
    data.push(0u8);
    data.extend(norm(&bytes_to_str(ticker)).into_bytes());
    keccak::hash(&data).0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticker_case_and_dollar_variants_match() {
        let a = ticker_hash(b"$PEPE\0\0\0\0\0\0\0\0\0\0\0");
        let b = ticker_hash(b"pepe\0\0\0\0\0\0\0\0\0\0\0\0");
        let c = ticker_hash(b"PEPE \0\0\0\0\0\0\0\0\0\0\0");
        assert_eq!(a, b);
        assert_eq!(b, c);
    }

    #[test]
    fn cyrillic_homoglyph_does_not_match_latin() {
        // "РЕРЕ" с кириллическими Р/Е против latin "PEPE".
        let latin = ticker_hash("PEPE".as_bytes());
        let cyrillic = ticker_hash("РЕРЕ".as_bytes());
        assert_ne!(latin, cyrillic);
    }

    #[test]
    fn name_and_ticker_hashes_are_independent() {
        let name = name_hash(b"Pepe the Frog");
        let ticker = ticker_hash(b"PEPE");
        assert_ne!(name, ticker);
    }

    #[test]
    fn pair_hash_distinguishes_same_name_different_ticker() {
        let a = pair_hash(b"Pepe the Frog", b"PEPE");
        let b = pair_hash(b"Pepe the Frog", b"FROG");
        assert_ne!(a, b);
    }
}
