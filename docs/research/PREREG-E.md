# Decision E study — thresholds derived from volatility, cost and tax instead of fixed 10%. Pre-registered before any result (2026-11-18 ~20:40 KST)

User: "계속 오른다면 팔 이유가 없다. 10%는 너무 naive 하다. 수학적으로 계산해서 그 과정이 진행되게 하라."

## Principles turned into formulas
1. **A move counts only if it is unusual for that asset.** Threshold in volatility units: with σ₆₀ = annualized realized volatility of the last 60 trading days and a 3-month horizon, one unit u = σ₆₀ × √(63/252). Dip step k (k = 1, 2, 3) fires at close ≤ A × exp(−k·z·u), A = average cost of the base position. z is fixed at 1 (one-sigma 3-month move) — not tuned.
2. **Selling must pay for cost and tax.** Proportional cost κ_buy = 0.1%. Selling a position with unrealized gain fraction g = max(0, 1 − A/P) costs κ_sell = 0.1% + 0.22·g (Korean overseas-stock capital-gains tax rate 22%, applied to the gain part). The no-trade band around the target weight w* follows the transaction-cost result δ = (3κ·w*²(1−w*)² / (2γ))^(1/3) (Davis–Norman / Rogers family, leading order), with risk aversion γ implied by the target: γ = (μ−r)/(w*·σ²) using a fixed equity premium μ−r = 4% and the asset's trailing 1-year volatility. Buy when w < w* − δ_buy, sell when w > w* + δ_sell. Because κ_sell grows with the gain, the sell band widens as the asset rises: "it keeps rising → no reason to sell" falls out of the formula instead of being assumed.
3. **Dip lots are sold only above their own anchor** (user's rule, PREREG-D): when close ≥ A the dip lots are sold; the base is never sold for being above cost.

## Rules (fixed now)
- H: hold + immediate contributions (baseline).
- RB: fixed band 65–95% around 80% (PREREG-D's RB, for comparison).
- NT: no-trade band from principle 2 (tax-asymmetric, volatility-implied γ), rebalance to w* = 80% only when the band is left.
- V1: volatility-scaled anchor ladder (principle 1, z = 1), dip lots sold at A; contributions to the base; reserve 20% of start.
- V2: V1 with z = 1.645 (one-sided 5% quantile of a normal 3-month move) — the only second value, fixed now; whichever of V1/V2 is better is reported, neither is tuned further.
- F: VIX ladder (adopted rule) for US assets.

## Assets, measures, decision rule
As PREREG-D (3 indexes, 20 stocks, PLTR/TEM reference; monthly contribution 1% of start; rolling 10-year windows; 70%-of-windows rule; median stock not worse than −2%/yr). In addition, for NT report how often the sell side fires and the median realized gain fraction at those sells, so the tax asymmetry is visible.

## Output for the real account
For each current holding and the two core ETFs: σ₆₀, the derived dip steps (as % below average cost), the no-trade band half-widths δ_buy / δ_sell (in percentage points of total), with the current gain fraction g. These numbers, not 10%, go into the module.
