# Decision D study — anchor = my average cost: buy below it, sell the dip lots only above it; with monthly contributions. Pre-registered before any result (2026-11-18 ~19:50 KST)

User's correction: "떨어졋을 때 산 몫은 되돌아왔다고 파는 게 아니라 원래 가지고 있던 값보다 올랐을 때 파는 게 맞다. 적립도 같이 한다. 그걸 다 넣고 어떤 전략이 나은지 정하라."

## Setup (every rule)
- One asset + cash. Start 80% asset / 20% reserve. Monthly contribution = 1% of the starting wealth, on the first trading day of each month (the same cash flow in every rule). Cash earns 2%/yr. Fills at the next day's open, 0.1% cost per trade. Terminal wealth is compared with identical contributions, so wealth ratios are fair.
- Anchor A = volume-weighted average cost of the base position (initial buy + contributions that went into the asset). Dip lots are tracked separately and never change A.

## Rules (fixed now)
- H: hold; every contribution buys the asset immediately; the reserve never moves (the baseline the user already follows with the DCA module).
- RB: H plus band rebalancing of asset weight to 80% when it leaves 65–95% (sells winners, buys losers, no anchor).
- D1 anchor ladder, sell at anchor: close ≤ A×0.9 / 0.8 / 0.7 → buy 1/3 of the reserve each (once per episode) as dip lots; when close ≥ A sell all dip lots (profit on the lots, A untouched); the episode then resets. Contributions buy the base at market.
- D2 same as D1 but the dip lots are sold at A×1.1 (the user's "원래 값보다 올랐을 때").
- D3 D2 plus a contribution tilt: when close < A the monthly money is doubled (the extra from the reserve, while it lasts); when close > A×1.2 the monthly money goes to the reserve instead of the asset (the "don't buy expensive" intuition).
- D4 D2 plus profit-taking on the base: close ≥ A×1.3 → sell 10% of the base (A stays), at most once per 60 trading days.
- F (adopted rule, US indexes only): VIX ladder 30/40/50 with refill at a new all-time high (decision 46), contributions to the base.

## Assets
Indexes: S&P 500 total return 1990–, Nasdaq-100 1990–, KOSPI 1997–. Stocks (≥15y, survivors — bias stated): AAPL MSFT AMZN GOOGL NVDA JPM JNJ XOM PG KO INTC CSCO GE F PFE WMT 005930 000660 005380 035420. Reference only: PLTR, TEM.

## Measures
Whole period: terminal wealth vs H, CAGR of wealth (contributions included, so a descriptive number only), max drawdown of wealth, trades. Rolling 10-year windows from each January: share beating H. First/second half vs H.

## Decision rule (fixed now)
Same as PREREG-C: a rule is adopted for a group only if it beats H in ≥70% of rolling 10-year windows in every index (index group) or in ≥70% of the stocks (stock group), beats H in both halves (median of stocks), and the median terminal-wealth loss vs H is not worse than −2%/yr equivalent. A rule that only lowers drawdown is reported, not adopted. Nothing is tuned after seeing results.
