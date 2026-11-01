//! Merkle tree over the payout manifest. It fixes the calculation before any
//! money moves. It does not provide privacy: share counts are public.

use near_sdk::{AccountId, env, near};

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ProofStep {
    pub hash: String,
    /// True when this hash goes on the left of the running hash.
    pub left: bool,
}

pub fn leaf(event_id: &str, holder_id: &AccountId, shares: u64, amount: u128) -> [u8; 32] {
    let line = format!("{event_id}|{holder_id}|{shares}|{amount}");
    let mut data = vec![0u8];
    data.extend_from_slice(line.as_bytes());
    hash(&data)
}

fn hash(data: &[u8]) -> [u8; 32] {
    env::sha256(data).try_into().unwrap()
}

fn parent(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut data = vec![1u8];
    data.extend_from_slice(left);
    data.extend_from_slice(right);
    hash(&data)
}

fn next_level(level: &[[u8; 32]]) -> Vec<[u8; 32]> {
    level
        .chunks(2)
        .map(|pair| match pair {
            [left, right] => parent(left, right),
            [only] => *only,
            _ => unreachable!(),
        })
        .collect()
}

pub fn root(leaves: &[[u8; 32]]) -> [u8; 32] {
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        level = next_level(&level);
    }
    level.first().copied().unwrap_or([0u8; 32])
}

pub fn proof(leaves: &[[u8; 32]], mut index: usize) -> Vec<ProofStep> {
    let mut steps = Vec::new();
    let mut level = leaves.to_vec();
    while level.len() > 1 {
        let sibling = index ^ 1;
        if sibling < level.len() {
            steps.push(ProofStep {
                hash: hex(&level[sibling]),
                left: sibling < index,
            });
        }
        level = next_level(&level);
        index /= 2;
    }
    steps
}

pub fn verify(leaf_hash: [u8; 32], steps: &[ProofStep], expected_root: &str) -> bool {
    let mut current = leaf_hash;
    for step in steps {
        let Some(other) = unhex(&step.hash) else {
            return false;
        };
        current = if step.left {
            parent(&other, &current)
        } else {
            parent(&current, &other)
        };
    }
    hex(&current) == expected_root
}

pub fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 || !value.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}
