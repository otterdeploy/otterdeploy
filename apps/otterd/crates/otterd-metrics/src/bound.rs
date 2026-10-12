//! The per-node dimension bound.
//!
//! The control plane accepts at most 16 dimension series per node besides the
//! host itself, and refuses the rest. The node must not produce that
//! cardinality in the first place, so the collector applies the same bound
//! at the source, deterministically: the same devices are chosen every round
//! while the set of devices does not change.

/// Choose at most `max` items from the per-kind candidate lists, taking one
/// from each kind in turn, so one kind with many members (a ZFS pool with
/// hundreds of datasets) cannot starve the others. Each list must already be
/// in the caller's priority order. Returns the chosen items per kind and how
/// many were left out.
pub(crate) fn round_robin<T, const K: usize>(
    kinds: [Vec<T>; K],
    max: usize,
) -> ([Vec<T>; K], usize) {
    let total: usize = kinds.iter().map(Vec::len).sum();
    let mut iters = kinds.map(Vec::into_iter);
    let mut chosen: [Vec<T>; K] = std::array::from_fn(|_| Vec::new());
    let mut taken = 0;
    'outer: loop {
        let mut progressed = false;
        for (iter, out) in iters.iter_mut().zip(chosen.iter_mut()) {
            if taken == max {
                break 'outer;
            }
            if let Some(item) = iter.next() {
                out.push(item);
                taken += 1;
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
    (chosen, total - taken)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn one_large_kind_does_not_starve_the_others() {
        let fs: Vec<u32> = (0..100).collect();
        let disks = vec![1000, 1001];
        let ifs = vec![2000];
        let ([f, d, i], dropped) = round_robin([fs, disks, ifs], 16);
        assert_eq!(d, [1000, 1001]);
        assert_eq!(i, [2000]);
        assert_eq!(f, (0..13).collect::<Vec<_>>());
        assert_eq!(dropped, 103 - 16);
    }

    proptest! {
        #[test]
        fn never_exceeds_the_bound_and_accounts_for_everything(
            a in proptest::collection::vec(any::<u8>(), 0..40),
            b in proptest::collection::vec(any::<u8>(), 0..40),
            c in proptest::collection::vec(any::<u8>(), 0..40),
            max in 0usize..40,
        ) {
            let lens = [a.len(), b.len(), c.len()];
            let (chosen, dropped) = round_robin([a.clone(), b, c], max);
            let kept: usize = chosen.iter().map(Vec::len).sum();
            prop_assert!(kept <= max);
            prop_assert_eq!(kept + dropped, lens.iter().sum::<usize>());
            // each kind keeps a prefix of its own priority order
            prop_assert_eq!(&chosen[0][..], &a[..chosen[0].len()]);
            // no kind is short while another kind still had items and the bound was not reached
            if kept < max {
                prop_assert_eq!(dropped, 0);
            }
        }
    }
}
