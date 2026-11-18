# Decision C study — "buy more as it falls, sell more as it rises" ladder rules. Pre-registered before any result (2026-11-18 ~19:10 KST)

User's words: "10만 원짜리가 9만 원이 되면 20% 팔고, 더 떨어지면 추가 구매를 고민하고, 심각하게 떨어졌으면 변동성 이슈로 구매를 보류한다. 떨어질수록 추가 구매, 올라갈수록 추가 판매 규칙이 필요하다. 금액 상한이 아니라 전략으로 판다."

Question: do price-ladder rules of this kind beat holding (and plain band rebalancing) on indexes and on single stocks?

## Setup (same for every rule)
- One asset + cash. Start 60% asset / 40% cash so both buying and selling have room. Cash earns 2%/yr flat. Fills at the next day's open, 0.1% cost per trade. No new money.
- Reference price = the price at the last trade (initially the start price). Severity gate = 20-day realized volatility above 2× the trailing 1-year median of 20-day volatility.

## Rules (fixed now)
- H: hold 60/40, never trade.
- RB: band rebalancing — if the asset weight leaves 45–75%, rebalance back to 60%.
- GRID: contrarian ladder — close ≤ ref × 0.9 → buy 20% of the current position value (limited by cash); close ≥ ref × 1.1 → sell 20% of the position. Reference moves to the trade price.
- GRIDV: GRID, but a buy is skipped while the severity gate is on (the user's "변동성 이슈면 보류").
- TRIM: the user's example — first close ≤ ref × 0.9 → sell 20% (loss cut); after that each further −10% from the last trade price → buy 20% of the position unless the severity gate is on; each +10% → sell 20%; when the price closes above the original reference × 1.1 the state resets (reference = that close).

## Assets
Indexes: S&P 500 total return (1990–), Nasdaq-100 (1990–), KOSPI (1997–).
Single stocks with ≥ 15 years of history (survivors — a bias toward winners, stated): AAPL MSFT AMZN GOOGL NVDA JPM JNJ XOM PG KO INTC CSCO GE F PFE WMT; Korea 005930 000660 005380 035420. Short history (information only, no verdict): PLTR, TEM.

## Measures
Whole period: CAGR and max drawdown vs H and vs RB; trades. Rolling 10-year windows from each January: share of windows beating H. First / second half vs H.

## Decision rule (fixed now)
A ladder rule is adopted for a group (indexes; single stocks) only if it beats H in ≥ 70% of rolling 10-year windows in every index (for the index group) or in at least 70% of the single stocks (for the stock group), and beats H in both halves of the pooled stock set, and does not lose more than 2%/yr CAGR vs H in the median asset. Otherwise the module's selling stays "to the target plan with a band" (RB-style) plus the fear-ladder refill, with no price-ladder trading. Results are reported either way; nothing is tuned after seeing them.
