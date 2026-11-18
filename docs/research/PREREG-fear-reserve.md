# Dip-reserve rule study — pre-registered before any result was computed (2026-11-17 ~16:00 KST)

User request: keep spare cash aside; when the market falls sharply on fear / emotional selling, buy more, in steps, because it can fall further. Analyse, set criteria, make it buyable.

## Setup (same for every rule)
- Start: 80% in the index, 20% reserve in cash. No new money. Cash earns the 13-week T-bill (^IRX) for US markets, 2.5%/yr for KOSPI.
- Fills at the next day's open, 0.1% cost per trade. A drawdown "episode" runs from a fall below the all-time high until a new all-time high.
- Two refill modes: (a) no refill — deployed money stays invested; (b) refill — at the first new all-time high after a deployment, rebalance back to 80/20.

## Rules (fixed now; thresholds are round numbers from practice, not fitted)
- S0 all-in: 100% index from day 0 (upper bound, no reserve).
- S1 keep: 80/20, reserve never used (the "spare cash just sits" baseline).
- S2 drawdown ladder: 1/3 of the reserve at −10%, −20%, −30% from the all-time high (each once per episode).
- S3 fear ladder: 1/3 at VIX close ≥ 30, ≥ 40, ≥ 50 (each once per episode).
- S4 drawdown + fear, stepped: tranche 1 when drawdown ≤ −10% and VIX ≥ 30; tranche k+1 only after the index is another 10% below the previous tranche's fill and at least 10 trading days later; max 3.
- S5 panic day, stepped (price only, usable for KOSPI): a day of −3% or worse while drawdown ≤ −10%; tranches at least 10 trading days apart, each also 5% below the previous fill; max 3.
- S6 term-structure inversion, stepped (2006+): VIX ≥ VIX3M while drawdown ≤ −10%; spacing as S5.

## Markets
- S&P 500 total return (^SP500TR if available, else ^GSPC), 1990–2026.
- Nasdaq-100 (^NDX price), 1990–2026, using VIX as the fear gauge.
- KOSPI (^KS11 price), 1997–2026: S2 and S5 on its own prices; S3/S4 with VIX as a global fear gauge.
- S&P 500 in KRW for a Korean investor (^GSPC × KRW=X), 2004–2026: S2, S4, S5.

## Measures
- Whole period: terminal wealth vs S1 and S0, CAGR, max drawdown.
- Rolling 10-year windows starting each January: share of windows beating S1; median excess vs S1 and vs S0.
- Split halves (first half / second half of each market's history).
- Per tranche: forward 12-month return; further fall after tranche 1 before the episode low ("bought, then fell more").

## Keep / drop (decided now)
A rule is kept only if, in every market where it can run: it beats S1 in ≥ 70% of rolling 10-year windows, it beats S1 in both halves, and it is never more than 2%/yr CAGR behind S1 in the whole period. Among kept rules, prefer the simplest (fewest inputs); ties go to the one with the smaller worst "bought, then fell more". No threshold is tuned after seeing results; any extra variant is reported as exploratory.
