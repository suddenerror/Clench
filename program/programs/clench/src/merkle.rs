use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

// OpenZeppelin-совместимое дерево, keccak256, отсортированные пары (§7).
pub fn hash_leaf(leaf_index: u32, owner: &Pubkey, amount: u64, streak: u32) -> [u8; 32] {
    let mut data = Vec::with_capacity(4 + 32 + 8 + 4);
    data.extend_from_slice(&leaf_index.to_be_bytes());
    data.extend_from_slice(owner.as_ref());
    data.extend_from_slice(&amount.to_be_bytes());
    data.extend_from_slice(&streak.to_be_bytes());
    keccak::hash(&data).0
}

fn hash_pair(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    if a <= b {
        keccak::hashv(&[&a, &b]).0
    } else {
        keccak::hashv(&[&b, &a]).0
    }
}

pub fn verify(leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    let mut computed = leaf;
    for sibling in proof {
        computed = hash_pair(computed, *sibling);
    }
    computed == root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_leaf_tree_with_empty_proof_matches_root() {
        let leaf = hash_leaf(0, &Pubkey::new_unique(), 1_000, 5);
        assert!(verify(leaf, &[], leaf));
    }

    #[test]
    fn two_leaf_tree_verifies_both_leaves() {
        let owner_a = Pubkey::new_unique();
        let owner_b = Pubkey::new_unique();
        let leaf_a = hash_leaf(0, &owner_a, 1_000, 5);
        let leaf_b = hash_leaf(1, &owner_b, 2_000, 10);
        let root = hash_pair(leaf_a, leaf_b);

        assert!(verify(leaf_a, &[leaf_b], root));
        assert!(verify(leaf_b, &[leaf_a], root));
    }

    #[test]
    fn wrong_proof_fails() {
        let owner_a = Pubkey::new_unique();
        let owner_b = Pubkey::new_unique();
        let owner_c = Pubkey::new_unique();
        let leaf_a = hash_leaf(0, &owner_a, 1_000, 5);
        let leaf_b = hash_leaf(1, &owner_b, 2_000, 10);
        let leaf_c = hash_leaf(2, &owner_c, 3_000, 1);
        let root = hash_pair(leaf_a, leaf_b);

        assert!(!verify(leaf_a, &[leaf_c], root));
    }
}
