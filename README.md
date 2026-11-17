[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/forfito10/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/forfito10/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# dip-buy-and-hold

A long-only cbBTC/USDC trading bot for the make.fun competition
[btc-race-24h-20261117-0603](https://make.fun/bounty/btc-race-24h-20261117-0603)
(harness `agent-fun/bars-replay/v1`, Node 22 runtime).

## Strategy

Trading one-minute bars with ~26 bps of round-trip cost (4 bps fee, 2 bps slippage,
constant-product price impact), high-frequency signals lose to their own fees. This bot
therefore trades rarely:

1. **Two-stage entry** — 30% of cash buys on the first batch; the rest buys on the first dip
   (a close 8 bps under the close the last buy was decided on, checked every 5th batch), with a
   deadline fallback that is fully invested by batch 120 either way.
2. **Hold** — the position rides the window. Cash earns nothing; being long on a drifting window
   beats being clever.
3. **Catastrophe stop** — if equity falls below 94% of its peak, everything is sold and the peak
   is rebased. Minute bars wiggle a percent or two a day; a stop this deep only fires when the
   window is genuinely falling apart, which is exactly when long-only should not be riding.
4. **Re-entry** — after a stop, the bot waits until the close is back above the 120-bar mean of
   closes before buying again.

Everything is BigInt math on the harness's u64 quote units: no floats, no clocks, no randomness,
so two runs on the same bars produce byte-identical action logs.

On the published dev window (1,440 one-minute bars) it grades:

| metric | value |
| --- | --- |
| net PnL | +3.28 USDC |
| trades | 2 |
| max drawdown | 2.1% |
| guardrails (>=1 trade, dd <= 25%) | met |

## Run

The grader runs `node /bot/main.ts` with this repository mounted at `/bot`. Locally, from an
unpacked kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, runs as `node /bot/main.ts`).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim (`sdk/makefun-bars.ts`).

## License

MIT — see `LICENSE` (`SPDX-License-Identifier: MIT`).
