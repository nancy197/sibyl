/// Sibyl forecast ledger.
///
/// Every minute Sibyl locks the forecasts made in that window, builds a
/// Merkle tree over them and anchors the 32-byte root here. Anyone can then
/// prove a forecast existed before its event expired by checking the
/// Merkle path against the root in the `Anchored` event.
module sibyl::ledger;

use sui::clock::Clock;
use sui::event;

/// The window has not closed yet, so it could still change.
const EWindowNotClosed: u64 = 0;
/// The window must have a positive length.
const EInvalidWindow: u64 = 1;
/// Roots are sha256 digests.
const EInvalidRoot: u64 = 2;

/// Emitted once per anchored window.
public struct Anchored has copy, drop {
    root: vector<u8>,
    count: u64,
    window_start_ms: u64,
    window_end_ms: u64,
    sender: address,
}

/// Anchor the Merkle root of the forecasts locked in [window_start_ms, window_end_ms).
public fun anchor(
    root: vector<u8>,
    count: u64,
    window_start_ms: u64,
    window_end_ms: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(window_start_ms < window_end_ms, EInvalidWindow);
    assert!(clock.timestamp_ms() >= window_end_ms, EWindowNotClosed);
    assert!(root.length() == 32, EInvalidRoot);
    event::emit(Anchored { root, count, window_start_ms, window_end_ms, sender: ctx.sender() });
}

#[test]
fun anchors_closed_window() {
    let mut ctx = tx_context::dummy();
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(2_000);
    let mut root = vector[];
    32u64.do!(|_| root.push_back(7u8));
    anchor(root, 3, 0, 1_000, &clock, &ctx);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = EWindowNotClosed)]
fun rejects_open_window() {
    let mut ctx = tx_context::dummy();
    let clock = sui::clock::create_for_testing(&mut ctx);
    let mut root = vector[];
    32u64.do!(|_| root.push_back(7u8));
    anchor(root, 3, 0, 1_000, &clock, &ctx);
    clock.destroy_for_testing();
}
