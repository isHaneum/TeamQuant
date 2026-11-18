# Decision B study — 200-day trend rule vs fear ladder (S3) on the core index. Pre-registered before any result (2026-11-18 ~15:30 KST)

Question: the mock account applies a 200-day rule to the core index (close < 200-day average → index weight 0) AND the fear ladder (decision 46, rule S3). In a VIX ≥ 30 regime the index is usually below its 200-day average, so the two rules collide. Which combination should the core index use?

## Setup (same engine as PREREG.md S3, refill mode)
- Start 80% index / 20% reserve in cash; cash earns the 13-week T-bill (US) or 2.5%/yr (KOSPI, S&P in KRW). Fills at the next day's open, 0.1% cost per trade. No new money.
- Trend signal: the index's own close vs its 200-day simple moving average. Trades only when the state changes (no daily rebalancing). At a window start, if the index is below the average the trend variants move to their "below" exposure at the first open.
- Fear ladder: 1/3 of the reserve at VIX close ≥ 30, ≥ 40, ≥ 50, once per episode; episode ends at a new all-time high, where the position is rebalanced back to 80/20 (refill).

## Variants (fixed now)
- V0 = adopted rule: S3 with refill, no trend rule (decision 46 as tested).
- V1 = trend only, index 80% ↔ 0% on the 200-day cross; no fear buys. This is also what option (c) "trend wins" produces: a fear tranche bought below the average is sold again by the trend rule.
- V3 = trend + S3 with fear override (option (a)): while a fear step is active the trend rule is ignored — at the first step the full 80% core is re-bought plus the tranche; later steps add tranches; the trend rule resumes after the refill at a new high.
- V5 = half trend (the "dynamic sizing" idea from the external review): 80% above the average, 40% below; no fear buys.
- V6 = half trend + S3 with fear override.
Option (b) "remove the trend rule from the core index" is V0 itself.

## Markets
S&P 500 total return 1990–2026, Nasdaq-100 1990–2026, KOSPI 1997–2026 (VIX of the previous US session as the fear gauge), S&P 500 in KRW 2004–2026.

## Measures
Whole period CAGR, max drawdown, number of trades; terminal wealth vs V0. Rolling 10-year windows starting each January: share of windows beating V0, median and worst excess vs V0. First half / second half vs V0.

## Decision rule (fixed now)
A trend variant replaces V0 only if, in every market: it beats V0 in ≥ 70% of rolling 10-year windows, beats V0 in both halves, and does not lose more than 2%/yr CAGR vs V0 in the whole period. If no variant passes, the core index keeps V0 and the 200-day rule is removed from the core index (option b). If a variant passes, report its max-drawdown change as well; a variant that only reduces drawdown but fails the wealth tests is reported, not adopted. No threshold is tuned after seeing results.
