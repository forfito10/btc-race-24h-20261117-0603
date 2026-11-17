// dip-buy-and-hold: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// The harness sends one hello, then one batch per minute bar, then done. Every order decided on a
// batch fills at the next bar's open, paying a 4 bps fee, 2 bps slippage and constant-product
// impact against that bar's open depth, so a full-size round trip costs tens of basis points:
// churn is expensive and a bot that trades every signal loses to its own fees. This bot therefore
// buys early, holds, and only ever sells on a catastrophe.
//
//   - Entry, in two stages (each buy capped at caps.max_weight_bps of equity via weightRoom):
//       1. the first batch buys 30% of the cash, so part of the exposure rides from the window's
//          second bar;
//       2. the rest is bought on the first dip: on every DIP_EVERY-th batch whose latest close has
//          fallen DIP_BPS below the close the last buy was decided on, it buys all remaining cash.
//          Waiting for a dip averages in rather than chasing. A DEADLINE_BATCH fallback buys the
//          rest by that batch even without a dip: being long beats being precise on a drifting
//          window.
//   - Catastrophe stop: if the account's equity at a close falls below 94% of the peak equity seen
//     so far, the whole position is sold on the next bar. Minute bars wiggle a percent or two a
//     day; a stop this deep only fires when the window is genuinely falling apart, which is
//     exactly when long-only should not be riding. Cash never goes below 0, so the stop can never
//     sink the account.
//   - Re-entry: after the stop has fired, the bot stays out until the latest close is back above
//     the mean of the last REENTER_BARS closes (an integer SMA), then buys all cash again. One
//     round trip costs about 30 bps, so it only wants a recovered trend, not a bounce.
//   - Everything is BigInt math on the u64 quote units the harness sends: no floats, no clocks, no
//     randomness. The same hello and bars always give the same orders, so the two graded runs
//     match byte for byte.

import { BPS, runBars } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FIRST_NUM = 3n; // the first buy takes 3/10 of the cash: 30%
const FIRST_DENOM = 10n;
const DIP_BPS = 8n; // top-up once the latest close is 8 bps under the last buy's close
const DIP_EVERY = 5; // the dip is only checked on every 5th batch
const DEADLINE_BATCH = 120; // buy the rest by this batch even without a dip
const STOP_LEVEL_NUM = 94n; // catastrophe stop: equity under 94% of its peak sells everything
const STOP_LEVEL_DENOM = 100n;
const REENTER_BARS = 120; // re-entry SMA length, in bars
const MAX_SLIPPAGE_BPS = 100; // refuse fills a full percent past the close we decided on

let lastBuyClose: bigint | null = null; // the close the last buy was decided on
let peakEquity: bigint | null = null; // the highest equity seen at any close
let stopped = false; // set once the catastrophe stop has sold
let entered = false; // set once the first buy has been sent

const closes: bigint[] = [];

/** The mean of the last n closes, integer floored, or null before n closes are in. */
function sma(n: number): bigint | null {
  if (closes.length < n) return null;
  let sum = 0n;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / BigInt(n);
}

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);
    if (peakEquity === null || state.equity > peakEquity) peakEquity = state.equity;
    const held = state.positions.get(SYMBOL);
    const hasPosition = held !== undefined && held.qty > 0n;

    // Catastrophe stop: sell the whole position when equity has lost more than its share.
    if (hasPosition && peakEquity !== null && state.equity * STOP_LEVEL_DENOM < peakEquity * STOP_LEVEL_NUM) {
      stopped = true;
      // Rebase the peak to today's equity: the old peak belongs to a regime the bot just left.
      peakEquity = state.equity;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    const room = state.weightRoom(SYMBOL);

    // Entry: 30% on the first batch, then the rest on a dip (or by the deadline batch).
    if (state.cash >= minNotional && !stopped) {
      const onFirst = !entered && state.seq === 0;
      const dipHit =
        entered && state.seq > 0 && state.seq % DIP_EVERY === 0 && lastBuyClose !== null && close * BPS <= lastBuyClose * (BPS - DIP_BPS);
      const deadlineHit = entered && !hasPosition && state.seq >= DEADLINE_BATCH && state.seq % DIP_EVERY === 0;
      if (onFirst || dipHit || deadlineHit) {
        let notional = state.cash;
        if (onFirst) notional = (state.cash * FIRST_NUM) / FIRST_DENOM;
        if (notional > room) notional = room;
        if (notional >= minNotional) {
          entered = true;
          lastBuyClose = close;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }

    // Re-entry after the stop: the trend has to be back above its own mean.
    if (stopped && !hasPosition && state.cash >= minNotional) {
      const mean = sma(REENTER_BARS);
      if (mean !== null && close > mean) {
        const notional = state.cash < room ? state.cash : room;
        if (notional >= minNotional) {
          stopped = false;
          entered = true;
          lastBuyClose = close;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }

    return [];
  },
});
