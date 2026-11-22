# Decisions

## 2026-10-30 — Task A: observation model and local store

- Implement only holdings observation persistence. The current API flow has no cash, external flows or past fills; no actual account return can be calculated from it.
- Use small server-only modules (`history-model`, `history-store`, `history-recorder`) and two optional reader hooks. Avoid broad edits to the large application/dashboard modules.
- Default to OS user data outside the checkout/OneDrive project and reject configured storage inside the application root. No Vercel history API. This is plaintext local storage, not encrypted storage or multi-user server authentication.
- Preserve first-account connector behavior. Partition by PC-salted broker/client/account identity; never serialize API keys or account numbers.
- Treat read failures as separate no-valuation observations. Keep successful holdings available if disk storage fails and show an explicit save failure.
- Future CSV/TWR/XIRR/monthly analysis and My Performance UI are deferred. This commit supplies their data foundation only.
- Add an always-short `AGENTS.md` and a feature map; avoid rereading the historical worklog for routine changes. Token savings have not been measured.

## Existing boundaries retained

Live orders excluded. User profiles are browser-local. Real account reads use each PC's broker bridge. Three-month strategy comparison is a counterfactual using current selections. News search is not an implemented LLM investment decision or a past-news backtest.

### Validation
Targeted history/broker/bridge tests and the full 58-test regression pass with synthetic fixtures. Tested restart persistence, concurrent duplicates, account partitioning, corrupted records, cloud/public-root guards and non-blocking recording failure. No real holdings were fetched for these tests.


## 2026-10-30 — User-authorized follow-up

Implemented common CSV import, private immutable datasets with recoverable archive/restore, investment P/L versus deposits, strict flow-boundary TWR, annualized XIRR, observation-based MDD, monthly observed periods, moving-average trade P/L and same-currency benchmark comparison. New UI remains modular; app.js changes only by adding one import.

Do not use the broker market tape as personal transactions. The public /orders endpoint excludes some order types and does not supply a complete equity/external-flow ledger. Start with common CSVs; do not claim native exports or automatic full-account performance. CSV source/coverage is user-confirmed and not independently reconciled with the broker. Recorded decision match is not algorithmic backverification.

A prototype calculation should fail visibly with missing data or ambiguous XIRR roots. Real account data is not used for QA. Test/demo fixtures remain explicitly synthetic. No broker order creation or editing is added.

### Follow-up validation
All 75 regression tests pass, including 17 performance tests. Checked hand-calculated flow-linked TWR, Excel's published XIRR example, zero-equity/full-withdrawal intervals, timezone grouping, missing coverage, trade costs, benchmark freshness, restart persistence, cloud guards and recoverable archive/restore. Browser QA used only synthetic CSVs: import, insufficient-coverage state, preview, local save/reload, archive/restore and public index comparison. The DEMO's 13.4375% TWR and 130,000 KRW P/L are example arithmetic, never the user's returns. Public market requests contain only the benchmark symbol/range; account CSVs are processed in browser memory and optionally saved to the paired PC. Archive files and active files remain plaintext on that PC. No production multi-user authentication or independent strategy replay is claimed.


## 2026-11-02 — Existing-key connection friction

The user already has a working local Toss key. Do not ask for it again or confuse a browser profile with broker authentication. Add a Windows launcher that reuses the recognized loopback service or starts it hidden, then opens the local account view after the existing profile flow. Never terminate an unknown listener or change OS startup/security policy. Key status reports file availability only, not OAuth validity or contents. The same bridge Origin/Host/POST/capability gates remain. Local account-view entry triggers a read and reuses same-profile results for one minute; manual/5-minute refresh remains. Clear, logout and profile-change invalidation must prevent stale data reuse. Remote pairing duration and one-use code are unchanged. Private evaluation/portfolio review documents must not enter deployment archives.

Validation: 80 regression tests pass (5 new status/launcher tests). Synthetic browser QA confirms first-entry automatic query, same-profile one-minute reuse (one read across repeat navigation), and clear removes the displayed holdings. No private key values are read for setup checks, copied into public files or sent to Vercel.


## 2026-11-02 — Read-only broker orders and aggregate executions

User explicitly requested actual order/fill history after reviewing Toss OpenAPI1.2.28. Reuse the existing reader's OAuth token and first brokerage account. GET /api/v1/orders only; no mutations, no browser raw broker order IDs/account references. Normalize hashes, numeric/null fields, order-creation KST boundaries, native-currency costs and aggregate fill details. Include canceled/partial fills without treating an unfilled/canceled order as a trade. Accept unknown status/type codes without inventing semantics. No individual-fill sequence, all-order-type coverage, realized P/L, account TWR or independent compliance claim.

Existing local Host/Origin/POST/remote-pairing guards apply before history callbacks, without requiring a holdings snapshot. Server fetches at most8pages; overlapping identical orders deduplicate, changing rows/cursor cycles/bounds/late failure visibly mark partial coverage. Browser keeps data in memory only, resets on profile/data clear, and exports sanitized JSON on explicit user action. No permanent order history files are generated by this feature. Do not convert aggregate final-fill timestamps into supposedly complete trade CSVs automatically.

Spec: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json . Local endpoint /api/bridge/order-history is a read action transported over POST; upstream orders use GET exclusively. Current cash/holdings/CSV boundaries remain unchanged.

Order responses may be reused briefly in PC server memory (closed30seconds/open5seconds, up to8queries); same-query in-flight reads deduplicate. No automatic order files are persisted. Rate-limit messages honor a numeric Retry-After when provided.

Validation: all90regression tests pass (10new order-history tests). Synthetic browser verifies45-order pagination, excluding unfilled orders while retaining canceled partial fills, per-currency unknown costs, and sanitized JSON download. The existing real account key successfully read a recent3-month closed-order response through its final page; private order records/IDs/amounts were not written to project files or public artifacts. Initial provider rate limiting cleared on a later request; it must remain a visible error, not an empty-success result.


## 2026-11-02 — Goal & Allocation Planner

Build the first complete goal → monthly allocation → approval → paper execution → persisted next-plan loop as separate deterministic modules. Existing holdings, read-only order history, CSV performance, technical-rule backtests and paper workspaces remain intact. Personal goal drafts live only in private PC storage; no user goals, holdings or credentials in public source, deployment or QA artifacts.

Goal projections distinguish future end-of-month contributions, paid-in capital and assumed growth; explicit contribution start supports a future start date. Required return is a mathematical condition, not evidence it is attainable. ETF target weights, cost/risk limits, reference prices, virtual cash and FX require user confirmation. Two buy-only scenarios use new funds, preserve existing cash and frozen unsupported holdings, and expose remaining deviation after lot/cost rounding. Do not present a heuristic as a global integer optimum.

2026-11-02 — 개인용 자산 홈은 PC 브리지의 토스 보유주식 스냅샷을 탭 메모리에서만 받아 요약한다. 이 경로는 현금·총자산·외부 입출금·완전한 평가 이력을 받지 않으므로, 화면은 보유주식 평가액/보유원가 기준 손익만 표시하고 계좌 수익률·손익 기여도는 미확인으로 표기한다. 로그인 체험 프로필과 PC 브리지 권한은 계속 독립적이다. 장치 지속 재인증, 다중 사용자 인증 및 원격 자동 연결은 구현하지 않으며 기존 1회 코드, Origin/Host 검사와 만료 정책을 변경하지 않는다.

Server approval freezes settings/quotes and recalculated plan hash. Execution rechecks the current revision, month and constraints, records one monthly contribution atomically, and is idempotent for an already executed approval. Settings changes invalidate approval. A future contribution start, stale reference, unresolved cash/position-limit breach or incorrect targets blocks approval. Private per-ledger file locks prevent simultaneous writes. This is PC-authorized storage, not multi-user financial authentication, encrypted storage or tamper-proof auditing.

Defer full performance attribution, historical plan-adherence claims, AI decision synthesis and real trading until their input coverage and execution boundaries are implemented. UI clearly labels the separate monthly paper ledger and synthetic memory-only DEMO. See GOAL_ALLOCATION_SPEC.md for calculation/persistence boundaries and tests.

Validation: 103 regression tests pass (13 new tests, including 200 deterministic lot/currency/cost scenarios). Synthetic browser QA verifies no-ETF goal calculation, two allocation scenarios, separate approval and execution, persistent PC reload and duplicate-month prevention. The test portfolio is synthetic, not a private account.

## 2026-11-02 — Authentication architecture and navigation stage 1

See AUTH_UI_ARCHITECTURE.md for six requested design deliverables and official provider sources/unknowns. workspace-ui composes existing views into My Assets and Strategy Lab, moves profile/logout/PC connection/FAQ into Settings, and preserves node IDs, listeners and all storage keys. Only one shared bridge form is displayed; older forms remain hidden to preserve handlers. No financial authorization is derived from the demo PIN. Existing bridge guards and expiry are unchanged; BFF/IdP/MFA/user-owned database/device pairing are future work, not implemented capabilities. Regression:103 pass. Synthetic browser checks main menus, strategy navigation, settings forms, demo planner and performance views.


## 2026-11-02 — Personal asset home release review
BAZE execution finished local work; parent review corrected native USD amounts displayed as KRW, removed invented zero cash from broker input, deferred whole-account concentration/cash rules, prevented broker news from entering browser persistence or public news requests, and cleared home observations on disconnect. Dedicated holdings-overview pure adapter retains unknown cash/returns/FX. Actual acquisition FX returns are not inferred. Home has PC goal/paper-plan summary and native-currency observed holdings history with explicit scope. Existing single-owner bridge and ephemeral remote pairing stay unchanged. No MFA, multi-user finance authorization, perpetual device pairing or real orders are claimed. 105 regression tests pass, including two new FX/unknown-data tests. Deployment uses the explicit source package with no keys, private intent, financial records or BAZE task logs.

## 2026-11-02 Remembered personal browser
- Explicit first pairing code registers a P-256 public key on the private PC for 30 days. The non-extractable private CryptoKey lives in browser IndexedDB; bearer sessions remain memory-only and last one hour.
- Fresh one-use 60-second challenges authorize reconnect, including after PC restart. Origin, device and profile are bound; revoke blocks existing sessions. PC settings can revoke all browsers.
- Optional profile retention saves only profile name and expiry. It is not financial authentication. Logout revokes the short session; explicit connection removal revokes remembered trust.
- Same-origin script/XSS and compromised device remain risks. This is a single-owner PC bridge, not multi-user account isolation, MFA or cloud authentication. Browser storage deletion requires pairing again. PC must remain running.
- No brokerage keys or financial snapshots are persisted in the browser by this feature. No cross-site cookie dependence, cloud custody or trading permission added.

## 2026-11-02 Account-first connected workspace
- Asset home now waits for an actual account snapshot; no demo, default paper cash or silent fallback. Successful empty holdings are distinct from failure. Real cash/account returns remain unknown when not provided.
- Reused private owned-basket comparison and paper panels in Strategy Lab, preserving their IDs, live snapshot and approved strategy. Legacy independent research/paper controls remain collapsed. No real positions are written to browser storage by this integration.
- Strategy version changes clear prior checks/comparisons; paper copies remain distinct and require an explicit copy operation. Profile retention can be enabled in Settings for the current browser profile.


## 2026-11-04 — Investor flow and review follow-up
- Won remains the internal money/storage unit. Visible capital/contribution fields use manwon adapters; existing saved plans and approved strategy definitions are preserved.
- Holdings and owned-basket comparisons have a combined KRW view. Historical comparisons use an explicitly fixed current FX assumption; no historical FX return claim. Exports retain that FX and combined series. Virtual FX transfers are recorded in the paper ledger; per-currency returns after transfers are not presented as investment returns.
- Purchase basis/current value are displayed from the broker response. Closed-order fee/tax fields are fetched automatically; missing amounts stay unknown. Future costs use general brokerage fee + slippage assumptions, excluding taxes, FX and personal promotions. They are not actual paid costs.
- Five-year OHLC retrieval (provider permitting), daily/weekly/monthly aggregation, range/zoom and average purchase line added. Missing OHLC is rejected, not fabricated.
- Approved rules drive next-action explanations and link to paper review. Failed/loading connection or saved observations cannot generate new present-tense strategy judgments.
- Authenticated PC history is a fallback when the brokerage read fails. Only an unambiguous single-account history is selected, original time and FX retained. Same-tab authorized data survives transient failures; private data is never written to browser storage or Vercel. Cold start with PC OFF is NOT supported; safe offline storage remains future scope.
- Goals/history remain visible on the pending home. Loaded plan summaries survive transient refresh failure. Duplicate context cards reduced; Lab has a four-step path and optional news/research tools.
- Remaining: formal identity/MFA, full cash-flow account performance, canonical actual-plan reconciliation, cold-start offline cache and real orders are not implemented. These require separate data/auth boundaries; paper books are not silently merged into actual holdings.
- Validation: 117 automated tests passed, using synthetic data only. Earlier UI checks covered manwon→won conversion, 5-year weekly chart zoom, cost display and rule evaluation; final release UI checks tracked separately.


## 2026-11-04 — Three correctness fixes after review
- P0 confirmed: summary history-list deliberately omits positions; prior fallback incorrectly consumed it. Production wiring now shares createHistoryReaders with an HTTP integration test. Authenticated last-observation returns only one normalized saved snapshot. The history summary remains redacted. Multiple accounts cause a null result rather than guessing; original observation time, unknown cash and stale provenance are preserved. No new order/data-upload capability.
- P1 combined performance: every market and strategy series is rebased at the common start to the original capital allocation weights, carrying only already-known valuations across holidays. Returns/MDD start at that common baseline. This excludes P/L and initial costs incurred up to that observation; native reports retain their original-period figures. Zero baselines, unsorted/invalid values and fewer than two common dates block aggregation. Export includes baseline values and weights.
- P1 planner: default costs now belong to the planner, not investor-ui initialization. Product currency drives new unsaved draft assumptions; empty drafts use book currency. KRW uses the existing general KRX reference and USD the existing US reference, with slippage separated. NXT, personal exemptions, tax and FX are not inferred. Mixed-currency purchases require an explicit aggregate assumption because the existing engine accepts one rate. Book-loaded/approved or manually edited rates (including zero) are protected. No saved ledger/approval migration.
- Tests: 10 targeted cases passed; full regression 122 passed. Tests use temporary synthetic history files and real HTTP responses from the same adapter as dev-server, plus mismatch dates/holiday/MDD and cost-preservation cases. No broker keys or actual account data accessed.

## 2026-11-05 — CAP-04 out-of-sample split and tuning ledger (Notion: 표본 외 구간 분리 및 튜닝 이력)
- The old "평가 구간 수익률" re-ran the last 30% as a fresh backtest while "전체 수익률" still contained that segment; there was no trial history. New `lib/oos-validation.js`: tuning segment = candles before the split only; test segment uses earlier prices for indicator warmup only and starts capital at the split date. Splits require ascending unique dates and ≥20 test trading days. User picks 60/70/80% tuning ratio.
- Trial ledger (per browser profile, `oosLedger` in existing strategy state) is append-only and never truncated, because dropping old rows could falsely restore "independent". Each entry stores strategy version, snapshot, costs, both windows, both returns and parameter changes vs the previous trial on that symbol.
- Independence (conservative, per symbol): not independent if an overlapping test window was already evaluated with a different strategy version, or if the test window overlaps any earlier tuning window. Identical re-runs inherit the original verdict. Earlier entries are not rewritten; the verdict is the one valid at record time.
- Limits: browser-local profile storage, not a server audit log; still counterfactual backtests on chosen symbols (selection bias remains); no multiple-testing correction beyond showing trial counts.
- Tests: 7 new synthetic cases; full regression 129 passed. Headless Chrome on isolated port 8773 with public market data verified independent → reproduction → "독립 검증 아님" and the history table. The first QA run inherited `.env.local` and auto-read the owner's holdings on the home screen (count only appeared in a deleted scratch screenshot; nothing logged). Future QA must set `TOSS_KEY_FILE` to a non-existent path (process env wins over `.env.local`).
## 2026-11-05 — Holdings report home, trading-habit check and DCA review
- User problem: holdings swing daily, the user does not know why and trades on gut feel. Goal resembles a broker "AI signal" (why it moved, synthesised), not a news list. No LLM key exists, so the report is a deterministic evidence engine; an LLM can later only rephrase these structured facts.
- `lib/market-brief.js`: last-day move split into market share (beta vs KOSPI/KOSDAQ/S&P 500 over ≤120 aligned days, clamped 0–3, unreliable below 40 days) and own share. Company disclosures (≤3 days) and title-matched news clusters become cause candidates only when their direction matches the own move; neutral items are medium/low, opposite-direction items are labelled and sorted last and never used in the headline. "No identified cause" is stated explicitly. Moves under 0.6× the 60-day median absolute move are called normal-range to discourage reactive trades.
- `lib/dart.js` + `/api/dart`: OpenDART list.json (60 days, classified by title) and fnlttSinglAcnt latest periodic report; `thstrm_amount` is the reported quarter (3 months), `*_add_amount` cumulative. Server-only (reads data/stocks.json corp codes); 10-minute memory cache.
- `lib/trading-habits.js`: from read-only CLOSED order history (90 days) in browser memory only — trades/week, buys after ≥7% 5-day rise, sells after ≤−7% fall, FIFO holding days within the window (earlier lots excluded), re-buys within 10 days, 20-day after-sale return, fees. Flags carry a suggested personal rule. No storage or upload.
- `lib/dca-advisor.js`: per holding keep / watch / cap / review from earnings growth, single-name weight (35%), volatility (55%), fund share (core target 50%). Price decline alone never triggers replacement. Explicit "not a recommendation" caveat.
- `brief-ui.js`/`brief.css`: mounted lazily into `#overview` (it is created after login); previous home panels are preserved inside "자산 상세 · 원칙 · 기록". Animations: staggered fade-up, shimmer skeletons, count-up, bar growth, line draw, expandable cards; reduced-motion respected.
- QA: headless Chrome on port 8774 with a synthetic snapshot of public tickers, `TOSS_KEY_FILE` pointed to a missing file and `LOCALAPPDATA` set to a temporary folder (the earlier QA server had read the owner's saved plan from the shared user-data folder). Real public prices/news/DART were used; 0 runtime errors, no 390px overflow. Tests: 11 new; full regression 140.

## 2026-11-05 (2) Home redesign: account-first dashboard and flat menu
User feedback: causes were vague ("market flow"), the right half of desktop was unused, the menu was a two-level tree, and the first screen should show principal vs. current value with a monthly chart; trading should be graded, not habit-profiled.
- `lib/asset-timeline.js`: month-end stock holdings are rebuilt by rolling actual fills (1-year order history) back from current quantities, valued with that day's close and USD/KRW close. "넣은 돈" = current cost basis adjusted by later net buys/sells, so (value - principal) is continuous across trades. Months outside the fetched order range, with missing prices, or with negative reconstructed quantities (splits/transfers) are left empty, never filled. Cash is excluded.
- `lib/trade-review.js`: each fill older than 3 days is graded against the same-day market index (KOSPI/KOSDAQ/S&P 500). Buy edge = stock return since fill - index return; sell edge = index return - stock return since sale. Amount-weighted grade with a +/-2%p band. Dividends and FX drift are excluded.
- `lib/market-reasons.js`: market-close news ("코스피 마감", "뉴욕증시 마감") filtered to index headlines from the last 48h; reasons are theme words that actually appear in titles/summaries (politics/elections, rates, tariffs, FX, semis/AI, ...). No LLM; nothing is inferred beyond the article text.
- `brief-ui.js` rewritten: KPIs (value, principal, P/L, today), monthly bar+line chart with hover/focus readout, market reasons, trade report card on the left; sticky holdings list with one-line reason and DCA verdict on the right (stacks on mobile); per-stock analysis moved into a modal. Habit profiling removed from home (`lib/trading-habits.js` kept). Old home panels collapsed at the bottom.
- `workspace-ui.js`: one menu row (홈 / 보유 종목·거래 / 전략 테스트 / 시장 뉴스 / 더보기). Original nav buttons stay in a hidden container so every existing handler and `[data-view]` target is preserved; lab step bar unchanged.
- QA: headless Chrome, port 8774, synthetic holdings and synthetic fills (order-history request intercepted via CDP, prices from public candles). 0 runtime errors, no 390px overflow. Tests: 8 new; full regression 148.

## 2026-11-05 (3) One-screen strategy test
User feedback: the 4-step Strategy Lab did not explain what to do, strategy settings were scattered, and there was too much text.
- New default "전략 테스트" view (`lab-ui.js`, `lab.css`): choose one of four plain-language presets (trend 20/60, fast trend 5/20, RSI dip 30/70, 20/10-day breakout) or write a sentence (examples provided; parsed by the existing natural-language parser), pick a held stock or search, pick 3/6/12 months, run. Optional loss limit for presets.
- `lib/strategy-lab.js` wraps the existing `runBacktest` (fees and slippage 0.1% each, next-day open fills, 2-year history for indicator warm-up) and always compares with buy-and-hold over the same window plus the market index. Verdict uses a +/-2%p band; drawdown is shown as a negative number (the engine reports magnitude).
- "보유 종목 전체에 적용" runs the same rule on every holding and lists strategy vs. hold.
- The original approval/validation/paper-trading pages are unchanged and reachable from 더보기 → "원칙 승인·모의 운용 (고급)". More-menu items are only created when their view exists (the deployed build has no model research view).
- QA: headless Chrome with synthetic holdings and public prices; 0 runtime errors, no 390px overflow. Tests: 4 new.

## 2026-11-05 (4) Investment metrics, stock verdicts, cash and portfolio direction
User feedback: per-stock strategy choice was unclear; news should feed a buy/hold view; dividends, PER, ROE etc. should count; the holdings page listed rows without saying what it was for; articles were scattered; the right side of wide screens was unused; the stock dialog said "no cause found" right after listing causes; the indicator cards looked machine-made; cash should be recorded to steer the portfolio.
- `lib/fundamentals.js` + `api/fundamentals.js` (+ dev-server route): PER, forward PER, PBR, ROE (US: ROA), operating margin, debt ratio, revenue/operating growth, dividend yield and per-share dividend, analyst target and score, sector and today's sector change (KR), business summary, peers. Source is Naver Finance's public page API, which is unofficial; failures are shown, not filled. Only the ticker is sent.
- `lib/stock-score.js`: factor tones (valuation, quality, growth, dividend, stability, target, 60-day trend, news tone) averaged with style weights (balanced/growth/value/dividend). >= +0.3 "추가 매수 검토", <= -0.25 "비중 축소 검토", else "보유 유지"; fewer than 3 factors -> "판단 자료 부족". A holding above the style's single-stock limit is shown as "좋지만 비중이 큼". Dividend style penalises yields under 1%.
- News synthesis: all recent headlines naming the company are classified (existing rules) and their tone feeds the score; the stock dialog is the single place listing articles.
- `lib/move-explain.js`: one conclusion per move (disclosure > market-led > sector-led > fitting article > "normal-size move, no single cause needed" > "large move, no fitting evidence") plus evidence tagged same/opposite/unrelated direction. The contradictory "unknown cause" item is no longer shown.
- `lib/strategy-lab.js#findBestFit`: compares the 4 presets per stock over 1 year; if none beats buy-and-hold by 2%p the advice is to keep accumulating rather than time trades. Shown in the dialog, the portfolio page and the strategy test ("4가지 방식 한 번에 비교").
- `lib/cash-store.js`: manual cash entries appended to a JSON ledger in the PC user-data folder (refuses Vercel and public folders); bridge actions `cash-get`/`cash-set` behind the existing PC authorisation. Entries are kept as history as a base for later cash-flow/spending features.
- `lib/portfolio-advice.js`: cash range, single-stock and sector limits by style, home-country share, estimated annual dividend; actions avoid recommending more of an over-weight holding.
- UI: `portfolio-ui.js` turns the holdings page into "내 포트폴리오" (style selector, scorecard table, best-fit table, cash form, asset mix, direction; old tables/orders/tools folded into "원자료"). Menu is now 홈 / 포트폴리오 / 전략 테스트 / 더보기 (news moved to 더보기). Wider layouts up to 1840px. Stock dialog rebuilt as plain sections with label/value/explanation rows; good/caution shown with small green/amber dots instead of red/blue text (red/blue stay for returns). Korean particles follow the final consonant.
- QA: headless Chrome on an isolated server (port 8774, temporary user-data folder), synthetic holdings and fills, real public prices/news/metrics; cash saved to the temporary folder only. 0 runtime errors, no 390px overflow. Tests: 10 new; full regression 161.

## 2026-11-05 (5) Tooltips, connection flow and demo assets
User feedback: question-style headings and fully written-out explanations felt machine-made; prefer info icons whose text floats on hover. Asked to re-verify the flow for real users.
- Flow check (headless browser, new user on production): with no PC connection the home was effectively blank because `#overview.account-pending` hid every child except a few legacy panels; only one status sentence was visible.
- Home now shows a connect card (3 steps, "코드 입력하기" jumps to the code field in settings, PC package link) and "예시 자산으로 둘러보기". `demo-ui.js` builds a synthetic portfolio and fills from public prices, flagged `demo`; banners say it is not a real account; real snapshots replace it; demo cash stays in memory (never written to the PC ledger). Portfolio shows the same empty state.
- `tooltip-ui.js`: one floating bubble positioned on hover/focus/tap, attached inside an open `<dialog>` when needed, Escape/scroll to close. Long explanations, criteria and caveats moved into `tip()` on home, dialog (metric rows are now label+value with the note in the icon), portfolio, strategy test and settings. Headings are short nouns (매매 방식 / 종목 / 기간).
- Header noise removed (security note moved to settings tooltip; duplicate "과거 투자 성과" button hidden; it remains under 더보기). Market news falls back to a broader query when no close report is in the newest 20.
- Rules for future sessions are in `team_quant/CLAUDE.md`. Notion comparison and the development document were prepared in `worklogs/2026-11-05-notion-plan-check.md` and `worklogs/2026-11-05-dev-doc.md` because this Claude Code setup has no Notion tool.

## 2026-11-06 Situation study, issue bot and order guard (design doc S3, bot stages A–B, S5 groundwork)
Request: implement the team design ("Team Quant 전략 설계" v0.1): explain moves, choose strategies by situation, recommend, staged auto-trading, and a real-time issue bot for wars/elections.
- `lib/situation.js` (version `S1.1-2026-11-06`): fixed state rules — crash, oversold, overheat, uptrend, downtrend, range — and market regime (index vs. 200-day line and its slope). All features use data up to the day's close only.
- `lib/situation-strategies.js`: weight-based strategies (trend + trailing stop, pullback, band mean reversion, half profit-taking when overheated with RSI<60 re-arm, buy 1/3 then confirm after a crash, monthly DCA with double buys after −10%). Targets are set at the close and filled at the next open; trades only when the target changes; 0.2% cost. `runSituationTest` returns the same shape as `runLabTest`; `regimeBreakdown` splits results by up/sideways/down market.
- `lib/situation-study.js` + `scripts/build-situation-stats.mjs` → `data/situation-stats.json`: 5 years of public daily prices, 45 symbols (18 KR large caps, 18 US large caps, 9 ETFs). For every state (same symbol/state counted once per 20 days): 20/60-day excess return vs. the index, and each strategy's 60-day return and drawdown vs. hold. Selection rule: a strategy is chosen only with ≥20 samples and a positive lower bound (mean − 1.28 × overlap-adjusted s.e.); otherwise hold. One walk-forward check (rule from samples ending before 2025-01-24, applied after).
- Finding: no strategy cleared the rule in any group/state, and the walk-forward check selected nothing but hold. Timing strategies gave up 0.3–8%p of 60-day return on average while cutting drawdown by 0.2–21%p. State differences relative to each group's ordinary day are within about ±1.4%p. The earlier note "KR overheat → −2.5%p" mostly reflected the KR large-cap baseline (−2.5%p vs. a KOSPI dominated by two stocks); it is corrected here. A test fails if the shipped stats file was built with another state definition.
- Strategy test (`lab-ui.js`): method list now has 4 basic + 6 situation methods (explanations in tooltips). Choosing a stock shows its state, the same-state distribution vs. the ordinary day, and the per-state method table with "이 방식으로 시험". Results add a by-regime table and "same group, N symbols" check; "모든 방식 한 번에 비교" covers all 10 methods. With no stock chosen, the page shows the state guide and concept tooltips. The home stock dialog gets a "지금 상황" section linking to the study screen.
- Issue bot (`lib/issue-bot.js`, `scripts/issue-bot.mjs`, `.github/workflows/issue-bot.yml`): every 20 minutes and at 08:30/16:00/22:00 KST. Collects Naver news for 10 topics (via the deployed `/api/news` unless Naver keys are in the environment) and 9 market series. Headlines are clustered by TF-IDF cosine on particle-stripped words; topics come from titles only. Level: urgent = news signal (critical keyword with ≥2 outlets, or a topic spike) + related market move ≥2σ, ≥3 articles, first seen ≤12 h; caution = one of the two; watch otherwise. One urgent per reacting market; market-only cautions capped at 2 per market. Alerts throttled to once an hour per event, urgent only at 0–7 KST; Telegram only when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` secrets exist. Output (latest.json, briefings, monthly event JSONL, state) is committed to the `issue-data` branch, which Vercel does not deploy; `api/issues.js` reads it through an allow-list. Briefings mark stale series with their date. GDELT was left out because its API rate-limited every request from this PC.
- Issues page (`issues-ui.js`, `issues.css`, menu "이슈") and a home band with the newest urgent/caution event or briefing. Holding relevance is computed in the browser only.
- `lib/order-guard.js`: pre-trade checks for later paper trading (paper only, kill switch, daily loss stop, per-order/daily amount, single-stock weight, sell ≤ held, price band, halt/limit-up, first minutes after open, duplicate key) and an audit entry. Not connected to any order path.
- QA: isolated server (port 8774, temporary user-data folder, no keys), demo assets, live public data. 0 runtime errors; no page overflow at a true 390px viewport. Tests: 24 new (situation 11, issue bot 9, order guard 4); full regression 185 locally.

## 2026-11-06 (2) Time-series risk models, today's market response, quote cross-check
Request: model the market with time-series / financial-math models, explain in detail how to act on a day like 2026-11-05/06 (US midterm sweep, S&P −4.4%, Nasdaq −5.5%, SOX −12.2%, VIX 28, KOSPI −44% from its high), refine data accuracy, deploy.
- `lib/risk-models.js` (`R1-2026-11-06`, no dependencies): EWMA (λ 0.94); GARCH(1,1) by Gaussian QMLE with variance targeting (Nelder–Mead); 2-state Gaussian HMM (Baum–Welch) plus a fixed-parameter forward filter; 1-day VaR/ES by filtered historical simulation; Monte Carlo GARCH paths bootstrapping standardized residuals. Monte Carlo on screen uses zero drift because no model showed directional skill.
- `scripts/build-market-research.mjs` → `data/risk-model-report.json`: out-of-sample checks on full Yahoo history (S&P 500 from 1960, Nasdaq 1980, SOX 1999, KOSPI 2002, Samsung and SK hynix 2005), GARCH refit every 60 days on the prior 1,000 days, HMM every 250 days on the prior 1,500.
  - 20-day volatility forecast (QLIKE): GARCH beats "last 20 days" by 13–29% on all six; EWMA is best on KOSPI, so the screen picks the better model per asset.
  - 1-day VaR breach rate (GARCH-FHS): 95% → 5.1–5.5%, 99% → 1.1–1.3% (historical and EWMA-normal overshoot at 99%: up to 2.6%).
  - Sizing: 200-day line + 15% volatility target (GARCH forecast) — S&P Sharpe 0.52→0.68, max loss −57%→−31%; Nasdaq 0.62→0.91, −78%→−26%; SOX 0.50→0.59, −87%→−30%. In Korea the 200-day rule did not help (KOSPI 0.46→0.45, Samsung/SK hynix Sharpe lower), the volatility target alone did (KOSPI max loss −55%→−37%, SK hynix −85%→−34%). Rule chosen per market: US = 200-day + vol target, KR = vol target only.
  - HMM separates regimes (next-20-day realized vol in "stress" about twice "calm") but trading on it was inconsistent across assets, so it is shown as information only.
  - Direction: sign of the past 20 days predicted the next 20 days 49–58% of the time vs. a 55–63% base rate of up periods — no directional skill; the models measure risk, not direction.
- `lib/shock-analogs.js` (`A1-2026-11-06`) + `data/shock-study.json`: 15 shock conditions (S&P/VIX by distance to the 200-day line, S&P −4%, VIX +50%, Nasdaq −3/−5%, SOX −5/−8%/bear, KOSPI −4% above/below the line, KOSPI crash and 20-day −20%), each with 5/20/60/120-day outcomes, further drawdown within 60 days, the four rules over 120 days and three ways of deploying new cash; also the 20 US midterms since 1946. The screen evaluates the same condition functions on current data.
- Accuracy: `lib/quote-check.js` + `api/quote.js` read Naver Finance quotes (index, KR/US stocks, ETFs; price, change, market status, time). `mergeQuote` appends today's provisional bar when Yahoo has not published it, replaces the last close when the sources differ by >0.3%, and records each correction and "장중/지연" on screen. The issue bot applies the same cross-check to KOSPI/KOSDAQ/S&P/Nasdaq/VIX (on 11-05 it had reported a stale KOSPI bar).
- `lib/market-response.js` + `response-ui.js`: the 이슈 page becomes "시장" with "오늘 장 대응" at the top — index tabs (KOSPI, S&P 500, Nasdaq, SOX) with rule weight, today's actions, what to avoid, next signals as price/volatility levels (200/20-day lines, volatility needed for each step back up, 1-day 95% band), model tiles (forecast vol, stress-regime probability, 1-day 95% band and ES, 20-day 90% band) and the matching past conditions. "내 종목 대응" applies the per-market rule to each holding (current → rule amount, 1-day 95% loss) entirely in the browser.
- QA: isolated server, demo assets, live data; 0 runtime errors; first index result in about 0.9 s; no page overflow at a 390px viewport. Tests: 10 new; full regression 195 locally.

## 2026-11-06 (3) Core functions: rules, daily check, pre-trade check, report card
Decision with the user: the product's core is "help me keep my own investing rules and show what breaking them cost". Unvalidated displays leave the main flow.
- `lib/core-rules.js` (`C2-2026-11-06`): rules (max single weight 25%, min cash 10%, account daily-loss limit 2.5% at 95%, US 200-day rule on, no leverage/inverse, ≤8 trades per 30 days; optional per-stock volatility rule off) and per-symbol plan weights. `evaluate` = today's check (targets = plan × rule multiplier, capped by cash and scaled to the loss limit; planned symbols stay in the check even at 0 so they can be bought back; actions only when off by >10% of plan, weekly at the week's last close unless urgent). `preTradeCheck` and `maxBuyAmount` for a proposed order.
- `lib/core-risk.js` (`K2`): GARCH asset volatility and 200-day state; account one-day loss range by multivariate filtered historical simulation (KRW returns incl. FX, EWMA-standardized, 500 days, correlations kept) via a shared grid; `buildEngine` gives per-date risk for the report card and validation.
- `lib/report-card.js`: rebuilds daily holdings from fills and compares, in KRW over 1/3/6 months: what you did (time-weighted, fees), holding the period's first-day positions, and following the daily check weekly (same `evaluate`), plus each trade's contribution.
- Validation `scripts/validate-core.mjs` → `data/core-validation.json`: the same engine replayed daily 2012-01→2026-11 on four portfolios (demo-like 6 stocks, KR large caps, US tech, index/bond ETFs). First version failed: a sold-to-zero holding left the check and was never bought back (fixed), per-stock 15% volatility targets ignored diversification (portfolios ran at 7–9% volatility), and it traded 65–130 times a year, breaking its own trade limit 14–54% of the time. Five variants were compared; the default was chosen on 2012–2019 only (trade limit exceeded ≤5%, lower max loss, average Sharpe ≥ hold) and checked on 2020–2026: Sharpe hold→rule 1.23→1.19, 0.84→0.92, 1.19→1.30, 0.85→1.04; max loss −55→−27%, −56→−33%, −48→−18%, −25→−20%; annual return roughly halves in strong markets. Whole period: Sharpe higher in all four, 15–34 rebalances a year, one-day 95% loss range exceeded on 4.5–4.9% of days (99%: 1.0–1.3%). Sudden crashes are not avoided (KR 2020: −29% either way). Cash earns 0 in the test; portfolios use today's survivors.
- UI: `core-ui.js` + `core.css`. Menu: 홈 · 매매 전 확인 · 성적표 · 규칙; 시장/전략 테스트/포트폴리오 under 더보기 marked 참고. Home gets "오늘 점검"; the stock dialog drops the stock score, cause conclusions, best-fit method, situation stats and check list; home hides the market-reason card, issue band, stance chips and reason lines. Rules/plan stay in browser storage per profile; cash uses the existing PC ledger.
- Fixed while testing: the more-menu was empty (items looked up before hidden buttons were attached); amount inputs with `step=10000` silently blocked submits of round amounts; report wording with no trades.
- Tests: 8 new (core 203 locally). Browser QA on the isolated server with demo assets: all four screens, plan save/validation, pre-trade (KR buy, US stock below its 200-day line, sell, unheld ETF), report 1/3 months; 0 runtime errors; no overflow at 390px.

## 2026-11-06 (4) Multi-factor study and detailed playbook
Request: combine market conditions, issues, company fundamentals/P&L and history for better prediction; make the strategy detailed (new cash, buying big drops, not "sell everything at +5%"), from real data.
- Data (`scripts/research/build-factor-data.mjs` → `.research/factor-data.json`, not deployed): 25 KR and 29 US large caps; quarterly revenue, operating income, net income, equity — KR from OpenDART 2014–2026 with publication assumed at the legal deadline (+45 days quarterly, +90 annual), US from SEC EDGAR XBRL with the first filing date; daily prices since 2010; KOSPI, S&P 500, VIX, US 10-year yield, USD/KRW, WTI. Market cap = split-adjusted price × today's share count.
- Study (`scripts/research/factor-study.mjs`, selection to 2019, check from 2020): rank correlation with next-month relative return for momentum, 1-month reversal, volatility, 52-week drawdown, earnings yield, ROE, revenue growth, margin change; a fixed-sign composite; a yearly walk-forward ridge model. Nothing held up in both periods (composite IC KR −0.02→0.06, US 0.00→0.00; learned model ≈0). Macro features predicting next-month index direction: KOSPI 52% vs 58% always-up, S&P 49% vs 68%; out-of-sample R² negative. After a −20% drop from the 3-month high, prices fell a further 9–13% on average; "healthy fundamentals" dips did not beat the index after 2020. After +30% in 60 days there was no average reversal. No news/issue history exists yet to test (the issue bot's log will provide it).
- Playbook simulation (`scripts/research/playbook-sim.mjs`): 120 random 6-stock portfolios from the 54, ₩10M + ₩500k monthly from 2016, same-day data only, the app's own `evaluate` for the account loss limit. 2021–2026: plain monthly buying 13.6%/yr, max loss median −36% (worst 10% −51%); new cash to underweight holdings first: same results with ~40% fewer trades; plus trimming only above 25%: 14.3%, −29% (−41%), lower loss than plain buying in 65% of portfolios; adding dip tranches from a reserve: no change; adding the 2.5% account loss limit: 13.7%, −25% (−35%), lower loss in 83%.
- Engine changes (`lib/core-rules.js` `C3`): new rule "오른 종목은 상한까지 두기" (default on; plans float up with winners to the single-stock cap, trimming only the excess); `allocateCash` splits new money across holdings below their rule targets within cap, min cash and loss limit (falls back to cash when the account is already over the limit). Re-validated with `scripts/validate-core.mjs`: 2020–2026 Sharpe vs hold 1.24 vs 1.23, 0.90 vs 0.84, 1.33 vs 1.19, 1.07 vs 0.84; trade limit exceeded ≤4.3%.
- UI: "새로 넣을 돈" on 오늘 점검; "세부 전략 근거" card on 규칙 (`data/strategy-evidence.json`). Prediction from fundamentals/macro is not used for buy/sell decisions.
- Tests: 2 new (205 locally).

## 2026-11-06 (5) Company Intelligence Engine, step 1: historical company analysis and growth-prediction validation
Team proposal (pasted document): shift the core toward finding companies whose future the market has not priced yet; build first a "go back to a past date" lab and validate whether then-available data could identify growth companies; separate growth prediction from return prediction; walk-forward only; include failed companies.
- Data: universe widened to 98 companies (KR 50, US 48) adding boom-and-bust names (아모레퍼시픽, LG생활건강, 씨젠, 에코프로, 펄어비스, 넷마블, GE, Intel, Boeing, Peloton, Zoom, Roku, Snap…). Point-in-time quarterly revenue/OI/NI/equity (KR OpenDART from 2013 with legal-deadline availability, US SEC first filing date), split-adjusted prices. Walgreens dropped out (delisted 2025, no free prices) — survivorship remains a stated limit. `scripts/research/build-growth-panel.mjs` → `.research/growth-panel.csv` (10,816 company-months, 2014–2026) and `data/company-history.json` (1 MB: quarters with availability, month-end prices and index, monthly out-of-sample model ranks).
- Model (`scripts/research/growth-model.py`, LightGBM/ridge/persistence, yearly walk-forward 2017–2026, training rows restricted to those whose 12-month target window ended before the test year; settings judged on 2017–2020, reported on 2021–2026): next-year revenue growth is predictable — LightGBM rank IC 0.41 (persistence 0.24), top-quintile picks grew more than the median 76% of the time, +14%p vs average; operating-income growth IC 0.28; next-year excess return IC −0.09 (no skill; the "growth and cheap" combination 0.06 is weak and inconsistent between periods). Most important features: PSR, earnings yield, prior-year growth, size, current growth, margin.
- Lab UI (`company-ui.js`, mounted at the top of 전략 테스트): company + month → only then-known figures (price, approx. market cap, TTM revenue/OI/NI, growth and acceleration, margin, ROE, PER, PSR with same-market rank, momentum, drawdown, the 8 disclosed quarters) and the model's then-current out-of-sample verdict (growth outlook rank, priced-in expectation via PSR rank, excess return explicitly "not judged"); "결과 공개" then shows 1/2/3-year actual growth and return vs index and whether the growth call was right. Examples: NVIDIA 2021-01 growth top 4%, PSR top 10% → +67% vs index; Peloton 2021-01 identical verdict → −103%; 씨젠 2020-12 "보통" → growth top 4% but −40%.
- Tests: 3 new (208 locally). Browser QA: lab for KR and US names, early dates without model, reveal flow; 0 errors.

## 2026-11-06 (6) Growth prediction re-verification (G2) after team review
Team review of (5) asked: is the 0.41 inflated by future share counts in PSR? Is 2026 scored before its outcomes exist? Is it stable by year and beyond 98 hand-picked firms? Is it better than simply extrapolating current growth?
- Fixes: point-in-time share counts (`scripts/research/build-shares.mjs`: SEC cover / diluted-average / NI÷EPS first filings, DART 주식총수현황 보통주, Yahoo split history; one-off spikes from unit errors removed, persistent steps such as rights issues kept; 97/98 firms covered); training rows limited to outcomes actually published before each Jan 1 refit; per-date rank features instead of whole-period winsorizing (which used future quantiles); only cross-sections with ≥80% of outcomes published are scored (the old "2026" figure was one month of 22 early-filing US firms); company-cluster bootstrap CIs and Newey-West t for overlapping 12-month targets.
- Ablation (next-year revenue growth rank, 2021-2025, 117 cross-sections): old method reproduced 0.398; simple "current growth" 0.235 [0.14, 0.32]; all features with point-in-time cap (C) 0.411 [0.33, 0.48], +0.17 [0.09, 0.25] over simple; without cap features 0.328; financial statements only 0.199 — not distinguishable from simple (−0.04 [−0.12, 0.04]). Positive every year (0.31, 0.29, 0.44, 0.52, 0.50), KR 0.33 / US 0.49, all 10 non-overlapping June snapshots positive, sector-neutral 0.44 (sector-only baseline 0.10). Operating-income growth: 0.35 [0.28, 0.42] vs simple 0.09.
- Broad US check (`build-sec-universe.mjs`, `growth-universe.py`): every SEC filer with revenue ≥ $50M, including later delisted/acquired firms, ~3,100 per year. Financials only (no free prices for delisted firms): 0.295 vs simple 0.267, +0.028 [0.020, 0.036]. SEC frames use the latest restated values; on the 49 US names they differ from first-filed values by >5% in 7.5% of firm-years.
- Conclusion: current share counts were not inflating the result (point-in-time is slightly better). The model's edge over extrapolating growth comes from prices — valuation and momentum, i.e. what the market already expects. That is consistent with excess-return prediction failing (2021-2025 −0.10 [−0.18, −0.03], sign flipped from 2017-2020). The growth+cheapness combination is 0.03, not significant. So the growth engine is a descriptive tool, not a source of excess return.
- Product: model C runs the lab (judgment drivers via LightGBM contributions, point-in-time cap, %p vs index, comparison group stated) and a new 포트폴리오 › 성장 전망 card (`growth-ui.js`): rank among the 98 by market, calibrated range (what firms at that rank actually grew 2021-2025), operating-income outlook, drivers, caution flags, price judgment explicitly not given. Live outlook is refit on outcomes published through today (`data/growth-outlook.json`). Every judgment is frozen in `data/growth-ledger.json` (as-of date, model version, outcome cutoff, comparison group, expected range); only `actual` is filled later.
- Not done: point-in-time prices for delisted firms (so the price-driven part is only verified inside the 98), KR full-universe test, analyst expectations.

## 2026-11-06 (7) Can the growth outlook drive a strategy? (S1)
Question from the user after G2: can a strategy be built on the growth outlook? Hypotheses fixed before running (`scripts/research/growth-strategy.mjs` → `data/growth-strategy.json`): H1 hold the top 20% by predicted growth, H2 drop the bottom 20%, H3 model top 20% beats current-growth top 20%, H4 the top 20% falls less in down markets, H5 higher predicted growth means a larger next-12-month drawdown. Monthly rebalance on the out-of-sample predictions, equal weight within market, dividends included (`build-dividends.mjs`), one-way costs KR 0.2% / US 0.05%.
- Check period 2021-01..2026-09 (69 months, KR+US average): H1 +2.3%/yr [-10.6%, +15.3%]; H2 -1.3% [-3.4%, +0.9%]; H3 -1.6% [-11.7%, +8.4%]. None distinguishable from zero.
- The trap: 2017-2020 H1 was +21.9%/yr [+0.7%, +43.1%] (US alone +25.4%, t 3.13); it vanished afterwards.
- H4 reversed: 2022 US top 20% -30.4% vs all -8.8%; in months the index fell >5% the top 20% lagged by -3.8%p (KR, 9 months) and -3.9%p (US, 7 months).
- H5 holds in the US (rank IC with next-12-month max drawdown -0.221, t -2.462) but trailing 12-month volatility explains it (0.492); after removing volatility -0.079 (t -0.912). KR -0.085 / vol 0.386 / after -0.02.
- Decision: the growth outlook is not a buy/sell signal and adds no risk information beyond volatility. The 성장 전망 card says "매매 신호 아님" and its tooltip carries these numbers (test asserts they still hold). Strategy decisions stay with what was verified: the playbook (position cap, reserve buying, daily loss limit; 2021~ median MDD −22.9% vs −35.9% for plain DCA, at −1.2%p/yr return).

## 2026-11-08 (8) Release test campaign (test report STR-TQ-2026-001)
- 284 automated cases (unit 123, integration 100, system 44, non-functional 17). First run on production 437437b: 276 pass / 8 fail; after fixes 282 / 2. Report: test-report/Team_Quant_Test_Report_v1.0.pdf, evidence in test-report/evidence, runners in test-report/scripts.
- Fixed (working tree, not yet deployed): DEF-01 vague principle ('좋은 주식 사줘') was converted to a default 20/60 MA rule — parser now refuses text with no supported condition (FR-01, AT-01); DEF-02 report card 'rule' path max drawdown ignored the day-one rebalance cost (drawdown now includes the starting 100); DEF-03 '과거 투자 성과' KPI cards overflowed at 390px (minmax(0,1fr) + overflow-wrap). New tests: test/test-plan-cases.test.js.
- Open: DEF-07 FR-06 mismatch (SSRD: warn when test CAGR < 50% of tuning CAGR, limit interpretation under 30 trades; app: warns on >10%p return gap) — team must choose; DEF-05 Vercel serves server-only files (dev-server.mjs, lib/kis.js…) — needs route-level blocking, not .vercelignore (functions import lib/kis.js). Deferred: DEF-04 UI modules throw on holdings without avg cost/return; DEF-06 만원 values shown with 4 decimals.

- 2026-11-08 follow-up: all release-test defects fixed (working tree, not deployed). DEF-04 display helpers treat missing numbers as '—' (overview/investor/portfolio UI); DEF-05 vercel.json redirects server-only paths (24 lib modules not in the dev-server allowlist, dev-server/launch-personal-server .mjs, /docs, /.github) to '/' — .vercelignore cannot be used because api functions import lib/kis.js; DEF-06 manwon() shows whole 만원 at ≥1,000,000원, one decimal below; DEF-07 reclassified as a document defect: the official requirements baseline is SSRD v1.1 (CAP-04), the SSRD.md draft (v0.1) FR-06/AT-04 were revised to the implemented rule (warn when test return trails tuning by more than 10%p), and the rule moved to lib/oos-validation.js overfitWarning(). Regression tests: test/regression-defects.test.js (TC-REG-001~003, incl. a check that vercel.json blocks every server-only lib). Production check of DEF-05 (TC-NF-SEC-002) still needs a deploy.

## 2026-11-08 (9) 모의투자: 실제 절차를 돈 없이 그대로
- 왜: 사용자가 "실제로 투자해 보는 절차를 모의투자로 예상해 보자"고 요청. 기존 '모의 운용'은 사용자가 판단을 한 건씩 기록하는 수동 장부였고, 절차 전체(계획 → 점검 → 매매 전 확인 → 체결 → 평가)를 시간에 따라 재생하지 못했다.
- 무엇: `lib/paper-trading.js`(`rehearse`, `forwardRange`, `equalPlan`) — 핵심 엔진(core-rules.evaluate/preTradeCheck, core-risk.buildEngine)을 그대로 써서 주 1회(급할 때 바로) 점검 → 할 일마다 매매 전 확인 → 통과한 주문만 다음 거래일 시가에 체결(시가보다 0.1% 불리, 편도 0.2%, 국내 1주 단위) → 날마다 원화 평가 → 그냥 보유·지수와 비교. 결정론적이라 '오늘부터 모의투자'는 시작일·자금·종목·규칙만 저장하고 볼 때마다 시작일부터 다시 재생한다(장부 저장 없음). `paper-ui.js`(메뉴 '모의투자', 홈·매매 전 확인·성적표 다음). 앞으로 63거래일 범위는 GARCH(추세 없음)로 흔들림의 크기만 보여준다.
- 검증: `scripts/paper-rehearsal.mjs` → `data/paper-rehearsal.json`(네 포트폴리오 × 아홉 기간, 2026-11-08). 절차대로는 그냥 보유보다 수익률 중앙값 −3.3%p, 최대 손실 1.4%p 작음(더 작은 칸 72%), 지수보다 +1.9%p, 비용 자금의 0.71%/기간, 매매 연 25회. 2026년 국내 급락(KODEX 200 최대 −47%)에서는 보유보다 +10~14%p, 2023·2025 같은 상승장에서는 −5~15%p. 즉 수익 엔진이 아니라 하락 방어·규율 도구라는 기존 결론(11-06)과 같다.
- 발견: 급락장에서 '급함' 점검이 날마다 발동해 30일 매매 상한(8회)이 주문을 막는다(예시 6종목 최근 12개월: 막힌 주문 113건 중 95건). 규칙끼리 부딪히는 것이며, evaluate가 남은 매매 횟수를 고려해 큰 주문부터 내도록 고치는 것은 재검증(validate-core)이 필요해 이번엔 기록만. 1,000만원·국내 고가주에서는 1주 미만 주문이 많아(미체결 64건) 되맞추기가 거칠다.
- 안 한 것: 실제 주문 연결(설계 09절 팀 결정 전), 중간 매매를 반영한 앞으로 범위, 세금·배당·이자.
- 테스트: `test/paper-trading.test.js` 7개(장부 합계·현금 비음수·1주 단위·매매 상한 차단·결정론·지수 비교·앞으로 범위). 격리 서버 8774 헤드리스 QA 14/14(데스크톱·390px).

## 2026-11-09 (10) 더보기 결함 수정 · 입력 요소 통일 · 섹터 지도 · 홈 '내 섹터 분포'
- **더보기 결함(사용자 보고, 운영):** 메뉴 줄 `.overview-nav nav`에 `overflow:auto`가 걸려 있어(80b8f80부터) 절대 위치 드롭다운(약 400px)이 70px 줄 안에서 잘리고 스크롤바만 보였다. 11-05 QA는 메뉴 항목을 스크립트로 눌러 지나쳤다(화면으로 열어 보지 않은 내 실수). 수정: `workspace.css`에서 nav overflow를 visible로 되돌리고, 열릴 때 패널이 화면 밖으로 나가면 왼쪽 위치를 맞춘다(`workspace-ui.js` toggle). 데스크톱·390px에서 elementFromPoint로 메뉴 버튼이 실제로 눌리는지 확인.
- **입력 요소 통일:** 핵심 화면(`.ck`: 규칙·매매 전 확인·성적표·모의투자·섹터)의 input/select를 한 가지 모양으로(44px, 모서리 12px, 초점 테두리, 브라우저 기본 화살표·스핀 버튼 제거, 단위 접미). 모의투자 설정 폼은 `.ck-field`로 다시 짰다.
- **섹터 지도(`lib/sectors.js`, `sector-ui.js`, 더보기 → 섹터):** 10개 섹터(반도체·자동차·조선·로봇·의료바이오·2차전지·방산·금융·인터넷플랫폼·전력원전) × 국내 ETF/미국 ETF/대표 회사(국내 2~5, 미국 1~4). 수익률은 `scripts/sector-data.mjs`가 야후 2년 일봉으로 1주~1년·연초·고점 대비·52주 경로를 계산해 `data/sectors.json`에 두고, 화면은 고른 섹터만 `/api/market`으로 오늘 기준을 다시 계산. 이슈는 날짜·행위자(미국/EU/한국/중국/일본/IMO)·종류(정책/정치/무역/실적/시장)·영향 방향(+/−/±)·관련 종목·출처 URL을 가진 사람이 적은 자료(섹터 42건 + 공통 3건, 2026-11-09 기준, 웹 검색으로 확인). 국가별 방향 5개국, 지켜볼 일정. 미확인 수치는 본문에 "미확인"으로 표시.
- **원칙:** 오를지 내릴지는 적지 않는다. 거시·정책 변수로 수익률 방향을 맞힌 근거가 없기 때문(Goyal–Welch–Zafirov RFS 2024; 이 저장소 요인 연구 11-06). 쓰임새는 "내 돈이 어떤 정책·정치 이슈에 얼마나 걸려 있나"의 노출 지도다.
- **홈 '내 섹터 분포' 카드(오늘 점검 아래):** 보유 종목을 섹터로 분류(대표 회사 사전 → 코드 → 지수/채권 ETF → 지표 API 업종 문자열 키워드 → 분류 없음)해 주식 안 비중 막대, 가장 큰 섹터 vs 성향별 상한(균형 40 · 성장 50 · 가치 40 · 배당 35, `lib/portfolio-advice.js`와 같은 값), 유효 섹터 수(1/HHI), 내 종목에 직접 걸린 이슈 수, 상한 초과 섹터의 줄일 금액(검토안: 줄인 돈은 현금, 어느 섹터를 사라는 뜻 아님). 지수 ETF는 상한 적용 안 함. 예시 자산: 반도체 65%(상한 40 초과, 약 420만원), 유효 2.1개, 이슈 8건.
- **메뉴 위치:** 섹터는 상단 탭이 아니라 더보기 첫 항목 + 홈 카드 링크. 같은 날 공유된 방향 메모("기능별 페이지를 늘리지 말고 3개 흐름으로")에 맞춘 선택. 상단 재구성(오늘 / 기업·전략 / 모의투자)은 팀 결정 사항이라 하지 않았다.
- **검증:** `test/sectors.test.js` 7개(이슈 날짜·출처·hits 무결성, 분류, 분포·상한·검토안, 수익률 계산, 자료 파일), 전체 239/239. 격리 서버 QA 14항목(더보기 데스크톱·모바일, 타일 10, 수익률 자료, 이슈·출처·국가·일정, 기간/섹터 전환, 오늘 기준 재계산 6개, 홈 카드, 홈→섹터, 입력창 44/46px·12px, 콘솔 0, 390px 가로 넘침 없음).
- **한계:** 이슈 자료는 사람이 갱신해야 한다(자동 수집 아님). 섹터 수익률은 현지 통화라 미국 종목은 환율 변화가 빠진다. 국가별 방향 중 출처 없는 일반론은 본문에 "출처 없음"으로 표시했다. 분류 사전 밖의 종목은 지표 API 업종 문자열에 의존하며, 운영(DART 키 없음)에서 국내 종목 힌트가 비어 '분류 없음'이 될 수 있다.

## 2026-11-09 (11) 키 파일 적재 · 한투 모의계좌 실행 엔진(paper-live)
- **키 파일:** `lib/key-files.js`. `.env.local` 에는 `DART_KEY_FILE`·`KIS_KEY_FILE` 경로만 두고 서버가 시작할 때 읽어 환경 변수로 올린다. 한투 파일은 실전 키(app/appkey)와 모의 키(simulappkey/simulappsecret)가 한 파일에 있는데, `KIS_MODE=vps` 면 모의 이름표만 쓰고 모의 키가 없으면 실전 키로 대신하지 않는다. 요약에는 값이 들어가지 않는다(테스트로 확인).
- **클라이언트:** `lib/kis-orders.js`. 모의(vps)에서만 생성(실전은 생성 자체를 거부). 공식 예제 tr_id(VTTC0012U/0011U 주문, VTTC0013U 취소, VTTC0081R 당일 주문체결, VTTC8908R 주문가능, VTTC8434R 잔고, FHKST01010100 현재가). 토큰은 24시간·1분당 1회 발급이라 장부 폴더의 파일에 캐시하고, EGW0012x(토큰 무효)면 한 번 재발급한다. 호가 단위(2023 개편)·장 시간(09:00~15:20 새 주문) 포함.
- **엔진:** `lib/paper-live.js`. 잔고 → 규칙 evaluate → 할 일마다 preTradeCheck + order-guard(1회·하루 한도, 호가 폭 3%, 장 시작 5분, 중복, 상한가, 거래정지) + 주문가능수량 확인 → 통과한 것만 지정가 전송. 보내기 전 장부에 'sending' 으로 먼저 적고, 응답을 못 받으면 'unknown' 으로 남겨 다음 재조회가 증권사 목록에서 번호를 찾는다(재주문 없음). 같은 종목에 끝나지 않은 주문이 있으면 새 주문을 막는다. 킬 스위치는 열린 주문을 취소하고 새 주문을 막는다. 장부: `%LOCALAPPDATA%/TeamQuant/paper-live/kis-vps-<끝4자리>.json`(임시 파일 → 교체).
- **경로:** PC 브리지 `paper-live-status|preview|run|kill|cancel`(모의 키 없는 PC 는 503), CLI `scripts/kis-paper.mjs`, 모의투자 화면 '한투 모의계좌' 카드(PC 에서만 보임, 보내기는 두 번 클릭). Vercel 은 새 서버 전용 lib 3개를 `/`로 돌린다(vercel.json, TC-REG-002).
- **첫 실전(모의) 실행 2026-11-09 12:21 KST:** 모의계좌 1억, 계획 국내 4종목 각 20%. 규칙의 하루 손실 한도가 목표를 11%씩으로 줄였고(5/5 충족), 4건 모두 통과·전송·체결(삼성전자 57주, SK하이닉스 9주, KODEX 200 138주, NAVER 58주, 각 약 1,100만원). 기본 한도(1회 100만·하루 300만)로는 전부 차단돼 모의계좌 규모에 맞춰 `.env.local` 에서 1회 1,500만·하루 6,000만으로 올렸다. 한 번은 시세 응답 지연(504)으로 미리보기가 중단됐다(fail-closed 동작 확인).
- **검증:** `test/paper-live.test.js` 9개(주말 보류, 전송·중복 차단·재시작 보존·부분 체결, unknown→재조회 번호 부착, 시세 실패 fail-closed, 거부 기록, 킬 스위치 취소, 매도 수량 상한, tr_id/본문, 호가·장시간, 키 파일 선택). 전체 248/248. DART: 격리 서버에서 /api/stocks·/api/dart 200 확인.
- **한계:** 국내 주식만(해외 종목은 계획에서 뺀다). 일별 주문체결 응답 필드는 공식 예제에 없는 것이 있어 관대하게 읽는다(실측으로 odno/tot_ccld_qty 동작 확인). 모의 서버 호출 제한이 낮아 종목이 많으면 느리다. 모의계좌는 2027-02-09 만료 후 재신청 필요. 메모의 '투자 가설 추적'은 아직 없다.

## 2026-11-09 (12) 모의계좌 2단계: 미국 종목 · 근거 있는 기본 계획 · 자동 실행 · 운용 기록
- **왜:** 1단계 첫 실행에 쓴 '국내 4종목 각 20%'는 주문 경로를 확인하려는 연습용 계획이었지 전략이 아니었다. 사용자 지적대로 계획은 근거를 가져야 하고, 해외 종목을 빼야 할 이유도 없었다(모의계좌에 해외주식 상시대회가 같이 열려 있다).
- **미국 종목(`lib/kis-orders.js`):** 시세는 NAS→NYS→AMS 순으로 찾고 거래소를 기억, 주문은 `/overseas-stock/v1/trading/order`(모의 매수 VTTT1002U, 매도 VTTT1001U — 공식 예제의 주석·docstring 기준, 코드가 쓰는 VTTT1006U 와 달라 거절 시 한 번 재시도), 취소 VTTT1004U, 당일 체결 VTTS3035R, 주문가능 VTTS3007R, 잔고 VTTS3012R(+외화예수금 VTRP6504R, 실패 무시). 달러 지정가(0.01), 원화 환산은 KRW=X 최근 종가. 미국 정규장 09:30~16:00 ET(새 주문 15:50 까지, 서머타임 자동)에만 미국 종목을 보낸다. **미국 체결은 아직 실측 전**(한국 시간 23:30 개장) — 모의 서버의 응답 필드 이름은 관대하게 읽는다.
- **기본 계획(`scripts/build-paper-plan.mjs` → `data/paper-plan.json`, PP1-2026-11-09):** 원칙을 먼저 적고 바꾸지 않았다. ① 오를 종목을 고르지 않는다(거시·정책 변수의 표본 외 예측력 없음: GWZ 2024, 11-06 요인 연구·성장 전략 검증) → 비중은 최근 1년 변동성 역수(원화 기준) ② 정치·정책·세계 추세는 **노출 상한**으로만: 한 종목 20%, 한 섹터 30%, 한 나라 60%, 반도체 합계 25%(2026-11 정책 사건 위험 집중), 현금 ≥ 15% ③ 후보는 섹터 지도의 대표 회사(국내 8 + 미국 7) + KODEX 200·SPY·QQQ·TLT ④ 종목마다 섹터 지도의 날짜·출처 있는 이슈를 '노출 메모'로 붙임. 결과: 17종목, 유효 종목 수 12.8, 국내 31%·미국 54%·현금 15%, 반도체 8%, 장기채 14.5%.
- **검증(같은 엔진으로, 숫자 그대로):** 규칙대로 운용 시 중앙값 수익 +8.2%, 최대 손실 중앙값 −8.8%(KODEX 200 −29.2%). 해마다: 2020 +8.2/−18.7, 2021 +15.4/−6.3, 2022 −8.7/−8.8(KODEX −25.8, SPY −15.1), 2023 +15.8, 2024 +23.0, 2025 +28.6(KODEX +90.4 — 반도체 랠리를 거의 못 탐), 최근 12개월 −3.9(KODEX +39.5). 충격 시나리오 즉시 손실: 반도체 −30% → −4.6%, 코스피 −20% → −6.8%, 미국 −20% → −11.6%(최악), 원화 +10% → −5.4%, 금리 급등 → −6.1%. 균등 비중·코스피200만·지금 모의계좌(국내 4종목)와 나란히 적어 두었다. 결론: 이 계획은 수익을 겨냥한 것이 아니라 '어느 한 사건에 10% 넘게 잃지 않는' 노출 구조다. 상승장 수익을 내주는 것이 알려진 비용이다.
- **자동 실행(`PAPER_LIVE_AUTO=1`, `paperLive.autoRun`):** PC 서버가 10분마다 확인. 시장이 열려 있고 그 시장에서 오늘 아직 안 보냈을 때, 금요일(주간 점검)·규칙상 급함·기본 계획 버전 변경·첫 운용 중 하나면 하루 한 번 보낸다. 그 밖의 날은 1시간에 한 번 점검만. 기본 규칙 C3 + 기본 계획만 쓴다(사용자 계획은 화면에서 직접 보낼 때만).
- **운용 기록:** 장부에 날마다 한 점(marks: 원화 환산 총자산·현금·주식·환율)을 남기고 카드에 '시작 → 지금'을 보여 준다. 이것이 진짜 표본 외 검증 자료다.
- **계획 우선순위:** 규칙 화면에 저장한 내 계획 → PC 의 기본 계획(data/paper-plan.json, 카드에서 근거·검증 표 열람) → 예시. CLI 도 `--plan` 이 없으면 기본 계획.
- **검증:** `test/paper-live-us.test.js` 4개(시장별 장 시간·달러 지정가·환율 환산, 기본 계획·marks, 미국 장 시간/서머타임, 미국 클라이언트 tr_id·본문·잔고 합치기) + 기존 9개, 전체 통과.
- **실행하며 발견해 고친 것(같은 날):** ① 모의 서버는 초당 1건 정도만 받아 17종목 미리보기가 '초당 거래건수 초과'로 줄줄이 막혔다 → 호출 사이 1.1초 간격 + 초과 응답 시 1회 재시도(`minGapMs`). ② 규칙 C3 의 '오른 종목 두기'와 '30일 8회' 때문에 계획을 바꿔도 계좌가 새 계획으로 못 옮겨 간다(첫날 4건 + 소폭 매도 4건으로 상한 소진) → **재조정 모드**: 계획 변경·첫 운용 때만 ⓐ 열린 주문을 먼저 거두고 ⓑ 오른 종목 두기를 끄고 계획까지 맞추며 ⓒ 묶음 안에서는 매매 횟수를 묻지 않고 ⓓ 묶음 전체를 30일 상한에 1회로 센다. 자동 실행이 계획 변경·첫 운용을 감지하면 이 모드를 쓰고, 화면 카드와 CLI(`--rebalance`)에서도 켤 수 있다. 평소 주간 점검은 종전대로 건마다 센다. ③ Vercel 화면은 PC 연결 뒤 PC 의 기본 계획 문서를 status 로 받아 보여 준다(배포본과 PC 본이 달라도 PC 기준).
- **한계:** 미국 주문 체결은 오늘 밤 23:30 KST 이후 자동 실행에서 처음 확인된다(계획 변경 트리거). 시나리오 충격 크기는 과거 사례에서 고른 값이며 확률이 아니다. 변동성 역수는 저변동 종목(장기채·필수소비재)에 비중이 쏠리는 알려진 성질이 있다. 휴장일 달력이 없어 휴장일에는 증권사 거부로 남는다.

## 2026-11-09 (13) 이름 정리 · 투자 지표 확장 · 매매 전 확인 검색
- **이름:** 모의투자 화면의 두 기능을 '과거 데이터 시뮬'(공개 일봉 재생, 증권사 없음)과 '실시간 모의계좌 (한투)'(배지: 모의 · 실제 돈 아님)로 갈랐다. 사용자가 둘을 같은 것으로 읽은 것은 제 명명 탓.
- **투자 지표(종목 대화상자):** ETF(KODEX 200)는 보수·배당·60일선 3줄뿐이었다. 모든 종목·ETF에 '성장·모멘텀'(1·3·6·12개월 수익률을 지수와 나란히, 1년 고점 대비, 200일선, 60일 변동성)을 시세로 계산해 붙이고, 회사 설명은 접었다. '최근 뉴스 분위기: 좋은 소식 N·나쁜 소식 N' 요인은 뺐다(무엇이 좋은 소식인지 알 수 없는 숫자). 대신 제목에 회사 이름이 있는 최근 기사 3건을 날짜·어조 점·원문 링크로 보여 준다(NAVER 뉴스 키가 있는 서버에서만).
- **매매 전 확인:** 입력하면 바로 제안 목록(국내 이름·코드 + 미국 티커 46개), 각 행에 오늘 등락(네이버 지연 시세), 고르면 오른쪽에 오늘 가격·등락·1년 캔들 차트, 확인 결과는 그 아래. 서버 검색은 대형주·ETF 우선 순위와 별칭(현대차·삼전·하이닉스…)을 둔다 — 전에는 이름 길이로만 정렬해 '현대'에 현대금속이 현대차보다 앞섰다. 부제를 '포트폴리오 규칙'으로 고쳐 종목 단위 전략이 아니라 포트폴리오 단위 점검임을 분명히 했다.
- **공용 검색 모듈(`stock-search-ui.js`):** 종목을 고르는 입력칸은 모두 같은 제안 목록(국내 서버 순위 + 미국 티커 55개, 행마다 오늘 등락)을 쓴다. 매매 전 확인과 과거 데이터 시뮬의 '직접 입력'(고른 종목은 칩으로 쌓고 ×로 뺌)에 붙였다.
- **검증:** 격리 서버 QA 11항목(검색 제안·등락·차트·결과 유지·미국 티커·ETF 지표 9줄·'좋은 소식' 제거·콘솔 0·390px 넘침 없음) + 시뮬 검색 9항목. 최근 기사 3건은 뉴스 키가 없는 격리 서버에서는 비어 운영에서 확인.

## 2026-11-09 (14) 세 질문으로 규칙 · 기록으로 점검 · 종목 가설
- **왜:** 사용자 정의 — "규칙을 잘 세우고, 감정 없이 이행하고, 시장 자료로 규칙과 배분을 고친다. 종목은 성장력·모멘텀 근거로만." 숫자 7개를 고르는 규칙 화면은 기준이 애매했다.
- **세 질문(`lib/rule-presets.js`, 규칙 화면 맨 위):** ① 한 달에 견딜 손실 5/10/20% → 하루 손실 한도 = 월 손실 ÷ √21 (1.1/2.2/4.4%), 현금 최소 20/10/5%, 변동성 목표 = 하루 한도×√252÷1.645 ② 섹터 수 3/5/8 → 한 종목 25/20/15%, 섹터 상한 40/30/20%(홈 섹터 카드에 반영) ③ 점검 주기 주 1회/월 1회/급할 때만 → 30일 매매 8/4/3회, PC 자동 실행 주기. 숫자는 세부 규칙에서 그대로 손볼 수 있고 손보면 '직접 조정'으로 표시. 'PC 모의계좌에도 적용'은 브리지 `paper-live-prefs`로 PC 장부에 저장돼 자동 실행이 그 규칙·주기를 쓴다(규칙 저장 자체가 계획 버전에 들어가 다음 장중에 재조정).
- **기록으로 점검(`reviewRules`, 규칙 화면):** PC 장부의 날마다 기록으로 운용 일수·총자산 변화(같은 기간 KODEX 200)·하루 손실 한도 초과일·30일 매매 횟수(묶음 1회)·현금 평균·막힌 주문 이유 상위 3개를 재고, 측정에서 나오는 제안만 붙인다(한도 초과일 10% 초과 → 허용 손실 낮추기 검토, 매매 상한 차단 많음 → 주기 늘리기, 현금 25%p 초과 → 계획 합 올리기). 20거래일 미만이면 "짧다"고 먼저 말한다. 예측이 아니다.
- **종목 가설(`paperLive.hypothesis`, 모의투자 화면):** 종목을 고르는 유일한 경로. 검색으로 고르면 근거 자료(업종·매출 성장·영업이익·ROE·PER·1/3/12개월 수익률·고점 대비·200일선)를 자동으로 채워 주고, 사용자가 가설·깨지는 조건·기간(3/6/12개월)·한도(2/3/5%, 열린 가설 합 30%)를 적어 등록한다. 등록하면 기본 계획에 한도만큼 얹히고(기본 계획은 비율로 축소), 계획 버전이 바뀌어 다음 장중 자동 실행이 재조정 묶음으로 산다. 성적은 진입가(등록 뒤 체결 평균) 대비 수익과 같은 기간 지수(국내 KODEX 200·미국 SPY) 대비 초과로 쌓이고, 깨짐·종료(맞음/틀림)로만 닫히며 지우지 않는다.
- **검증:** `test/rule-presets.test.js` 3개, `test/paper-live-plan.test.js` 3개(PC 규칙 저장·사용, 가설 합치기·자동 재조정·성적·닫기, 주기별 자동 실행·막힌 이유 기록). 전체 261/261. 격리 서버 QA 12항목.
- **한계:** 세 질문의 숫자 관계(√21, 1.645)는 손실이 날마다 독립이라는 거친 가정이다. 가설 성적은 모의계좌 체결이 있어야 생긴다(등록 당일 장이 닫혀 있으면 다음 장중). 깨지는 조건은 사람이 판단해 누른다(자동 감시는 아직 없음).

## 2026-11-09 (15) 계좌가 없으면 모의계좌가 기본 · 공개 스냅샷 · 전략 검토
- **요구:** 계좌를 설정하지 않았을 때는 모의계좌가 우선이어야 하고, 실제 계좌를 연결했을 때와 안 했을 때를 분명히 구분한다. 한투 모의계좌는 가상 돈이라 다른 사람이 써도 괜찮으니, 그 계좌의 계획·규칙을 누구나 과거 데이터에 넣어 "6개월 전에 가지고 있었다면"을 보고, 그냥 보유와 비교하고, 전략을 검토할 수 있어야 한다.
- **모의계좌 우선(`paper-account-ui.js`):** 토스 조회가 실패하면(PC 없음·키 없음·연결 안 됨) 그것이 "실제 계좌가 없다"는 신호다. 그때 모의계좌를 불러와 `teamquant:asset-snapshot`(demo+paper 표식)으로 보내므로 홈(KPI·보유·오늘 점검·섹터 카드)·매매 전 확인·성적표·모의투자가 모두 그 계좌로 돈다. 실제 계좌 자료가 들어오면 그 자료가 우선이고, 화면에서 지우거나 예시를 끄면 다시 모의계좌로 돌아온다. 구분: 홈 배너(모의계좌 · 실제 돈 아님 · 운용 N일 · 갱신 시각 · 출처), 상단 표시(실계좌 조회 / 모의계좌 / 예시 자산), 규칙 저장 키 접미사(`:paper`), 현금 출처 표시(모의계좌 예수금). 실제 계좌 연결 흐름은 그대로다.
- **공개 스냅샷(`lib/paper-public.js`, `data/paper-live-public.json`):** PC 서버가 `status()`를 줄여(계좌번호·장부 경로·주문번호·증권사 응답 원문 제외; 잔고·보유·날마다 평가·계획·규칙·가설·주문 요약은 유지) 25분마다 파일로 적고, `PAPER_LIVE_PUBLISH=1`이면 하루 한 번(16:00 KST 뒤) `PAPER_LIVE_PUBLISH_REPO`의 그 파일 하나만 커밋·푸시한다(pathspec 커밋이라 다른 변경은 건드리지 않는다). 브리지 `paper-live-public`(로컬에서만 `push`)과 CLI `node scripts/kis-paper.mjs publish [--push]`로 바로 쓸 수도 있다. Vercel 방문자는 PC 연결 없이 이 파일로 같은 계좌를 본다(읽기 전용 · 주문·가설 등록은 PC 연결 때만).
- **과거 데이터 시뮬 입력:** 기본 선택이 '모의계좌 기본 계획(비중 그대로)'이고, '모의계좌 지금 보유 종목(균등)'도 고를 수 있다. 계획 비중을 `rehearse`의 `plan`으로 그대로 넣으므로(지금까지는 균등만 썼다) 결과가 모의계좌가 실제로 하는 일과 같다. 규칙은 모의계좌에 PC 저장 규칙이 있으면 그것, 없으면 내 규칙을 쓰고 출처를 결과에 적는다.
- **전략 검토(`lib/strategy-review.js`):** 같은 종목·같은 계획에 규칙만 바꿔(지금 쓴 규칙 + 보수 5%·8섹터·월 1회 / 중간 10%·5섹터·주 1회 / 적극 20%·3섹터·급할 때만) 네 기간(3·6·12·18개월, 오늘까지)을 다시 돌려 수익률·보유 대비·최대 손실·매매·막힘·현금 평균을 표로 놓고, 그냥 보유·지수 행을 함께 둔다. 계획 비중은 각 규칙의 한 종목 상한·현금 최소에 맞춰 줄인다(`fitPlan`). 결론은 기간을 가로지르는 사실만 적는다(모든 기간에서 보유보다 손실이 작았던 규칙, 수익률이 높았던 규칙, 가장 나쁜 기간의 손실이 가장 작은 규칙, 매매가 가장 잦은 규칙, 한 기간의 1등을 고르지 말라는 주의). '이 규칙을 세 질문에 넣기'를 누르면 규칙 화면의 세 질문에 들어가고 PC 모의계좌에도 적용할 수 있다. 측정이지 예측이 아니다.
- **검증:** `test/paper-public.test.js` 3개(누출 검사 포함), `test/strategy-review.test.js` 4개. 전체 268/268. 격리 서버(키 없음) QA 22항목: 홈 기본=모의계좌, 상단 표시, 보유·KPI·오늘 점검·섹터 카드, 규칙 키 분리, 시뮬 기본 선택·17종목·비중 합 85%, 읽기 전용 카드, 전략 검토 표 6행·결론 문장, 세 질문 반영, 예시 전환·복귀, 모바일 넘침 없음.
- **한계:** 공개 파일은 하루 한 번 올라가므로 Vercel 에서는 최대 하루 늦다(PC 연결이면 실시간). 전략 검토는 지난 기간 네 개에 대한 측정이고 가장 좋은 칸을 고르면 과적합이다. 모의계좌 규칙이 PC에 저장되기 전에는 시뮬이 보는 사람의 규칙을 쓴다. 예시 자산 흐름은 남겨 두되 보조 수단이다.

## 2026-11-09 (16) 리뷰 반영: 미확인 주문 정책 · 매매 결정과 주문 건수 분리 · 허용 손실 ≠ 보장 · 비교 기준 · 변경 이력 · 시스템 점검
- **출처:** 2026-11-09 저녁의 방향성 재검토 메모(외부 리뷰). 코드로 확인해 맞는 지적만 반영했고, 틀린 전제는 기록한다.
- **확인 결과(사실):** ① `reconcile()`은 증권사 조회 1회에 없고 10분이 지나면 `not_found`로 바꿨고, 그 상태는 같은 종목 재주문을 막지 않았다 → 재전송 위험이 실제로 있었다. ② 오늘(KST) 주문만 재조회해 밤에 낸 미국 주문이 자정 뒤 영영 맞춰지지 않는 결함도 있었다. ③ 30일 매매 횟수는 재조정 묶음을 1회로 세고 화면도 그렇게만 보여 줬다. ④ "그냥 보유"는 이미 같은 종목·같은 초기 비중의 단순 보유다(메모는 이를 빠뜨렸다). ⑤ 한투 모의계좌의 체결은 모의 서버의 판정이지 거래소 체결이 아니다 — 지난 보고의 "실제 호가·체결"은 과장이었다. ⑥ GWZ(2024)는 시장 전체 주식 프리미엄 예측 변수에 관한 연구이고 일부 변수는 성과를 유지했다 — "예측은 안 된다"로 넓혀 쓰지 않는다. 이 저장소의 주장은 "우리가 검증한 재무·시장 예측 모델에서 안정적인 표본 외 초과수익을 확인하지 못했다"까지다.
- **P0 미확인 주문(`lib/paper-live.js` L4):** 끝나지 않은 주문은 최근 4일치를 그 주문의 KST 날짜(미국 주문은 뉴욕 날짜도)로 조회한다. 조회가 실패하면 어떤 상태도 바꾸지 않는다. `not_found`는 성공한 조회에서 10분 넘게 떨어진 두 번 모두 없을 때만 '보는' 것이고, 그 뒤에도 그날은 같은 종목에 새 주문을 내지 않는다(`BLOCKING`). 원칙: 접수되지 않았다는 것이 확인되기 전까지 재주문하지 않는다.
- **P0 매매 결정 vs 주문 건수:** 규칙의 30일 상한은 '매매 결정' 횟수에 적용한다(보통 주문은 건마다, 재조정 묶음은 1회). 이것은 17종목 계획으로 전환할 수 있게 하는 **정책**이며 그대로 둔다. 대신 `activity30`(결정·실제 주문·체결·거부·미확인·회전율)을 상태·공개 스냅샷·카드·기록으로 점검에 함께 보여 준다. 재조정을 주문 한 건처럼 보이게 하지 않는다.
- **P1 허용 손실 ≠ 보장(규칙 화면):** 세 질문 아래에 "한 달 N%는 허용 손실(목표)이지 보장이 아니다"와 모델 추정치를 따로 둔다: 지금 보유의 하루 95% 손실(VaR) → 월 환산(√21, 독립 가정), 기본 계획의 2020~2026 최대 낙폭, 충격 시나리오 최악. 하루 한도는 그날의 손실을 막는 것이 아니라 다음 날의 비중을 줄이는 장치임을 적는다.
- **P1 비교 기준(`lib/paper-trading.js` P2):** 그냥 보유(같은 종목·같은 비중)·지수에 더해 **지수+현금(같은 투자 비중)** 선을 추가했다. 손실이 작은 이유가 현금 비중뿐인지 가른다. 전략 검토 표와 결론에도 들어간다("지수+현금보다도 모든 기간에서 손실이 작았던 규칙" / "없다면 주로 현금 덕").
- **규칙 변경 이력:** PC 규칙을 바꿀 때 근거를 요구하고(처음 저장은 예외) 무엇이 바뀌었는지·근거·기대 효과·계획 버전·그때 총자산을 `prefsHistory`에 남긴다. 기록으로 점검은 "바꾼 뒤 20거래일 전의 성과는 새 규칙의 평가가 아니다"를 붙인다. **기준선**: 처음 할 일을 정한 날의 계획·규칙·총자산을 고정해 두고, 카드에서 시뮬 엔진으로 다시 돌려 실제 모의계좌와 나란히 놓는다(바꾸지 않았다면).
- **시스템 점검(`lib/paper-integrity.js`):** 의도하지 않은 중복 주문·미확인 뒤 같은 날 재전송·이유 없는 주문·1시간 넘게 미확인 — 모두 0건이 목표. 상태·공개 스냅샷·카드·기록으로 점검에 표시. 합성 테스트가 오류 상황을 강제로 만든다(조회 장애, 숨겨진 주문, 자정 넘긴 미국 주문).
- **같은 상태 → 같은 판단:** `test/paper-consistency.test.js`가 같은 보유·현금·규칙·계획·시세를 시뮬 엔진(evaluate)과 모의계좌 엔진(preview)에 넣어 종목·방향·금액(1주 단위 내)·규칙 충족 수·급함이 같음을 확인한다. 두 환경의 차이는 체결 방식(모의 서버 판정 vs 다음 시가 가정)·시장 휴장·호가 단위다.
- **공개 범위:** 가설 등록에 '공개 스냅샷에 포함'(기본 켬)을 두고, 끈 가설은 공개 파일에서 뺀다(개수만). 읽기 권한(공개 파일)과 주문 권한(PC의 모의 키)은 계속 분리한다.
- **검증:** `test/paper-integrity.test.js` 6개, `test/paper-consistency.test.js` 2개. 전체 276/276. 격리 QA 14항목.
- **하지 않은 것:** 가설의 자동 감시(실적·공시로 깨짐 판정)는 다음 핵심 과제로 남긴다. 호출 제한을 한 큐로 묶는 일은 1.1초 간격·재시도로 충분한 동안 미룬다. 2027-02-09 첫 평가는 "첫 번째 전향적 운용 평가"로 부른다.

## 2026-11-09 (17) 2차 리뷰 반영: 뉴욕 거래일 · 규칙 버전 해시 · 환율 누락 보류 · 가설 승인 단계
- **출처:** 287a9d3 에 대한 외부 2차 리뷰. P0 세 건은 코드로 확인해 모두 사실이었다.
- **P0-1 미국 주문의 날짜(`lib/paper-live.js` L5):** 같은 종목 중복 차단(`openToday`)·주문 보호의 하루 한도·자동 실행 키가 KST 날짜를 써서, 미국 장(KST 23:30~06:00)이 자정을 넘기면 같은 세션에 두 번 낼 수 있었다. 이제 거래일은 **국내 주문 = KST 날짜, 미국 주문 = 뉴욕 날짜**(`tradeDateOf`, `todayFor(market)`)로 통일했다. 테스트: 23:40 KST 주문 뒤 00:10 KST 재평가에서 재전송 없음, 자동 실행 키 `US:2026-11-09` 유지.
- **P0-2 규칙 버전:** 계획 버전에 `savedAt`을 넣어 같은 규칙을 다시 저장해도 '계획 변경'으로 재조정이 나갈 수 있었다. 이제 `+R:`은 규칙·주기·섹터 상한의 **내용 해시**이고, 내용이 같으면 `savedAt`도 바꾸지 않는다. 테스트: 재저장 뒤 자동 실행 없음, 내용 변경 시 버전 변경.
- **P0-3 환율 누락:** 해외 자산이 있는데 환율을 못 읽으면 `mark()`가 미국 자산을 뺀 총자산을 그날의 평가로 적었다(환율 장애가 자산 급감으로 기록). 이제 새 평가점을 적지 않고 마지막 정상 평가를 '보류' 표시로 돌려주며, 그 상태에서는 **국내 주문까지 모두 보류**한다(총자산·비중을 알 수 없으므로). 상태·공개 스냅샷·카드에 `markStale` 표시.
- **P1 가설 승인 단계:** 가설 등록은 '승인 대기'(계획에 없음)이고, 목록의 **계획 반영 승인**(예상 매수 금액 표시, 확인 대화)을 눌러야 계획에 들어가 다음 장중 자동 재조정이 산다. 진입가·기간은 승인 시점부터. 승인 대기는 바로 지울 수 있다. 앞으로 가설 자동 감시가 생겨도 "분석 → 검토 요청 → 사용자 승인 → 모의 실행" 순서를 지킨다.
- **P1 지연:** 시세 조회에 15분 세션 캐시(탭 안에서만, 종목 코드·공개 시세뿐)를 두어 새로고침마다 9~17종목 2년 일봉을 다시 받지 않게 했다. 규칙 화면의 위험 추정치는 최신 계산이 올 때까지 **마지막 계산값(시각 표시)**을 보여 주되, 주문 허용 판단은 늘 최신 계산만 쓴다.
- **P1 이름·해석:** 비교선 이름을 '국가 비중·현금 일치 지수 투자(…)'로 바꾸고 주식·채권 구성까지 같은 위험은 아님을 적었다. 3·6·12·18개월은 서로 겹치므로 독립적인 네 번의 검증이 아님을 결론 문장에 넣었다. 기준선(11-09 9,938만원) 이전의 변화는 기준선 비교에 넣지 않는다.
- **정책 유지(리뷰 동의):** 재조정 묶음 = 매매 결정 1회(주문 건수·회전율은 따로 표시), 규칙 변경 근거 필수, 11-09 총자산 기준선.
- **검증:** `test/paper-safety.test.js` 4개 추가, `paper-live-plan` 승인 단계 반영. 전체 통과.
- **남은 것:** 주문 건수·회전율에 대한 독립 상한(정책 결정 필요), 가설 자동 감시(다음 핵심), 호출 큐 통합.

## (18) 2026-11-10 하루 한도 시장·거래일 분리, 마감 뒤 미체결 소멸, 미집행 재시도, 모의계좌 카드 최상단, PP2 후보 계획
- **결함 1 (한도 합산):** lib/order-guard.js 의 하루 합계가 UTC 날짜·전 시장 합산이어서 11-09 국내 재조정(약 9,180만원)이 그날 밤 미국 매수 5건을 전부 막았다. 이제 합계·중복 창은 **시장별 거래일**(국내 KST, 미국 뉴욕) 기준이고 rejected/cancelled/expired/not_found 는 세지 않는다. 한도 의미 = 시장별·거래일별 6,000만원(한 묶음 안의 누적 상한은 아직 없음 · 정책 결정).
- **결함 2 (마감 뒤 미체결):** 거래일이 지난 PENDING 주문을 증권사가 여전히 open 으로 주거나 (성공한 조회에서) 없으면 'expired'(소멸·마감)로 닫는다. 미국 조회가 조용히 비는 경우(kis-orders 가 미국 목록 오류를 삼킴)에는 미국 행이 하나도 없으면 바꾸지 않는다(fail-closed). 점검 항목 '마감 뒤 남은 미체결(leftOpen)' 추가.
- **결함 3 (미집행):** 자동 실행이 전부 막혔을 때도 planVersion 을 적어 다음 금요일까지 재시도하지 않던 것을, 한도·시간·확인 문제로 막힌 경우엔 적지 않고 다음 거래일 재시도로 바꿈(ledger.auto[key].applied/note, status.planApplied). 엔진 L6.
- **공개 스냅샷 PUB2:** settings.auto·planVersion·planApplied·auto[] 요약 포함, 주문번호·증권사 문구 스크럽(검증에서 blockedReasons 키에 주문번호가 새던 것 발견·수정).
- **화면:** 실시간 모의계좌 카드를 맨 위로, 운용 상태·마지막 자동 실행·다음 점검·계획 적용 여부·투자 비중(현재/계획)과 미집행 설명 줄, 보유표 '담은 이유' 열, '계획 중 미보유' 목록. 그 아래 '과거 데이터로 검증(시뮬레이션)' 구역. 홈 배너도 진행 중/비중 표시.
- **PP2 후보(data/paper-plan.pp2.json · docs/paper-plan-pp2.md, 기본 계획 미전환):** 핵심 90% 지수 ETF(KR 32.8% / 미국 S&P500 57.2%, 국내 상장 원화 ETF 권고) + 위성(승인 가설만, 총 15%·종목 5% 상한, 현재 0) + 현금 10%(규칙 C3). 최근 12개월 규칙 운용 PP2-A +16.2% / MDD −23.7% vs PP1 −2.8% / −21.5% vs 지수+현금 +14.8% vs KODEX200 +42.2%. PP2 는 수익에서 5개 비교 기간 중 4개 우위, 낙폭은 5개 모두 열위. 전환은 보유 9종목 매도·ETF 매수(회전 약 1억 650만원, 2세션) → 사용자 결정.
- **검증:** 테스트 304/304, 격리 QA(8774) paperdefault 22/22 · review2 8/8 · reorg 29/29, 모바일 390px 가로 스크롤 없음.

## (19) 2026-11-12 모의계좌 총자산 이중 계산 보정, 미국 체결 조회 범위, 소멸 기록 자동 교정
- **결함 1 (이중 계산, 공개 숫자 +29.9%):** 한투 모의계좌는 미국 주식을 원화로 사도 원화 예수금을 빼지 않는다(2026-11-12 원본 확인: 예수금 62,669,084 그대로, 외화예수금 0, 미국 매입금액 28,156,129원). mark() 가 국내 총평가 + 미국 평가를 더해 산 돈과 산 주식을 둘 다 자산으로 잡았다. → lib/paper-live.js settleUs(): 외화예수금이 없고 미국 보유가 있으면 증권사 매입금액(원화, frcr_pchs_amt1)을 현금·총자산에서 뺀다. 달러로 샀으면(외화예수금 > 0) 빼지 않는다. 미리보기·실행·상태·평가점이 같은 보정 잔고를 쓴다(규칙의 현금 비중도 보정값 기준). 공개 파일에 cashRawKrw·usFundingKrw, 카드에 ⓘ 설명. 11-10·11-11 평가점은 일회성 스크립트로 보정(백업 보관, totalRaw 유지). 바로잡은 뒤 운용 성과는 시작 대비 약 +1%(+30% 아님).
- **결함 2 (체결 누락):** 미국 주문·체결 조회가 NASD 만 보아 NYSE·AMEX 체결 4건(JNJ·JPM·LMT·SPY)이 "목록에 없음"으로 소멸 처리됐다(보유는 있는데 장부는 체결 0). → 거래소 코드를 비워 전체 조회, 거부되면 NASD·NYSE·AMEX 로 나눠 합침(중복 제거).
- **결함 3 (자기 교정):** "목록에 없음"으로 소멸 처리한 주문도 4일 안엔 재조회해 체결이면 filled 로 바로잡고 메모를 남긴다(fail-closed 유지: 조회 실패 시 아무것도 바꾸지 않음).
- **열린 것:** 미국 매도 뒤 모의 서버가 원화·달러 어느 쪽으로 돌려주는지 미확인(첫 매도 때 보정식 재검토). 실계좌(통합증거금)는 D+1 자동 환전으로 예수금이 실제로 줄어드는데, 그때는 외화예수금·예수금 변동으로 구분해야 한다 — 실계좌 조회 연결 시 다시 검증.
- **결함 4 (주문번호 형식):** 접수 응답의 주문번호는 10자리(앞 0 채움), 체결 목록의 번호는 앞 0 을 뗀 형태라 미국 주문 5건이 번호로 끝내 매칭되지 않았다(국내는 양쪽 모두 10자리). → 앞 0 을 떼고 비교(odnoKey/sameOdno).
- **검증:** test/paper-us-funding.test.js 4개 추가(보정·미보정·소멸 교정·전 거래소 조회), 전체 308/308.

## (20) 2026-11-12 기록 해시 체인
- **왜:** 운용 기록의 가치는 수익률이 아니라 "그날 적은 것이 나중에 바뀌지 않았다"는 검증 가능성에 있다(11-11 가치 평가·11-12 계획 1단계 2번). 11-10·11-11 평가점을 일회성 스크립트로 보정한 일이 보여 주듯, 공개 숫자는 바뀔 수 있고 바뀐 흔적은 남아야 한다. 검증에 PC·장부·키가 필요하면 검증이 아니므로 공개 파일만으로 되게 한다. 검증 가능성은 코드가 아니라 쌓인 날수이므로 오늘 시작한다.
- **무엇을 봉인하나(`lib/paper-chain.js`, 순수 함수):** 하루 항목 payload = { date, total, cash, stock, funding(정산 전 미국 매수대금, 없으면 0), fx(없으면 null), positions:[{symbol, qty}] 종목순, fills:[{symbol, side, qty, avgPrice}] } — fills 는 상태 filled/partial 이고 거래일(국내 KST · 미국 뉴욕, paper-live 의 tradeDateOf 와 같은 규칙을 복사)이 그 날짜인 주문의 체결 수량·평균가, 종목·방향순 (→ 23 에서 '체결 수량이 있고 확인한 KST 날짜'로 바꿈 · fx 없음은 null). hash = sha256(prevHash + '|' + canonical(payload)), canonical 은 키를 재귀 정렬한 JSON, 첫 항목의 prevHash 는 ''. 계좌번호·주문번호·증권사 문구·종목명은 들어가지 않는다.
- **엔진(`lib/paper-live.js`):** 장부에 `chain[]`·`chainBreaks[]`. mark() 가 오늘 평가점을 적을 때마다 오늘 항목을 만들어 같은 날은 교체(그날 마지막 조회가 봉인). **지난 날짜 항목은 어떤 경우에도 다시 쓰지 않는다**; 봉인 뒤 그 날짜의 marks 가 바뀐 것이 보이면(total·cash·stock·funding 비교) `chainBreaks` 에 {date, note} 만 적는다. 환율 보류(stale)인 날은 봉인하지 않는다. 체인은 자르지 않는다(검증에 전체가 필요). 옛 장부(chain 없음)는 빈 체인으로 시작한다.
- **되메우지 않는 것:** 11-09~11-11 평가점(marks)은 체인에 넣지 않는다. 되메운 항목은 그날 적은 것이 아니므로 봉인 시각을 꾸미는 일이 된다. 체인 1일차 = 새 코드가 처음 돈 2026-11-12.
- **점검·공개·화면:** `lib/paper-integrity.js` 항목 '기록 변경 감지(chain)' = (체인이 깨졌으면 1) + chainBreaks 수, 목표 0. 공개 스냅샷(PUB2 에 필드 추가: `chain`(최근 400일, 봉인된 키만 그대로)·`chainCheck`·`chainBreaks`). 모의계좌 카드 요약 줄에 "기록 N일 · 해시 체인 정상|확인 필요"(깨졌으면 붉게·깨진 날짜, ⓘ 에 오늘 해시 앞 12자) (→ 23: 공개·표시는 닫힌 날만, ⓘ 는 마지막 봉인 날짜·해시, 점검 항목은 체인 깨짐만).
- **확인하는 방법:** `node scripts/kis-paper.mjs verify [path]` — 공개 파일(기본 data/paper-live-public.json)만 읽고 장부·서버·키·.env 를 건드리지 않는다. 출력 "해시 체인 N일 · 정상" 또는 "깨짐: 날짜 · 이유", 그 아래 총자산 정의 한 줄. 정의 문서: `docs/record-definition.md`(총자산 정의와 첫 미국 매도라는 열린 점 포함).
- **한계:** 체인은 "적힌 뒤 안 바뀌었다"를 증명하고 "적힌 값이 맞다"는 증명하지 않는다(값의 정확성은 증권사 조회와 보정식에 달려 있다 — 결정 19). 공개 파일을 올리는 저장소 커밋 이력이 시각의 증거이고, 체인은 그 사이의 변경을 들춘다. 미국 체결은 뉴욕 날짜라 KST 자정 뒤 체결은 이미 봉인된 전날 항목에 속해 어느 항목의 fills 에도 들어가지 않을 수 있다(보유 수량에는 다음 항목부터 반영). 브라우저는 다시 계산하지 않고 서버의 chainCheck 를 보여 준다.
- **검증:** `test/paper-chain.test.js` 4개(결정성·한 칸 변조·연결 끊김·날짜 순서·체결 선별·CLI verify), `test/paper-live-us.test.js` 2개 추가(하루 한 항목·같은 날 교체·재시작 보존·지난 평가 변경 → chainBreaks·되메우지 않음·공개 스냅샷 재검증·환율 보류 날 미봉인). 기존 점검 테스트는 항목 6개로 갱신.

## (21) 2026-11-12 지수 대비만 헤드라인
- **왜 절대 수익률을 내리나:** 이 프로젝트의 증거(11-11 가치 평가, 결정 18 의 PP1/PP2 비교, 전략 검토)는 엔진에 알파가 없고 수익 숫자의 대부분이 그 기간 시장 방향이라고 말한다. "+1%" 는 시장이 +3% 였으면 뒤진 것이고 −2% 였으면 앞선 것이므로 혼자 서 있으면 틀린 인상을 준다. 그래서 모의계좌 카드와 공개 파일에서 **절대 수익률은 단독 헤드라인이 될 수 없고** 굵은 숫자는 '지수 대비 %p' 하나다. 절대 숫자는 괄호 안 보조 글자(절차 +a.a% · 비교선 +b.b%)로만 남긴다(PUB2 의 startTotal·total 필드는 호환을 위해 그대로 둔다).
- **비교선 정의(`lib/paper-benchmark.js`, 순수 함수):** 이름 '국가 비중·현금 일치 지수 투자'(시뮬 lib/paper-trading.js 의 mix 와 같은 규칙). 기준선(ledger.baseline)을 만들 때 그 계획에서 국내 비중 합 KR·미국 비중 합 US·현금 100−둘을 `baseline.benchmark` = { label, weights:{KR,US,cash}, legs:{KR: 069500 KODEX 200, US: SPY S&P500 ETF(USD)} } 로 **고정**한다. 뒤에 계획·규칙이 바뀌어도 이 정의로만 잰다. 옛 장부(baseline 에 benchmark 없음)는 적재 때 baseline.plan 에서 한 번 만들어 저장한다 — 시각이 붙은 기록이 아니라 정의이므로 체인과 달리 되메우기가 아니다.
- **숫자:** 가치 지수 `benchmarkSeries` 는 첫 평가점 날짜에 1.0 으로 시작해 날마다 현금분 1.0 + KR분×(KODEX 종가 비율) + US분×(SPY 종가×KRW=X 종가 비율); 봉이 없는 날은 마지막 값을 끌어온다. `compare` 는 시작 = 첫 평가점 총자산, 지금 = 마지막 평가점으로 절차 수익률·비교선 수익률·차이(%p)를 0.01 단위로 낸다(평가점 2개 미만이면 null). 엔진 status() 는 `benchmark` = 정의 + 숫자를 돌려주고 지수 시세는 30분 캐시(성공만), 지수·환율 중 하나라도 못 읽으면 정의와 null 숫자에 `error: '지수 시세를 읽지 못해 비교를 보류'` 를 붙이고 status() 밖으로 던지지 않는다. 공개 스냅샷 PUB2 에 `benchmark` 필드 추가(정의·숫자만, 다른 키는 옮기지 않음). 화면: "운용 N일 · 지수 대비 **±x.x%p** (절차 +a.a% · 국가 비중·현금 일치 지수 투자 +b.b%)" + ⓘ(기준선 날의 계획에서 국가·현금 비중, KODEX 200·S&P500 ETF 원화 환산, 위험 수준이 다름). 숫자가 없으면 "지수 대비 — (사유)" 와 작은 회색 절대 숫자.
- **알려진 한계:** 비교선은 **같은 위험 수준이 아니다** — 계좌는 개별 종목(변동성 역수 비중)을 들고 비교선은 지수 둘과 현금뿐이라 종목 선택 효과와 위험 차이가 섞여 있다. 구간은 첫 평가점부터라 기준선 전의 변화(첫 재조정 비용)와 같은 날 안의 시각 차이가 들어간다. 지수 종가는 야후 일봉이라 KST 자정 전 미국 종가가 아직 없는 날은 전날 값으로 끌어온다(결정 18 의 KODEX 200 2026-03-04/07-31 급변 미확인은 그대로 열려 있다). 홈 배너(brief-ui.js paperText)의 "시작 대비" 문구는 이번 작업 범위 밖이라 그대로다 — 다음 단계에서 같은 규칙으로 바꿀 것.
- **검증:** `test/paper-benchmark.test.js` 4개(정의·가치 지수의 환율 환산과 끌어오기·보류 null·비교 수식과 null 가드), `test/paper-live-us.test.js` 1개 추가(기준선 정의·diffPp = 절차 − 비교선·30분 캐시·시세 실패 시 null·옛 장부 정의 생성·공개 스냅샷), `test/paper-public.test.js` 1개 추가(필드 화이트리스트·스크럽·null), `test/paper-ui-layout.test.js` TC-UI-REORG-04(굵은 숫자 하나·대체 문구·ⓘ). `lib/paper-benchmark.js` 는 서버 전용 목록(vercel.json)에 추가.

## (22) 2026-11-12 실계좌 읽기 전용 기록
- **왜 읽기 전용인가:** 사용자가 원하는 것은 "내 계좌로 검증되는 운용 기록"이고, 검증은 조회만을 뜻한다. 자기 계좌를 자기가 조회하는 데는 규제가 없지만 실계좌 주문은 11-11 가치 평가의 결론(알파 ≈ 0, 가치는 행동 통제)과 맞지 않고 위험만 더한다. 그래서 **주문은 이 코드베이스에서 영원히 모의계좌에서만** 나간다: 실계좌 리더(`lib/kis-reader.js`)에는 주문·취소 함수가 없고 내부 call() 은 GET 이 아니면 던지며(guardMethod), 반환 객체는 settings/balance/orders 셋뿐이다. 모의 클라이언트(`lib/kis-orders.js`)는 전처럼 실전 모드를 거부한다.
- **키 경로 분리:** `KIS_REAL_READONLY=1` 일 때 `lib/key-files.js kisReadOnlySettings()` 가 같은 키 파일의 실전 이름표(appkey/app/KIS_ACCOUNT_NO)를 고르되 **process.env 에는 쓰지 않는다**(엔진의 env 는 모의 한 벌만). 계좌번호는 키 파일의 실전 이름표에서만 읽는다(env.KIS_ACCOUNT_NO 는 모의 모드에서 모의계좌 번호). 토큰은 `kis-prod-token.json`(모의 토큰과 다른 파일 · 계좌는 가린 번호만). 요청 모양·응답 해석은 kis-orders.js 에서 뽑아 낸 조회 전용 helper(INQUIRY·krSummary·usdCashOf…)를 두 쪽이 같이 쓴다 — 주문 요청 모양은 helper 에 없다.
- **무엇을 기록하나(`lib/real-record.js`):** 25분마다 PC 서버가 status() 를 불러 KST 하루 한 점 {date,total,cash,stock,fx} 를 `kis-prod-<뒤4자리>.json` 에 적고, 모의계좌와 **같은 봉인 규칙**(`lib/paper-chain.js sealEntry` 로 옮김: 같은 날 교체 · 지난 날짜 불변 · 바뀌면 chainBreaks)으로 해시 체인을 쌓는다. fills 는 그날 reader.orders(오늘) 의 체결(사용자가 증권사 앱에서 낸 주문 · 여기서는 읽기만). 총자산 = 원화 예수금 + 국내 평가 + 미국 평가×환율 + 외화예수금×환율 — **증권사 평가 그대로**, 모의계좌의 정산 전 매수대금 보정(settleUs)은 쓰지 않는다 (→ 23: 실제 계산은 증권사 국내 총평가 tot_evlu_amt 기준이라 가수도정산 전엔 현금+주식 ≠ 총자산 · 미국·외화 조회 실패는 보류). 실계좌(통합증거금)는 D+1 자동 환전으로 예수금이 실제로 줄어 그 사이 하루만 과대 평가될 수 있는데 아직 실제 매수로 확인하지 않았다(`REAL_BALANCE_NOTE`, 카드에 미검증 표시 · usCostKrw > 0 이고 외화예수금 0 일 때). 해외 자산이 있는데 환율을 못 읽으면 평가점을 적지 않는다(markStale · 결정 17 과 같음).
- **비교선:** 계획이 없는 계좌라 첫 평가점의 **보유 국가 비중**(국내 평가 ÷ 총자산, 미국 평가×환율 ÷ 총자산, 나머지 현금)으로 `baseline.benchmark` 를 한 번 고정한다(`benchmarkDefinition` 재사용 · 뜻: "지금 들고 있는 것의 국가 비중을 지수로 샀다면"). 숫자는 모의계좌와 같은 `createBenchmarkReader`(paper-benchmark.js 로 옮김 · 30분 캐시 · 실패 시 null) 로 낸다. 헤드라인은 결정 21 그대로 '지수 대비 %p' 하나.
- **공개하지 않는 것:** 실계좌는 개인 자료다. `lib/real-record.js` 는 `lib/paper-public.js` 를 import 하지 않고, dev-server 의 publishPublic·공개 파일 쓰기는 모의계좌 status 만 받는다(테스트가 소스로 고정). 브리지 경로 `kis-real-status`(기존 짝지음·장치 검사 뒤) 응답에는 가린 계좌번호만 있고 장부 경로·주문번호·토큰이 없다. 콘솔에는 값·계좌번호·경로·증권사 문구를 남기지 않는다(코드만). Vercel·공개 모드에서는 카드가 보이지 않는다(브리지 503 → 숨김).
- **화면:** 모의투자 화면의 모의계좌 카드 아래 "실계좌(한투) · 읽기 전용" 카드 — 총자산 평가·지수 대비(progressHtml 재사용)·보유 N종목·기록 N일·해시 체인(chainHtml 재사용)·배지 "주문 기능 없음 ⓘ(이 계좌로는 조회만 합니다. 주문은 모의계좌에서만 보냅니다.)"·D+1 미검증 메모(조건부). 버튼은 새로고침 하나.
- **알려진 한계·열린 것:** D+1 정산 뒤 예수금·외화예수금이 어떻게 움직이는지 첫 실제 미국 매수에서 확인해야 총자산 정의가 완성된다(결정 19 의 열린 점과 짝). 미국 체결의 거래일(뉴욕)과 평가점 날짜(KST)의 차이로 자정 뒤 체결이 어느 항목의 fills 에도 안 들어갈 수 있다(결정 20 과 같은 한계). 실계좌 체인은 공개되지 않으므로 검증은 사용자 PC 에서만 가능하다 — 공개 범위는 사용자가 따로 정할 일이다(3단계 계획). 오케스트레이터가 가린 숫자로 한 번 조회해 보기 전까지 실제 API 응답은 미확인이다.
- **검증:** `test/kis-reader.test.js` 3개(설정 분리·env 불변·실전 호스트·실전 tr_id·GET 만·토큰 파일 이름·잔고 합산·주문 함수 없음·guardMethod), `test/real-record.test.js` 3개(평가점·체인·재시작·보유 비중 비교선·장부 파일 이름·보류·실패·공개 없음), `test/local-bridge.test.js` 1개(503/401/200·경로 없음·오류 번호 스크럽), `test/paper-ui-layout.test.js` TC-UI-REORG-05. 기존 엔진 테스트는 sealEntry·createBenchmarkReader 추출 뒤에도 그대로 통과. `kis-reader`·`real-record` 는 서버 전용 목록(vercel.json).

## (23) 2026-11-12 결정 20·21·22 검토 반영(체인 공개 0일 상태에서 규칙 수정 · CHAIN_VERSION 유지)
- **왜 지금:** 세 기능이 아직 커밋 전이고 공개 파일에 체인 항목이 하나도 없어(`verify` 0일) payload 규칙을 바꿔도 되메우기·버전 올림이 필요 없다. 검토(리뷰어 3명)가 찾은 것 중 사실로 확인된 것만 고쳤고, 각각 테스트로 고정했다.
- **공개는 닫힌 날만(P1):** mark() 는 오늘 항목을 평가마다 교체하는데 dev-server 는 16:00 KST 뒤 첫 틱에 커밋하고 자정까지 25분마다 다시 쓴다. 미국 보유의 원화 평가·환율이 그 뒤에도 움직이므로 같은 날짜의 해시가 커밋마다 달라져 변조와 구별되지 않았다. → status() 가 밖으로 내는 `chain`/`chainCheck` 는 `date < 오늘(KST)` 인 항목만(장부에는 오늘 항목이 있고 다음 날 그대로 공개). chainCheck 는 공개하는 조각으로 센다(400일 넘어도 공개 파일의 '기록 N일'과 verify 의 N 이 같다). 실계좌 카드는 공개되지 않으므로 장부 전체를 보인다.
- **verify 가 표시 숫자도 대조(P1):** 체인만 다시 계산하면 marks·total 을 고친 공개 파일도 '정상'이었다. → `verifyAgainstMarks(chain, marks)`(lib/paper-chain.js) 로 같은 날짜의 total·cash·stock·funding 을 봉인 값과 비교하고, 마지막 항목과 날짜가 같으면 공개 `total` 도 본다. 어긋나면 둘째 줄에 날짜·항목을 찍고 종료 코드 1.
- **체결 선별(P2×3):** 뉴욕 거래일로 고르면 KST 자정 뒤 미국 체결(미국 장의 5~6시간)이 이미 닫힌 전날 항목에 속해 어느 항목에도 못 들어갔고, 일부 체결 뒤 취소·소멸된 주문은 주석과 달리 빠졌다. → 체결 수량이 있으면 상태 무관하게 넣고, 날짜는 **체결을 확인한 KST 날짜**(엔진 reconcile 이 처음 체결을 본 시각 `o.filledAt` · 없으면 주문 시각). fills 는 '그날 거래'가 아니라 '그날 확인'이다. 남은 한계: 처음 확인 뒤 다른 날 늘어난 일부 체결 수량은 fills 에 더 안 들어간다(보유에는 반영).
- **fx null(P2):** `Number(null) === 0` 이라 환율 없는 날이 '환율 0'으로 봉인됐다. → num 이 null 을 보존.
- **점검 항목 '기록 변경 감지'(P2):** chainBreaks 를 더해 세면 한 번 바로잡은 과거 평가 때문에 점검이 영영 '확인 필요'. → 체인이 깨졌을 때만 1, chainBreaks 는 따로 돌려주고 카드의 체인 줄에 '과거 평가 변경 N건'으로만 붉게. '정상' 글자는 체인 자체(ok)만 따라 색을 입힌다. ⓘ 는 '오늘 해시'가 아니라 '마지막 봉인 <날짜> 해시 앞 12자'.
- **비교 구간은 기준선부터(P1):** status() 는 기준선 전에도 평가점을 적어(현금만 든 날) marks[0] 에서 시작하면 그 날들의 지수 변동이 영영 들어갔다(새 장부·팀원 계좌마다 생길 편향). → `benchMarks()` = `date >= baseline.from` 인 평가점만 넘김(실계좌도 같음). 카드의 '운용 N일'·ⓘ 구간은 `benchmark.days/from/asOf` 를 쓴다(공개 marks 는 400개로 잘림). 남겨 둔 것: 평가점 800개 상한 splice 가 1년 넘은 뒤 기준선 날 평가점을 지우면 시작이 밀린다 — 그때 기준선에 시작 총자산을 고정하는 쪽으로 다시 볼 것.
- **비교선 읽기(P2×2):** 첫 평가점이 1y 범위 밖이면 첫 봉을 기준으로 삼아 틀린 숫자를 냈다 → 봉이 from 보다 7일 넘게 뒤에서 시작하면 null(보류), 범위는 구간 길이에 맞춰 1y/2y/5y. TTL 뒤 한 번 실패하면 멀쩡한 선을 버리고 '—' 를 찍었다 → 같은 구간·비중의 마지막 선으로 숫자를 내고 `error: '지수 시세 갱신 실패 · 마지막 읽은 값'`(카드에 작은 글자). compare 의 JSDoc 을 제자리로, 헤더의 '브라우저·Node 공용'은 거짓(vercel.json 이 막음)이라 '서버 전용'으로.
- **화면 사유(P1):** 비교선 필드가 없는 공개 파일(지금 Vercel 의 PUB2 는 옛 서버가 쓴 것)에서 '기준선 없음'이라 찍혀 바로 아래 기준선 블록과 모순. → 사유를 빠진 것에서 고른다: 비교선 객체가 있으면 그 error(없으면 '비교할 자료 부족') · 기준선만 있으면 '비교선 자료 없음 · 공개 파일 갱신 전' · 둘 다 없으면 '기준선 없음'.
- **실계좌 보류(P0·P1):** kis-reader 가 미국 잔고 조회 실패를 삼켜 국내만의 total 을 돌려주고 real-record 가 그것을 평가점으로 봉인했다(첫 평가점이면 비교선 미국 비중 0 으로 영영 고정 · 하루의 마지막 조회면 '미국 자산 전부 사라짐'이 봉인). 외화예수금 조회 실패도 표시 없이 빠졌다. → kis-reader 가 `cashUsdError` 를 노출하고, real-record 는 `fx_missing | us_failed | us_cash_failed` 중 하나라도 있으면 평가점·봉인·기준선을 만들지 않고 `markStale`·`staleReason` 으로 돌려준다(balance.total 은 null). 카드는 사유 + 마지막 정상 평가 날짜·값, '총자산 평가 보류'.
- **실계좌 체결(P1):** fillsToday 가 `at: 지금` 으로 찍고 뉴욕 거래일로 골라 10:00 KST 조회에서는 미국 체결이 빠지고 19:00 조회에서는 들어가 같은 날의 봉인이 조회 시각에 따라 달랐다. → 장부 `fills[]` 에 처음 본 시각으로 한 번만 적고(열쇠 = sha256(시장|주문번호) 앞 16자 · 주문번호 원문은 장부에도 없음) KST 오늘·뉴욕 오늘 둘 다 조회. 테스트: 같은 KST 날 10:00·19:00 조회의 fills 동일, 다음 날 중복 없음.
- **실계좌 카드 문구(P1·P2):** 재사용한 ⓘ 가 '공개 파일로 검증(verify)'과 '계획에서 국가 비중'이라고 적어 그 카드에서는 둘 다 거짓이었다. → `chainHtml(s, {published:false})`('이 PC 의 장부로만 검증'), `progressHtml(s, {basis:'holdings'})`('첫 평가점의 보유 국가 비중에서'). 헤더 ⓘ 는 title 속성 span(폰에서 안 보임) 대신 tip(). '기준' 시각은 KST(kstStamp). 총자산 ⓘ·문서는 실제 규칙(증권사 국내 총평가 tot_evlu_amt + 미국×환율 + 외화×환율 · 가수도정산 전엔 현금+주식 ≠ 총자산)으로. D+1 메모는 `cashUsd === 0` 일 때만(조회 실패 null 은 보류).
- **고치지 않은 것(검토 의견 중):** 점검 제안 문구(rule-presets)는 chainBreaks 가 ok 에서 빠지면서 그대로 맞게 됐다. 체인 fills 에 거래일(tradeDate) 필드를 더하는 것은 변조 증거에 필요하지 않아 넣지 않았다. 평가점 800개 상한은 위에 적음.
- **검증:** test/paper-chain.test.js +1(verifyAgainstMarks)·CLI 케이스 확장, test/paper-live-us.test.js +1(기준선 전 평가점)·체인 테스트를 닫힌 날 공개로 고침·미국 체결 기대 뒤집음, test/paper-benchmark.test.js +1(읽기: 캐시·갱신 실패·범위)·보류 케이스 확장, test/kis-reader.test.js +1(cashUsdError), test/real-record.test.js +2(보류 fail-closed · 체결 시각 무관), test/paper-ui-layout.test.js TC-UI-REORG-04/05 갱신. 전체 335/335(329 + 6). 공개 파일·장부·서버는 건드리지 않았다(PC 서버 재시작 뒤 새 엔진이 체인을 시작한다).

## (24) 2026-11-12 실계좌 기록을 토스 종합계좌로
- **왜:** 한투 실전 계좌(****2259)는 0원·보유 0(2026-11-12 조회). 실제 돈은 토스 종합계좌(국내 1·미국 5종목)에 있다. 검증 기록은 실제 돈이 있는 계좌여야 의미가 있다.
- **무엇:** lib/toss-record-reader.js 가 토스 Open API 조회(lib/toss.js)를 real-record 리더 모양(settings/balance/orders)으로 감싼다. 주문 함수 없음. REAL_RECORD_SOURCE=toss 면 dev-server 가 토스로 기록(장부 real-toss.json, 공개 안 함). 한투 읽기 전용 경로는 그대로 남는다.
- **현금 없음 → 시간가중:** 토스 API 는 현금을 주지 않아 총자산 = 보유 주식 평가. 적립 입금·추가 매수가 수익으로 잡히지 않게 평가점에 보유 기준 시간가중 지수(index = 전 수량 × 오늘 가격 ÷ 전 수량 × 전 가격의 누적곱)를 두고, compare() 는 index 가 있으면 그 비율로 지수와 비교한다(basis twr). 한계: 같은 날 사고판 손익·배당 현금·현금 이자는 빠진다. index 는 체인 payload 에 넣지 않는다(봉인 형식 유지).
- **환율:** 토스 매매기준율 우선, 없으면 Yahoo KRW=X, 둘 다 없으면 보류(fail-closed).
- **검증:** test/toss-record.test.js 4개(래퍼·시간가중·비교 기준·보류).
## (25) 2026-11-12 종목 근거 카드와 계획 PP3 (모의투자 기준 v2)
- **왜:** PP1 은 섹터 대표 회사를 변동성 역수로 담아 종목별 이유가 "변동성 연 70%" 한 줄뿐이었다. 사용자 결정: 보유 근거는 성장·기업가치, 변동성은 근거가 아님, 개별 종목(위성) 50%, 현금은 넉넉히, 추가 매수 시점 규칙, 기존 모의계좌를 그대로 전환.
- **근거 카드(lib/thesis-cards.js · data/thesis-cards.json):** 98개 기업(공개 재무·주가)에 대해 ① 성장: 최근 4개 분기 매출(금융은 영업이익) 전년 대비 5% 이상 + 성장 예측 상위 40% ② 질: 영업이익 감소 아님 · ROE 8% 이상 ③ 가치: PER(적자면 PSR)이 자기 과거 5년의 70번째 백분위 이하 · 순이익이 영업이익의 2배를 넘으면(일회성) 보류 ④ 깨짐: 2개 분기 연속 역성장 · 영업이익률 5%p 급락 · 순손실. 판정 pass / wait(비쌈) / fail / nodata. 2026-10-30 기준 통과 12 · 대기 11 · 탈락 74 · 자료 없음 5.
- **계획 PP3(data/paper-plan.json · PP1 은 paper-plan.pp1.json 으로 보관):** 핵심 지수 35%(미국 25 · 국내 10) + 위성 50%(통과 종목만 · 성장 순위와 가격 여유 평균 순 · 균등 · 종목 ≤7% · 섹터 ≤15%) + 현금 15%. 위성 9종목(엔비디아·SK하이닉스·삼성전자·아마존·셀트리온·한미약품·일라이릴리·한국항공우주·GE), 모자란 5%는 지수로. 현대차 그룹 제외.
- **나눠 사기 60/20/20:** 지금은 1단계(목표의 60%)만 산다. 2단계 = 다음 실적이 성장 근거 확인, 3단계 = 가격이 자기 과거 중간값 이하 또는 첫 매수보다 15% 하락(근거 유지). 남은 몫은 매수 대기 현금(지금 현금 33% = 예비 15 + 대기 18). 2·3단계 자동 판정은 아직 없음(다음 작업).
- **전환:** 새 계획에 없는 보유는 pct 0 · exit 로 적고, 엔진이 그 표시가 있는 종목만 정리한다(표시 없는 계획 밖 보유는 전처럼 그대로 둔다). 한화에어로스페이스·HD현대중공업·록히드마틴은 재무 자료가 없어 근거를 세울 수 없어 정리, 마이크로소프트는 카드 통과지만 섹터 상한에서 밀려 정리.
- **한계(정직하게):** 자체 연구 G2 에서 성장·가치는 표본 외 주가 초과수익을 맞히지 못했다. 카드는 보유 설명과 매도 기준이다. 위성 묶음 성과를 지수와 따로 재는 표시는 아직 없음(다음 작업). 종목군은 연구용 98개로 제한된다.
- **검증:** test/thesis-cards.test.js 4개, 전체 343/343.
## (26) 2026-11-12 긴급 대응 감시(공시 기반 · 규칙 판정)
- **왜:** 사용자 요청 — 개별 이슈(오너·정치·회계)에 실시간 대응, 모의계좌에서는 자동으로. 뉴스 해석은 오탐이 많고 이미 가격에 반영된 뒤라, 사실인 공시 유형으로 판정한다.
- **무엇(lib/issue-watch.js):** 위성 종목의 공시를 10분마다 조회(국내 DART list · 미국 SEC submissions 의 8-K). 긴급 = 횡령·배임 / 감사의견 거절·한정·부적정 / 거래정지·상장폐지·관리종목 / 회생·부도·영업정지 / 불성실공시법인 지정 / 주요 공급계약 해지 / 8-K 4.02·1.03·3.01. 주의 = 유상증자 / 주식 관련 사채 / 소송 / 조회공시·지정 예고 / 실적 정정 / 최대주주·대표이사 변경 / 감자 / 8-K 4.01·5.02·2.06·1.02·2.04.
- **행동은 엔진이 제한(lib/paper-live.js setIssue):** 주의 = 그 종목 추가 매수 정지 14일. 긴급 = 계획 비중 절반 + 추가 매수 정지 30일 → 계획 버전에 +I 가 붙어 다음 열린 장의 자동 재조정이 평소 주문 보호를 거쳐 줄인다. 절반은 겹쳐 줄이지 않는다. 핵심 지수·정리 대상에는 걸지 않는다. 같은 공시는 한 번만. 감시 모듈은 주문을 만들지 않는다.
- **한계:** 제목·항목 번호만 본다(유상증자 규모 등은 모름 → 주의로만). 뉴스·경영자 발언·가격 급변은 v1 에서 보지 않는다. AI 판정 없음(비용·재현성) — 나중에 주의 등급 해석에만 붙일 수 있다. 이슈 기록은 장부와 공개 파일(issues)에 남지만 해시 체인 payload 에는 아직 넣지 않았다. 대응 효과(했을 때 vs 안 했을 때) 비교는 아직 없음.
- **검증:** test/issue-watch.test.js 4개.
## (27) 2026-11-12 위성 묶음 성과 · 나눠 사기 단계 · 뉴스·가격 급락 주의
- **위성 묶음 성과(status.sleeve):** 위성 종목마다 첫 매수 뒤 수익을 같은 기간 그 나라 지수(KODEX 200 · S&P500 ETF)와 비교하고 평가액 가중으로 묶는다. "개별 종목을 고른 것이 지수보다 나았는가"를 포트폴리오 전체의 지수 대비와 따로 본다. 카드에 한 줄과 종목별 표, 공개 파일에 sleeve.
- **나눠 사기 단계(ledger.tranche):** 위성은 목표 비중의 60% → 80% → 100%. 올리는 조건(각각 한 번): ① 첫 매수가보다 15% 하락 ② 새 분기 실적으로 다시 만든 카드가 통과 ③ 다시 만든 카드에서 가격이 자기 과거 중간값 이하. 올리지 않는 조건: 카드 탈락(근거 깨짐) · 이슈가 걸려 있음 · 포트폴리오가 지수 대비 −5%p 이하. 단계가 오르면 계획 버전에 +T 가 붙어 다음 열린 장의 재조정이 산다. ②③은 카드를 다시 만들어야(scripts/build-thesis-plan.mjs · 재무 자료 갱신) 작동한다 — 자동 갱신은 아직 없다.
- **위성 추가 매수 금지:** 포트폴리오가 비교선보다 5%p 넘게 뒤처져 있으면 위성 종목 매수 주문을 막는다(지수 매수·매도는 그대로). "초과 낙폭" 대신 운용 시작 뒤 누적 지수 대비를 쓴다(단순화).
- **뉴스·가격 급락 → 주의까지만:** 하루 수익이 그 나라 지수보다 8%p 넘게 나쁘거나, 뉴스 제목에 회사 이름과 위험 낱말(수사·규제·제재·리콜·보안 사고·파업·경영진·과징금·회계)이 함께 있으면 추가 매수 14일 정지. 뉴스·가격으로는 팔지 않는다(공시만 매도 근거). 경영자 발언 자체는 위험 낱말이 없으면 반응하지 않는다.
- **확인:** 엔비디아가 계획에 있는데 매수가 안 나오는 것은 미국 200일선 규칙 때문(2026-11-12 주가 173.7 < 200일 평균 204.5). 결함 아님.
- **남은 것:** 예비 현금 5%의 하락장 투입 규칙, 재무 자료·카드 자동 갱신, 대응 효과 비교, 이슈 기록의 체인 봉인.
- **검증:** test/tranche-sleeve.test.js 4개.

## (28) 2026-11-12 위성 종목에는 200일선 규칙을 쓰지 않는다
- **왜:** 200일선 규칙은 미국 지수에서 낙폭을 줄이는 효과로 넣은 것이다. 위성 종목의 살 이유는 근거 카드(성장·가치)인데, 싸진 종목은 대개 200일선 아래라 가치 기준·15% 하락 추가 매수와 부딪혔다(엔비디아: 카드 통과, 주가 173.7 < 200일 평균 204.5 로 매수 차단). 사용자 결정.
- **무엇:** lib/paper-live.js decide() 에서 계획 문서의 role 이 satellite 인 종목은 trendApplies 를 끈다. 핵심 지수(S&P500 ETF)에는 그대로 적용. 위성의 하락 위험은 카드의 깨짐 조건·이슈 감시·종목 7%·섹터 15% 상한이 맡는다.
- **검증:** test/tranche-sleeve.test.js 에 1개 추가, 전체 352/352.
## (29) 2026-11-12 만드는 이유 재확인 · 노션과의 대조 · 카드 기준 과거 검증
- **만드는 이유(사용자 확인):** 직접 점검할 시간이 없는 개인 투자자가, 미리 정한 원칙대로만 사고팔리게 하고, 모든 매매의 이유와 결과를 나중에 고칠 수 없게 남긴다. 노션 PoV("원칙은 있지만 다수 종목을 지속 점검·일관 적용하는 데 시간·인지 한계 → 규칙 검증과 근거 확인")와 같다. 수익을 더 내는 것은 목적이 아니다(근거 없음).
- **노션 대조(2026-11-06 사본·과제 문서 기준 · 이번엔 노션이 자동 접근을 막아 원문 미확인):** HMW C·Product Goal·실거래 제외는 일치. HMW A(코딩 없이 규칙 확인)는 부분 — 기준을 화면에서 볼 수 있게 했고(계획 문서의 "지금 기준" 표) 바꾸는 것은 아직 스크립트. HMW B(미사용 구간)는 아래 검증으로 보완. "AI 에이전트" 표현은 "규칙 기반 판단 보조"로 고치기로 결정(언어 모델 없음). 수익 모델(월 구독)은 지금 실현 불가로 보고 보류(유료 권유는 투자자문업 등록 대상일 수 있음) — 노션 반영은 쓰기 권한이 없어 수정안만 worklogs/notion-2026-11-12/ 에 둔다.
- **카드 기준 과거 검증(scripts/thesis-backtest.mjs · data/thesis-backtest.json):** 매달 말 그때 공개된 재무와 그 달의 표본 외 성장 예측으로 카드를 만들어 통과 종목(동일 비중)의 다음 달 수익을 같은 시장 종목군 전체와 비교. 2021~(미사용 구간): 국내 +0.58%p/월(t 0.56, 이긴 달 52%, 평균 3.4종목), 미국 +0.93%p/월(t 1.96, 57%, 평균 6.6종목). ~2020: 국내 +4.2%p(t 1.04, 23개월), 미국 +0.5%p(t 1.01).
- **해석(정직하게):** 방향은 양(+)이지만 국내는 우연과 구분되지 않고 미국은 경계선이다. 종목군이 2026년에 고른 98개(생존·선택 편향), 통과 종목이 3~7개로 적음, 비용·세금 없음, 월 1회 전부 교체 가정. "기준이 통한다"는 증거가 아니라 "기준이 해롭다는 증거는 없다" 수준. 앞으로의 검증은 모의계좌의 위성 묶음 · 지수 대비가 맡는다.
- **화면:** 계획 문서가 "판단 기준과 검증 보기"로 바뀌어 지금 기준 표 · 심사 결과 · 과거 적용 결과(구간별) · 비중과 이유를 보인다. 공개 파일 planDoc 에 criteria·backtest·screening 추가.

## (31) 2026-11-13 운용 5일째 점검에서 드러난 결함 세 가지
- **위성 "같은 기간 지수"가 틀렸다:** 진입일 봉이 아직 없으면(오늘 산 종목) 1년 전 봉으로 떨어져 지수 +42.6%로 계산됐고(한미약품·셀트리온·한국항공우주), 묶음 지수 대비가 −16.89%p로 나왔다. 값은 서버가 꺼질 때까지 굳어 있었다. → 진입일 시가 기준(주문은 장 시작 직후), 봉이 없으면 null(비교 전, 묶음 평균에서 제외), 10분마다 다시 계산. 종목 가설의 지수 비교도 같은 함수다.
- **정리 종목이 남는다:** 록히드마틴 매도(지정가 611.86달러)가 가격 하락으로 체결되지 않았는데, 같은 묶음에서 다른 주문이 나갔으므로 계획은 집행으로 적혔다. 평소 점검은 오른 종목을 그대로 두는 설정이라 정리 종목을 다시 팔지 않는다. → 계획이 집행으로 적힌 뒤에도 그 시장에 정리(exit) 종목이 남아 있으면 다음 거래일에 재조정으로 다시 낸다(계획 버전·시장마다 3번까지, 이유 "전환 잔여"). 미체결 주문 전체를 잔여로 보는 안은 버렸다(보낸 주문은 집행으로 본다는 기존 약속과 부딪힘 · 모자란 매수는 평소 점검에도 나온다).
- **뉴스 오탐:** "젠슨 황 사임에도 … 삼성전자·SK하이닉스 급등" 같은 제목이 삼성전자·SK하이닉스의 경영진 이슈로 잡혀 추가 매수가 14일 막혔다. → 회사 이름(또는 별칭: 엔비디아 = 젠슨 황)이 위험 낱말보다 앞에 있고, 그 낱말에 더 가까운 다른 감시 종목 이름이 없을 때만 잡는다. 걸려 있는 뉴스 주의는 감시가 돌 때마다 지금 기준으로 다시 보아 해당이 없으면 푼다. 놓치는 제목(낱말이 이름보다 앞)이 생긴다 — 뉴스는 주의까지만이고 공시가 주 경로다.
- **기록 표기:** 자동 실행 기록의 "보냄"이 아직 체결 전인 주문만 세어 8건을 보내고 "2건 전송"이라 적혔다 → 접수된 주문 수로 센다.
- **확인된 사실(엔비디아):** 2026-11-12 SEC 8-K 5.02(임원 변동) 제출, 11-13 오전 연합뉴스·뉴시스 등 다수가 CEO 퇴진을 보도. 엔비디아는 PP3 위성(3%)이었지만 11-12 뉴스 주의로 매수가 막혀 보유하지 않았다. 한 번의 사례라 감시의 효과를 말할 수는 없다.

## (32) 2026-11-13 모의계좌 오류 분석(5일 · 주문 39건)과 개선
- **체결:** 39건 중 34건 체결, 미체결 5건은 전부 매도였다(11-09 3건은 재조정 때 취소, KODEX 200 1건 장 마감 소멸, 록히드마틴 1건). 원인은 지정가를 현재가에서 불리한 쪽으로 맞춘 것(매수 내림 · 매도 올림)이라 가격이 조금만 멀어져도 안 채워졌다. 체결된 34건의 평균가는 모두 지정가와 같거나 유리했다(최대 0.54%). → 바로 맞는 지정가: 매수 +0.5% 올림, 매도 −0.5% 내림(호가 단위, 허용 폭 3% 안). 체결가는 그때의 가장 좋은 호가이고 지정가는 한도일 뿐이라 비용이 늘지 않는다고 본다(모의 기준, 실거래 확인 전).
- **뉴스 주의:** 이틀 동안 오탐 3건(다른 회사 기사 2건, 오래된 사건 판결 1건). → 같은 위험 낱말 기사가 서로 다른 언론사 2곳 이상일 때만 주의. 기준 전에 보도 1곳으로 걸린 주의는 다음 감시 때 2곳 이상 보도가 없으면 푼다. 공시(DART·SEC)는 1건으로 충분하다.
- **측정:** 위성 지수 비교 오류는 결정 31로 고쳤다. 미국 종목의 진입일 봉은 다음 날 아침에 들어오므로 그때까지 비교는 비어 있다.
- **고치지 않은 것(판단 필요):**
  - **계획 교체 비용:** 5일에 계획 3번(첫 매수 · PP1 · PP3), 정리한 11종목의 손익 −21만 원, 거래대금 1.8억 원(계좌의 1.8배). 모의에는 수수료·세금이 없어 실거래면 더 크다. 제안: 계획 교체는 월 1회까지로 하고, 교체 전에 예상 거래대금을 보인다.
  - **1주 단위:** 일라이릴리는 1주가 1.9%라 목표 3%에 못 미치고, 0.4~1.1% 모자란 3건은 1주 미만이라 안 산다. 모의계좌(KIS)는 소수점 주문이 없다. 실계좌(토스)는 미국 금액 주문이 된다.
  - **30일 매매 횟수:** 상한 8회인데 재조정 묶음은 1회로 세어 실제 주문은 39건이다. 상한은 판단 횟수를 막는 것이지 주문 수가 아니다 — 그대로 둔다.
  - **서버 중단:** 11-12 저녁 중단은 사용자가 직접 재시작한 것이었다(결함 아님).

## (33) 2026-11-13 화면 개편: 시장 탭 · 차트 · 모의투자 한눈에 (사용자 의견)
- **사용자 의견:** "매매 전 확인"은 종목 6개만 떠서 의미가 없다 → 오늘 장·섹터·종목·매수/매도를 네이버 주식처럼. 차트의 "보이는 기간 이동"·"날짜별 가격"은 무엇을 하는지 모르겠다. 모의투자는 원금보다 얼마 벌었는지도 없고 무엇을 봐야 할지 모르겠다.
- **시장 탭(market-ui.js · lib/market-overview.js · /api/market-overview):** 지수 5개(코스피·코스닥·S&P500·나스닥·달러/원), 투자자별 순매수(개인·외국인·기관, 억원), 업종 79개 등락(누르면 그 업종 종목), 종목 순위(시가총액 상위·상승·하락·거래량, 코스피/코스닥), 내 종목 오늘. 종목을 누르면 종목·주문 점검으로 넘어간다. 섹터·이슈·뉴스 화면을 같은 묶음의 작은 탭으로 모았고 더보기에서는 뺐다. 메뉴: 홈 · 시장 · 모의투자 · 성적표 · 규칙.
  - 출처는 시세와 같은 공개 시세 페이지(네이버 증권)이고 값을 바꾸지 않는다. 토스 Open API 의 시장 자료는 쓰지 않았다(본인 매매 목적 외 배포 금지 조건 · 공개 사이트에 실을 수 없음). 서버에서 45초 캐시, 장중 1분마다 갱신. 한 부분이 실패하면 그 이름만 적고 나머지는 보인다.
  - 2026-11-09 방향 메모("정보량으로 네이버와 경쟁하지 않는다")와 긴장이 있다 — 이 화면은 정보를 늘리려는 것이 아니라 "내 종목·규칙으로 넘어가는 입구"로 둔다. 순위·등락은 사실 나열이고 권유가 아니다.
- **이름:** 화면 문구의 "매매 전 확인" → "주문 점검"(화면 이름은 "종목·주문 점검"). 엔진·테스트의 절차 이름은 그대로.
- **차트(lib/candlestick-view.js):** 슬라이더 두 개를 없앴다. 기간 단추(선택 표시) · 일/주/월 · ◀ ▶ · 끌어서 이동 · 마우스를 올리면 그날 값이 위 한 줄에 · 거래량 막대 · 확대는 Ctrl+휠(전에는 휠만으로 확대돼 화면 스크롤을 가로챘다).
- **모의투자:** 맨 위에 총자산 · 원금 대비 손익(원·%) · 전날 대비 · 지수 대비 · 현금, 날마다 총자산 선. 보유표에 평균단가·현재가·손익·수익률·비중(계획), 담은 이유는 줄마다 펼침. 주문 기록·운용 점검·기준선·판단 기준은 접어 두고, 과거 데이터 검증·절차 설명은 한 묶음으로 접었다(연 상태는 기억). 원금은 서버 설정 PAPER_LIVE_PRINCIPAL(모의계좌를 만들 때 받은 가상 예수금) → 상태·공개 파일의 principalKrw. 없으면 첫 평가점 기준이라고 적는다. 실계좌(토스) 카드도 같은 보유표를 쓴다.
- **결함 수정(33-1):** 미국 잔고 조회가 실패하면 증권사 클라이언트가 미국 보유분을 뺀 잔고를 돌려주는데(usError), 엔진이 그 잔고로 평가·게시했다(2026-11-13 15:15 공개 파일에 미국 5종목 없음 · 현금 7,510만 원). 같은 잔고로 판단했다면 이미 가진 미국 종목을 다시 살 수 있었다. → 불완전한 잔고는 '읽지 못함'으로 다룬다: 주문 판단 중단, 평가점 기록 안 함, 공개 파일 게시 건너뜀.
- **QA:** 격리 서버(8774 · 키 없음) 헤드리스 크롬 1600px·390px — 시장·종목·모의투자 화면 오류 0, 가로 넘침 0. 테스트 362.

## (34) 2026-11-13 화면 재조정: 규칙이 중심 · 계좌마다 규칙 한 벌 · 바꾸기 잠금 (사용자 의견)
- **사용자 의견:** 모의투자 탭에 왜 실계좌 읽기 전용이 있는지, 성적표 탭이 왜 있는지 모르겠다. 이 서비스의 가장 큰 기능은 "규칙을 지킬 수 있다"인데 규칙을 세우는 과정이 이상하고 매번 바꿀 수 있다. 왜 이 규칙인지, 얼마나 위험한지, 과거 시장에 넣으면 어땠는지를 보여 달라. "세부 전략 근거"는 무엇인지 모르겠다.
- **점검에서 확인한 사실(코드 기준):** ① 규칙이 세 벌(브라우저 저장 · PC 모의계좌 장부 · 기본값)인데 화면은 한 벌처럼 보였고, 모의계좌 수동 미리보기·주문은 브라우저 규칙을 보냈다(자동 실행은 장부 규칙). ② "세 질문으로 정하기"가 만드는 값 가운데 과거 검증이 있는 조합이 없었고, 섹터 수·점검 주기 질문은 엔진에 거의 닿지 않았다. ③ 규칙 변경에 횟수·간격 제한이 없었다. ④ 성적표는 "최근 1년 체결"을 전제로 해 운용 5일·주문 20건인 모의계좌에는 맞지 않았다. ⑤ 검증 자료(data/core-validation.json)에 위기 구간(코로나 급락 · 2022 하락장 · 2026 하반기) 값이 있었지만 화면이 쓰지 않았다. ⑥ 실계좌 기록 카드의 보유표는 기록 응답에 평균단가·현재가가 없어 "—", "0원 · 0.00%"로 찍혔다(결정 33에서 내가 같은 표를 재사용하며 만든 결함).
- **메뉴:** 홈 · 규칙 · 모의투자 · 시장 · 더보기. 성적표 탭을 없애고 규칙 화면의 "내 계좌 최근 기간" 접힘으로 옮겼다(예전 주소는 규칙 화면으로 넘긴다). 결정 33의 메뉴(홈 · 시장 · 모의투자 · 성적표 · 규칙)를 대체한다.
- **규칙 화면(core-ui.js):** 위에서부터 ① 지금 규칙(한 줄 요약 · 확정일 · 변경 횟수 · 다음 변경 가능일) ② 왜 이 규칙인가(규칙마다 한 줄 이유 · 쓰지 않기로 한 방법) ③ 얼마나 위험한가(지금 보유로 나쁜 날 하루 손실 · 계획과 규칙대로 맞춘 뒤 · 과거 가장 크게 빠졌을 때 · 가장 나빴던 1년, 모두 "그냥 보유"와 나란히) ④ 과거 시장에 넣어 보면(묶음 4개 선택 · 위기 구간 3개 · 2012~2026 통계 · 매매 횟수 · 수익은 그냥 보유보다 낮았다는 사실을 같이 적음) ⑤ 규칙을 지켰나(모의계좌는 장부 기록, 그 밖은 오늘 점검 + 최근 기간). 그 아래 접힘: 규칙 바꾸기 · 종목별 목표 비중 · 검증 자료 원본. "세 질문으로 정하기"와 "세부 전략 근거" 구역은 없앴다(근거 자료는 "검증 자료 원본" 접힘에 출처와 함께 남김).
- **계좌마다 규칙 한 벌:** 홈이 모의계좌면 규칙 화면은 그 계좌의 규칙(PC 장부 · 공개 파일)과 계획을 읽기 전용으로 보인다. 예시·실계좌는 브라우저에 저장한 규칙. 모의계좌 수동 미리보기·주문은 더 이상 브라우저 규칙·계획을 보내지 않는다(자동 실행과 같은 기준).
- **수준(lib/rule-presets.js RULE_LEVELS):** 과거 검증이 있는 두 가지만 고르게 했다 — 기본(검증 변형 C = 기본 규칙), 안정(변형 B = 하루 손실 한도만 1.5%). 직접 입력은 남기되 "과거 검증 없음"이라고 표시한다. 한도를 4%로 올린 "적극" 수준은 검증 변형이 없어 넣지 않았다(scripts/validate-core.mjs 에 변형을 추가해 돌린 뒤에만 넣는다).
- **바꾸기 잠금:** 확정한 뒤 28일(RULE_LOCK_DAYS) 동안은 바꿀 수 없고, 그 뒤에도 이유 10자 이상을 적어야 하며 이력 20건을 남긴다(changeGate · applyChange). 처음 확정과 확정 기록이 없는 예전 저장분의 한 번은 바로 된다. 모의계좌는 서버에서 막는다 — createPaperLive({ prefsCooldownDays }), dev-server 기본 28(환경변수 PAPER_LIVE_PREFS_COOLDOWN_DAYS), 잠금 중 setPrefs 는 409 prefs_locked(allowedAt). 상태·공개 파일에 prefsCooldownDays · prefsNextChangeAt. 28일은 과거 검증으로 고른 값이 아니라 "월 1회 이하"로 잡은 운영 값이다.
- **모의투자 화면:** 모의계좌 하나만. 실계좌 기록 카드는 홈으로 옮겼다(#hm-real · 홈이 실계좌이고 PC 가 기록을 줄 때만 · 보유표 없음 · 25분에 한 번 조회). 결정 22의 "모의 카드 아래" 위치를 대체한다. 요약 아래에 규칙 준수 한 줄(하루 한도 넘은 날 · 매매 결정 횟수 · 규칙 변경 횟수 → 규칙 보기).
- **홈:** 모의계좌일 때 "할 일은 모의계좌가 스스로 정해 주문합니다"로 바꾸고 현금 입력을 숨겼다. "월별 주식 자산"·"매매 성적표" 카드도 숨긴다(공개 파일의 최근 주문 20건으로 1년을 거꾸로 계산해 틀린 그림이 나왔다).
- **작은 수정:** 규칙 화면 표가 잘리던 원인(.table-wrap table{min-width:420px})을 규칙 화면에서 해제. "규칙을 지켰나"의 지수 비교는 모의투자 화면의 "지수 대비"와 같은 비교선(benchmark.benchRetPct)을 쓴다.
- **한계:** 브라우저 잠금은 그 브라우저 저장소에만 있어 저장소를 지우면 풀린다(강제 장치가 아니라 마찰 장치). 과거 검증은 고정 묶음 4개 × 수준 2개뿐이고 사용자의 실제 보유로 돌린 것이 아니다. 실계좌 홈 카드는 격리 서버에 토스 키가 없어 실제 자료로 확인하지 못했다.
- **QA:** 격리 서버(8774 · 키 없음) 헤드리스 크롬 1600px·390px — 규칙(예시·모의) · 확정/잠금 흐름 · 모의투자 · 홈 오류 0, 가로 넘침 0. 테스트 365.

## (35) 2026-11-15 자동 실행이 장 시작 직후에 걸려 하루를 날린 결함 · 수학 모델 방식 검토(위험 예산)
- **결함(35-1):** 2026-11-13(금) 미국 장에서 주문이 한 건도 나가지 않았다(정리 대상 록히드 마틴 5주가 그대로). 자동 실행은 10분마다 돌고 그 위상은 서버를 켠 시각이 정한다. 11-13 21시쯤 서버를 다시 켠 뒤 위상이 "매 10분의 1분 52초"가 됐고, 23:31:52 에 돈 자동 실행은 주문 점검의 "장 시작 뒤 5분 안에는 주문하지 않음"에 전부 막혔다. 그런데 그 시도가 그날 몫으로 적혀(시장·거래일마다 한 번) 10분 뒤에 다시 보지 않았다. 결정 31에서 넣은 "전환 잔여 재시도"가 이 경우를 보지 못했다(내가 놓친 것). 같은 위상이면 국내 장(09:01:52)도 똑같이 막힌다.
  - 고침: 장이 열린 지 minutesAfterOpen 분이 안 됐으면 그 점검은 건너뛴다(장부에 아무것도 적지 않음 → 다음 점검이 본다).
  - 함께 고침: 집행 판정이 닫혀 있는 다른 시장의 대기 항목까지 "다시 시도할 만한 막힘"으로 세어 미집행으로 적던 것 → 그 시장 항목만 본다. 막힌 이유 묶음 이름이 "장이 끝났습니다(15"로 잘리던 것(시각의 ':').
  - 남는 것: 그날 헛돈 시도가 재시도 3번 중 1번을 썼다(2번 남음). 2026-11-16(월) 밤 미국 장에서 다시 나간다.
- **수학 모델 방식 검토(사용자 요청 · 자세한 것은 docs/research-2026-11-15-quant-model.md):**
  - 퀀트 모델의 네 부분 가운데 수익 예측은 만들지 않는다(자체 검증에서 표본 밖 예측력이 없었고, 문헌에서도 기대수익 추정 오차가 가장 크다). 위험 모델은 이미 있다(GARCH · 계좌 하루 손실 범위). 비어 있는 것은 "얼마를 담을지"다 — 개별 종목 각 3%는 손으로 정한 값이다.
  - 다음 모델을 **위험 예산 모델**로 정의: 무엇을 살지는 근거 카드, 얼마를 담을지는 위험, 언제 맞출지는 벗어난 폭. 기대수익은 입력으로 쓰지 않는다.
  - 측정(scripts/research/sizing-study.mjs → data/sizing-study.json · 수익 비교 없음): 균등 3%에서 지수와 다르게 움직이는 정도(추적오차) 연 4.15%의 62%가 한미약품·한국항공우주·셀트리온에서 나온다. 위험 기여 균등으로 나누면 4.15% → 3.53%, 2018~2026 실제 값 3.11% → 2.73%(−12%). 계좌 전체 변동성은 같다. 25% 넘게 벗어날 때만 맞추면 맞추는 횟수 115 → 41, 흔들림은 같다. 종목 변동성 역수만으로는 거의 효과가 없다(상관을 넣어야 한다).
  - 개별 종목 합계(27%)는 수식으로 정해지지 않는다: 지금 크기는 묶음이 지수보다 연 약 1.9% 더 번다고 믿을 때 맞는 크기이고, 우리 자료로는 그 값을 0과 구분하지 못한다 → 위험 예산으로 사용자가 정할 값.
  - 만든 것: lib/risk-budget.js(줄인 공분산 · 위험 기여 · 묶음 배분), 규칙 화면 "얼마나 위험한가"에 "계획의 위험은 어디서 나오나"(모의계좌일 때 · 자료의 계획 버전이 지금 계획과 같을 때만 · 읽기만). **계획은 바꾸지 않았다.**
  - 새로움: 없다. 방법은 모두 기존 것이고 한 일은 측정과 구현이다.
- **사용자 흐름 재검토(구현하지 않음 · 같은 문서 6절):** 홈이 규칙 확정 전에도 매도 할 일을 먼저 보인다(예시 자산: 1,695만 원 중 약 833만 원). 계획(목표 비중)이 가장 깊이 숨어 있고 잠금이 없다. 할 일 금액이 원 단위다. 실계좌는 실행 뒤 확인 단계가 없다. 평가가 네 군데에 흩어져 있다. 첫 화면 문구가 지금 목적과 다르다.
- **사용자 결정 대기:** ① 계획의 종목 비중을 위험 기여 균등으로 바꿀지(사고파는 금액 합계 계좌의 약 7%) ② 개별 종목 합계 27%를 위험 예산으로 다시 정할지 ③ 계획 변경 월 1회 제한 + 예상 거래대금 표시(결정 32 제안) ④ 흐름 개편(진행 줄 · 계획 단계 승격 · 평가 한 곳).
- **확인:** 새 테스트 2건은 고치기 전 엔진에서 실패하고 고친 뒤 통과. 전체 테스트 371.

## (36) 2026-11-15 계획 변경 한도 30일 2회 · 바꾸기 전 예상 거래대금 · 인구구조와 중국 조사 (사용자 결정)
- **사용자 결정:** 계획(목표 비중)은 월 1회가 아니라 월 2회까지 바꿀 수 있게 한다. 큰 이슈나 실적 발표에는 대응해야 하지만 그렇다고 매번 바꾸는 것은 아니다. 위험 모델(결정 35) 방향은 좋다. 인구구조 변화와 중국의 부상을 투자 방향의 핵심으로 보고 있으니 더 자세히 판단해 달라.
- **한도(lib/rule-presets.js):** 최근 30일 안에 2번까지(PLAN_CHANGE_MAX · PLAN_CHANGE_DAYS · planChangeGate). 다시 가능한 날은 가장 오래된 변경에서 30일 뒤. 2번·30일은 과거 검증으로 고른 값이 아니라 운영 값이다. 결정 32의 제안(월 1회)을 대체한다.
  - 계획의 지문(planSig)은 종목 · 비중 · 끝까지 살 비중 · 정리 여부만 본다. 이름·설명만 바뀐 것은 변경이 아니다.
  - 한도를 넣기 전의 변경은 세지 않는다(2026-11-15부터 센다). 지난 5일의 계획 교체 2번을 세면 12월 중순까지 한 번도 바꿀 수 없어, 실적·이슈에 대응한다는 결정의 취지와 어긋난다.
- **브라우저(예시·실계좌 · core-ui.js):** 처음 저장은 바로 된다. 그 뒤에는 "계획 변경 확인"을 거친다 — 바뀌는 비중 · 사고파는 금액 · 30일 안 몇 번째인지 · 이유(10자 이상). 한도를 넘으면 다시 가능한 날을 보이고 막는다. 기록은 접힘에 남는다. 규칙 잠금처럼 그 브라우저 저장소에만 있는 자기 약속 장치다.
- **모의계좌(lib/paper-live.js):** createPaperLive({ planChangeMax, planChangeDays, nextPlanDoc }). dev-server 기본 2 · 30(환경변수 PAPER_LIVE_PLAN_CHANGES · PAPER_LIVE_PLAN_CHANGE_DAYS, 0 = 끔).
  - 계획 파일(data/paper-plan.json)이 바뀌어도 한도를 넘으면 받아들이지 않고 장부에 채택해 둔 계획(ledger.planAdopted)으로 계속 운용한다. 새 파일은 "대기"로 보이고 한도가 풀리면 다음 점검에서 적용된다.
  - 공시 대응(+I)과 나눠 사기(+T)는 규칙이 정한 움직임이라 세지 않는다.
  - 공시 감시도 채택된 계획의 종목을 본다(paperLive.planDoc).
- **예상 거래대금:** 숫자를 둘로 나눴다.
  - 계획이 바뀌는 크기(planChangeSize): 두 계획의 비중 차이 합. "바꾸는 것 자체"의 매매량이다.
  - 지금 보유에서 그 계획까지(planTurnover): 아직 덜 산 종목이 섞인다. 처음에는 이 값만 보였는데 후보 계획이 "22.9%"로 나와 바꾸는 비용처럼 읽혔다 — 그중 17.3%p는 지금 계획대로 해도 남아 있는 몫이다. 그래서 바뀌는 크기를 앞에 둔다.
  - 둘 다 1주 단위 · 주문 한도 · 200일선을 적용하기 전의 단순 계산이다.
- **다음 계획 후보(data/paper-plan.next.json · scripts/research/build-plan-candidate.mjs):** 결정 35의 "위험 기여 균등"을 계획 형식으로 만든 것(PP4c). 개별 9종목 합계 27%는 그대로, 종목 사이만 다시 나눈다. **적용하지 않았다.** 규칙 화면 "종목별 목표 비중"에 바뀌는 비중과 금액이 보인다: 바뀌는 크기 약 743만 원(총자산의 7.4%).
  - 적용하지 않은 이유: 인구구조·중국 조사가 종목 구성을 바꿀 수 있어 한 번에 묶는 것이 변경 횟수와 거래대금을 아낀다.
  - 적용하려면 후보 파일 내용을 data/paper-plan.json 으로 옮기고 sizing-study 를 다시 돌린다(테스트가 버전을 본다).
- **인구구조와 중국 조사(docs/research-2026-11-15-demographics-china.md):**
  - 전제는 맞다: 65세 이상 21.6%(2026) → 30%(2036), 2차 베이비부머 954만 명 은퇴로 성장률 연 −0.16~−0.38%p, 건강보험 2026년 적자 · 준비금 2029~2033년 소진, 국민연금 2050년 적자 전환 전망. 중국 제조업 비중 약 28~30%, 로봇 설치 세계의 59%, CXMT D램 7.6%(2026년 1분기).
  - 측정(scripts/research/theme-check.mjs): 고령화·로봇·중국 주제 상품 11개 중 9개가 같은 기간 넓은 지수보다 낮았다. 고령화 상품 −1.6%p/년(10.5년), 로봇 −1.6~−4.2%p, 중국 −5.6~−9.7%p(13~19년). 넓은 헬스케어만 장기로 +0.4~+1.8%p.
  - 판단: 주제를 사는 것이 아니라 2차 효과를 본다. 고령화는 "돈을 낼 곳이 모자란다"가 핵심(값을 낮춰 주는 쪽·사람을 대신하는 쪽이 유리, 국가가 값을 정하는 쪽은 불리). 중국은 "중국 주식"이 아니라 "보유 종목의 경쟁자가 중국 자본시장에서 조달한다"가 핵심(메모리 2사와 KODEX 200이 가장 직접 노출). 국내 주식을 중국 자본이 사들이는 규모는 확인하지 못했다.
  - 쓰는 법(제안 · 구현하지 않음): 근거 카드에 질문 2개(수요와 돈 내는 곳 · 중국 경쟁자와 수출 통제 의존)와 그에 따른 깨짐 조건. 매매 시점에는 쓰지 않는다.
- **화면 수정:** 확인 상자의 표가 휴대폰에서 오른쪽으로 잘렸다(다른 스타일시트의 table{min-width:620px}) → 확인 상자 표에서 해제. 규칙 변경 확인 상자도 같은 표라 함께 고쳐진다.
- **확인:** 테스트 377(새 6건). 격리 서버 1600px·390px — 예시 계좌: 처음 저장 → 변경 확인 → 이유 없으면 막힘 → 1/2 → 2/2 → 세 번째 막힘. 모의계좌: 0/2 · 후보 표시. 오류 0, 가로 넘침 0.

## (37) 2026-11-15 종목 선정에 구조 질문(수요·돈 내는 곳 · 중국 경쟁) · 같은 깨짐 조건 묶음은 하나만 · 분기 자료 이상 보류 (사용자 결정)
- **사용자 결정:** 직전 제안 1번(근거 카드에 구조 질문 두 개와 깨짐 조건)으로 간다. "좋은 수익률은 좋은 종목 선정에 기반한다고 생각해서 그걸 가장 먼저." 자세한 것은 docs/research-2026-11-15-structure-cards.md.
- **전제 점검:** 수익은 소수 종목에 몰린다(미국 1926~2016 상장주 4.3%가 국채 초과 순부 전부 — Bessembinder). 그러나 2025년 미국 대형주 액티브 펀드 79%가 S&P 500 보다 낮았다(SPIVA). 그래서 규칙의 목표는 승자 고르기가 아니라 ① 구조적으로 질 이유가 있는 종목 빼기 ② 같은 이유로 같이 깨지는 종목 겹치지 않기다.
- **질문(lib/structure-cards.js · 자료 data/structure-cards.json SQ1-2026-11-15 · 24개 기업):** ⑥ 10년 뒤 주력 제품 수요가 인구·구조 변화로 느는가, 돈은 누가 내고 값은 누가 정하는가(순풍·중립·역풍). ⑦ 같은 것을 만드는 중국 기업과 점유율 방향, 중국 매출 비중, 방어선(기술·인허가 대 정책)(낮음·중간·높음). 종목마다 숫자로 적은 깨짐 조건(잴 것·기준·확인처·주기·지금 상태). 질문마다 출처·날짜가 있는 사실 2개 이상 — 형식이 틀리면 생성 스크립트가 멈춘다.
- **막는 조건:** 수요 역풍 · 중국 경쟁 높음 · 깨짐 조건 충족 · 답이 100일 넘게 묵음 · 답이 없음 → 정량 카드가 통과여도 대기. 정량 판정을 올리지는 않는다. 깨짐 조건의 "확인 전"은 막지 않는다.
- **같은 묶음 하나(lib/thesis-cards.js PLAN_RULES.oneCluster):** 깨짐 조건이 같은 묶음(메모리·AI 가속기·클라우드 등)에서는 점수가 가장 높은 하나만. 묶음 정보가 없는 카드는 예전과 같다.
- **분기 자료 이상(카드 TC2):** 최근 8개 분기에 영업이익 > 매출이거나 매출이 앞뒤 분기의 절반 미만이면 판정 보류(nodata · dataIssue). 삼성바이오로직스가 2025-11 분할 재작성으로 2025년 4분기 값이 깨져(매출 3,086억 · 영업이익 3,781억 원) 성장 −9.6% 탈락으로 잘못 처리돼 있었다. 회사 발표(분할 후 CDMO 기준)로는 2025년 매출 +30.3% — 자료 빌더가 공시의 재작성 전기 금액을 쓰게 고치기 전까지 후보가 아니다.
- **결과:** 지금 계획의 개별 9종목 가운데 한미약품만 막힘 — 중국 경쟁 높음(북경한미가 매출의 약 26%, 추정)과 미리 적은 깨짐 조건 충족(북경한미 매출 2026년 2분기 −29.9% · 3분기 −16%, 집중구매 가격 인하·유통사 채권 회수 지연). 같은 묶음: 삼성전자(메모리 · SK하이닉스가 앞섬), 마이크로소프트(클라우드 · 아마존이 앞섬), AMD(AI 가속기 · 엔비디아가 앞섬), 마이크론(메모리). 카드 집계: 통과 11 · 대기 12 · 탈락 73 · 보류 5.
- **다음 계획 후보 PP4c(data/paper-plan.next.json · 적용 안 함):** PP4(data/paper-plan.pp4.json: 엔비디아 (NVDA) · SK하이닉스 · 아마존 (AMZN) · 셀트리온 · 일라이릴리 (LLY) · 한국항공우주 · GE (GE)) + 위험 기여 균등 크기(data/sizing-study.pp4.json). 지금 계획 대비 바뀌는 크기 13.4%(약 1,345만 원). 규칙 화면 "종목별 목표 비중"에 바뀌는 비중과 빠지는 이유가 보인다.
  - 대가(측정): 종목이 9 → 7개로 줄어 추적오차(2018~2026 실제)가 균등 3.11% → 3.38%, 위험 기여 균등 2.73% → 3.28%로 커진다. 수익은 비교하지 않았다.
- **엔진:** 구조 질문에서 막힌 종목은 값이 15% 내려가도 나눠 사기 단계를 올리지 않는다(checkTranches). 계획 변경 후보 정보에 바뀌는 종목마다 계획 파일의 마지막 이유 한 줄(reasons)을 싣는다(공개 파일에도).
- **화면:** 규칙 화면 "종목별 목표 비중"에 "종목을 고른 이유 — 구조 질문"(지금 계획의 개별 종목 · 등급 · 돈 내는 곳 · 중국 매출 · 방어선 · 깨짐 조건 상태 · 출처 링크). 후보의 바뀌는 비중 표에 빠지는 이유.
- **조사:** 지금 계획 9종목 + 마이크로소프트·AMD·마이크론은 직접, 대기 11종목 + 삼성바이오로직스는 조사 보조(에이전트 1개)가 출처와 함께 쓰고 형식 검사·상태 판정은 직접. 조사 보조에게 준 형식에 깨짐 조건의 지금 상태 칸을 빠뜨린 것은 내 실수 — 앞의 4개 회사는 그 회사의 사실을 보고 직접 채웠다.
- **한계:** 답은 2026-11-15 의 사람 판단이라 과거로 검증할 수 없다. 등급 경계(10%·25%)와 묶음 경계는 운영 값·판단이다. 답은 100일마다 다시 확인한다.

## (38) 2026-11-16 계획 PP4c 적용 · 미국 매도 손익이 총자산에서 빠지던 결함 (사용자 결정)
- **사용자 결정:** 남은 일을 "해야 하는 일 / 안 해도 되는 일"로 나누라(추가·검증을 계속 늘리지 말 것) → 해야 하는 일만 진행: PP4c 적용 · 미국 매도 손익 수정 · 토스 첫 주문 확인(사용자가 앱에서) · 노션 기록. 하지 않기로 한 것: 월요일 미국 장 확인, 개별 종목 합계 재설정, 흐름 개편, 11-12 제안 3개, 자료 빌더 재작성 금액, 깨짐 조건 자동 계산·카드 자동 갱신, 종목 범위 확대, 예비 현금 하락장 투입(기준점 미정), 이슈 대응 효과 비교·체인 봉인, 급함·매매 횟수 상한 충돌, 구조 답 100일 재확인, 대회 종료 뒤 운용, 곁가지 사실 확인.
- **계획 PP4c(data/paper-plan.json):** 엔비디아 (NVDA) 3.56 · SK하이닉스 3.28 · 아마존 (AMZN) 5.43 · 셀트리온 3.43 · 일라이릴리 (LLY) 3.92 · 한국항공우주 2.55 · GE (GE) 4.43, S&P500 ETF 29.2 · KODEX 200 11.7. 정리: 한미약품(구조 질문에서 막힘) · 삼성전자(같은 묶음) · 록히드 마틴(남은 5주). 모의계좌 엔진이 2026-11-16 01:16 KST 에 채택(30일 2회 중 1회). 재조정은 국내 11-16 장 · 미국 11-16 밤 장. 엔비디아는 이슈 주의(뉴스 · 11-29까지)라 그때까지 매수가 막힌다(결정 26 규칙).
  - PP3 은 data/paper-plan.pp3.json 으로 남기고 후보 파일 data/paper-plan.next.json 은 지웠다(다음 후보는 build-plan-candidate 로 다시 만든다). sizing-study 를 PP4c 로 다시 돌렸다(지수와 다르게 움직이는 정도: 예측 균등 4.15% → 지금 3.87%, 2018~2026 실제 3.38% → 3.28%).
  - 규칙 화면 "계획의 위험은 어디서 나오나"는 계획이 위험 기여 균등이면 그 기준으로 쓴다(비교 열 = 똑같이 나누면). 그대로 두면 "계획은 그대로 균등입니다"가 틀린 문장으로 남았다.
- **결함(38-1) 미국 매도 손익이 총자산에서 빠짐:** 한투 모의계좌는 미국 매매를 원화로 정산하지 않는다. 사도 원화 예수금을 빼지 않고(결정 19) 팔아도 넣지 않는다 — 11-12 밤 JPM·JNJ·MSFT 매도(1,701만 원) 뒤 11-13 원화 예수금 변화 +1,243만 원 = 국내 순매도 +1,248만 원 − 세금·수수료 약 4.7만 원, 외화예수금 0. 결정 19 의 보정(지금 보유 미국 종목의 증권사 매입금액을 뺌)은 판 종목이 산 값 그대로 돌아온 것으로 처리해 매도 손익이 빠졌다. 결정 19 에서 "첫 매도 때 확인"으로 열어 둔 점을 첫 매도(11-12) 때 확인하지 않았다 — 내 누락.
  - → lib/paper-live.js settleUs: 장부 체결의 미국 순매수금액(산 금액 − 판 금액, 주문 때 환율)을 현금·총자산에서 뺀다. 장부 순수량이 증권사 보유 수량과 다르면(체결을 놓친 경우) 예전 식으로 돌아가고 fundingBasis 'broker'. 외화예수금이 있으면 빼지 않는다(그대로).
  - 효과: 11-16 총자산 100,371,336 → 100,077,727(−293,609 · 약 0.29%). 장부 미국 순매수 32,900,334 vs 증권사 매입금액 32,606,725. 지난 평가점(11-13~11-15)은 봉인돼 그대로 두고 11-16 평가점부터 새 식이다 — 지수 대비 숫자도 그만큼 내려간다.
  - 검증(11-16 10:30 KST · 장부 재계산): −293,609 = 판 종목 실현 손실 −249,991(JPM −31,618 · JNJ −32,320 · MSFT −186,053, 주문 때 환율) + 남은 종목 원가 차이 −43,618. 증권사 원화 매입금액은 거래가 없어도 날짜가 바뀌면 달라졌다(11-13~11-15 32,574,943 → 11-16 01:16 32,606,725, 보유 수량 같음 → 그날 환율로 다시 세는 것으로 보임 · 추정). 그래서 봉인된 11-13~11-15 평가점은 새 식보다 **325,391원** 높다(위 수정 때 record-definition 에 "약 29만 원"이라 쓴 것은 11-16 시점 비교 숫자를 옮긴 것 — 내 실수, 고침). 공개 카드의 11-15 → 11-16 '전날 대비' −325,391원은 전부 이 식 변경분이다(주말 · 가격 변화 없음).
  - 집행 확인(11-16 10:30): 국내 09:06 재조정 4건 전부 체결 — 한미약품 6주·삼성전자 13주 전량 매도, 한국항공우주 3주 매도, 셀트리온 1주 매수. 막힌 1건은 SK하이닉스로 보인다(2주 2.3% vs 계획 3.28% · 모자란 약 97만 원이 1주 약 115만 원보다 작아 "1주 미만"). 미국 6건은 그 시각 미국 주말이라 막힘 → planApplied US=false 이므로 오늘 밤 미국 장에서 '계획 변경'으로 다시 돈다. 엔비디아 주의는 11-16 10:26 새 기사로 11-30 까지 늘었다.
  - 화면 확인(운영 · 헤드리스 Chrome): 규칙 화면 위험 문단이 PP4c 기준(7종목 · 종목마다 위험 몫 14% · 똑같이 나누면 3.8%)으로 나오고, 모의계좌 카드 ⓘ 가 장부 기준 문구로 나온다.
  - 따로 본 것: 11-14(금) 국내·미국 자동 점검이 기록 없이 지나갔다(auto · autoChecked · runs 모두 없음, 로그에 실패 줄 없음). 원인은 찾지 못했다. 오늘 바뀐 코드와는 관계없고, 오늘 국내 재조정은 같은 경로로 정상 실행됐다.
  - 정의 문장(lib/paper-chain.js TOTAL_DEFINITION · docs/record-definition.md)과 모의계좌 카드 ⓘ("미국 매매 정산")를 고쳤다. 공개 파일에 fundingBasis.
- **확인:** 테스트 385(새 1건: 매도 뒤 순매수 · 수량이 다르면 되돌아감), PC 서버 사본 400/402(실패 2건은 전부터). 서버 재시작 뒤 상태: 계획 PP4c 채택 1/2 · 정산 기준 ledger. 화면 QA 는 그때 하지 않았고(문법 검사만) 같은 날 10:30 에 운영 화면으로 확인했다(위 검증).

## (39) 2026-11-16 법률·보안 검토 후속: 로컬 금고 · 사용자 확인 조항 · 보안 수정 (사용자 결정)
- **사용자 결정:**
  - 법률·보안부터 확실히 한다. 개인 로컬 파일도 체계적으로 암호화하고, 사용자에게 묻고 확인하는 조항을 둔다.
  - 검토는 에이전트 8개(법률 4 · 보안 2 · 검증 2, 사용자 승인)로 했다. 상세 보고서는 키 위치·약점이 들어 있어 공개하지 않고 PC 에만 둔다.
  - 그 뒤 "할 수 있는 것은 다" 한다. 다만 유료 서비스 계획이 없으므로 네이버(뉴스 결과 보관 · 증권 시세 경로) 약관 정리는 하지 않는다.
- **금고(lib/vault.js · scripts/vault.mjs):**
  - 구조: Windows DPAPI(사용자 범위)가 KEK 를 보호하고, KEK 가 용도별 데이터 키(비밀 · 토큰 · 장부 · 기록)를 감싼다.
  - 파일 형식: AES-256-GCM(12바이트 nonce · 16바이트 태그 · 헤더=AAD). npm 의존성이 없다(DPAPI 는 PowerShell/.NET).
  - 복구 파일: scrypt(N=2^17, r=8, p=1).
  - 대상: 증권사·API 키, .env 에 직접 적혀 있던 키, KIS·토스 토큰 캐시, 모의·실계좌 장부, 보유 기록 · 현금 · 계획 · 성과, 적립 장부, 동의 기록.
  - 평문 파일도 그대로 읽고, 다음 쓰기 때 또는 migrate 로 암호화한다.
  - 한계: 같은 Windows 사용자로 도는 악성코드는 막지 못한다. OS 업데이트, 키 권한 최소화, 금액 상한이 같은 급의 방어다.
- **토스 토큰:**
  - 문제: 토스는 클라이언트당 유효 토큰이 1개라, 화면용·기록용 리더와 적립 모듈이 서로를 무효화했다.
  - 수정: 공유 공급자 하나(금고 캐시)를 두고, 401 이면 한 번 다시 시도한다.
- **확인 조항(lib/consent.js · consent-ui.js · scripts/consent.mjs):**
  - 브라우저: 처음 쓸 때 서비스 성격 · 투자 위험 · 데이터 한계를 확인한다. 빈 체크박스 3개를 다 체크해야 시작할 수 있다.
  - 브라우저: 저장 위치와 외부 서비스를 고지하고, 설정 > 동의 관리에서 철회할 수 있다.
  - 브라우저: PC 연결 프로그램을 내려받기 전에 키 보관 · 본인 계좌 · 조회 전용 · 나이를 확인한다.
  - PC: 동의 기록은 해시 체인이다. 모의계좌 공개(C6)가 없으면 공개 스냅샷을 게시하지 않는다. 실계좌 조회(C9)가 없으면 실계좌 자동 기록을 켜지 않는다.
  - 개인 적립 모듈(저장소 밖)은 실거래 자동주문(C10) 동의가 없으면 주문하지 않는다.
  - 문구나 범위가 바뀌면 다시 묻는다.
  - 동의를 받아도 서비스의 법적 성격은 바뀌지 않는다(대법원 2018도4413).
- **보안 수정:**
  - 브리지가 요청 본문의 계획·규칙을 받지 않는다(계획 변경 한도 · 28일 잠금 우회 차단).
  - 원격(Vercel 화면) 세션은 조회 · 미리보기 · 멈춤 켜기만 할 수 있다.
  - 오류 응답에서 PC 경로를 지운다.
  - 자식 프로세스에는 최소 env 만 넘긴다.
  - 자동 공개는 저장소 훅을 끄고, 스냅샷 커밋이 1개일 때만 푸시한다.
  - CSP · nosniff · X-Frame-Options 헤더를 단다.
  - Vercel 실계좌 조회 경로를 닫고 안내문을 고쳤다.
  - .gitignore 에 키 · 토큰 · 장부 패턴을 넣었다.
- **법률 검토 요약(공개용):**
  - 무료이고 대가가 없어 지금은 투자자문업 등록 · 유사투자자문업 신고 대상이 아니다(자본시장법 제6조⑦ · 제7조③ · 제101조①).
  - 방문자별 계획·할 일 계산은 개별성 요건이 문항 내용에 달려 있다(대법원 2018도4413). 유료화 · 1:1 답변 · 주문 연동 전에는 다시 검토한다.
  - 남의 계좌 주문은 미등록 투자일임 가능성이 커서 만들지 않는다(금융위 법령해석 210144, 2021-06-01).
- **하지 않은 것:**
  - 네이버 약관 관련 정리: 사용자 결정으로 하지 않는다.
  - 시장 화면 · 공개 시세 경로 정리, 저장소 이력 재작성, 코드 라이선스, 방문자용 PC 연결 프로그램 배포 여부: 사용자·팀 결정 대기.
- **확인:**
  - 테스트 398개 통과(새 13건: 금고 6 · 저장소·토큰 5 · 동의 2).
  - 운영(CSP 적용)에서 화면과 확인 창을 데스크톱·휴대폰으로 확인했다. CSP 위반과 오류가 없다.
  - 적립 모듈 테스트 16/16(새 4건: 코드 상한 · 멈춤 파일 · 증권사 기준 중복 확인 · 401 재시도).
- **전환 결과(11-16 14:15):**
  - PC 데이터 파일 158개(장부 5 · 토큰 3 · 기록 150)를 금고로 암호화했다.
  - PC 서버는 키와 .env 비밀을 금고에서만 읽는다(.env 에는 키 값도 키 파일 경로도 없다). 서버를 두 번 다시 시작했고 멈춘 시간은 각 3초 안팎이다. 다시 시작한 뒤 계획 PP4c · 기록 체인 정상.
  - 개인 적립 모듈의 첫 실거래 주문이 14:10 에 체결됐다(장부 암호화).
  - 예약 작업(서버 지킴이 · 적립)을 OneDrive 밖 실행본으로 옮기는 설정 변경은 자동 권한 검사에서 막혀 하지 않았다(사용자가 직접). 그때까지 두 위치에 같은 코드를 둔다.
  - 동의(C6 · C9 · C10)는 사용자가 직접 해야 공개 게시 · 실계좌 기록 · 실거래 적립이 다시 돈다.
- **간결 화면(같은 날 사용자 요청 · 커밋 c463198):** 모든 화면에서 설명 문장을 가리고 가격·변동·금액·비율·상태만 남겼다(compact.css · compact-ui.js). 설명은 ⓘ 에 남는다. 상태·오류·빈 화면 안내는 가리지 않는다.

## (40) 2026-11-16 수익 검증 · 비교선 환율을 계좌 평가점 환율로(BM2)
- **요청:** 사용자가 "수익을 검증하고 수익을 더 낼 방법을 찾아줘"라고 했다. 조사는 에이전트 4개(조사 3 · 검증 1, 사용자 승인)로 했다. 개인 계좌 부분은 PC 보고서에만 둔다.
- **발견:**
  - 비교선(BM1)은 미국분을 KRW=X 일봉 종가로 환산했다. 계좌는 평가 시각의 환율로 환산해서 둘이 어긋났다.
  - 11-09 기준: 일봉 1,362.70 vs 평가점 1,346.63(1.2%). 미국 비중이 54%라 비교 차이가 약 0.6%p 틀어졌다.
  - 11-16 14:15 평가점 기준: BM1 은 지수 대비 +0.52%p, 같은 환율로 다시 재면(BM2) −0.03%p(계좌 +0.02% · 비교선 +0.05%).
- **수정(`lib/paper-benchmark.js`):**
  - `benchmarkSeries` 가 `fxMarks`(평가점 환율)를 받아 미국분 환산에 쓴다. 첫 평가점에 환율이 있을 때만 쓰고, 한 선 안에서 일봉과 섞지 않는다.
  - 읽기 함수는 시세 봉만 캐시하고, 선은 부를 때마다 지금 평가점으로 만든다.
  - 버전: `BM2-2026-11-16`.
  - 실계좌 기록(`lib/real-record.js`)도 같은 읽기를 써서 함께 바뀐다.
  - 정의 문서: `docs/record-definition.md`.
- **남은 한계:**
  - 기준 평가점은 미국 장중(23:38 KST)에 찍혔는데, SPY 기준값은 그날 종가라 시각이 다르다.
  - 7일 동안의 우연 범위는 ±0.5%p 정도다. 그래서 지금 숫자로는 판단하지 않는다. 추적오차 3.4%/년에서 연 2%p 차이를 t=2 로 가리려면 약 12년, 3%p 면 약 5년이 걸린다.
  - 모의 체결에는 수수료·세금이 없다. 11-09~16 체결액 1.43억(계좌의 144%)에 실제 시장 비용을 매기면 0.17~0.45%p 다(추정 · 국내 매도세 0.15~0.20% · 미국 수수료와 환전 0.12~0.5%).
- **조사 결론(팀 전략 관련분):**
  - 증권사 투자의견·목표주가 신호는 한국에서 2013년 이후 유의한 초과수익이 없다(자본시장연구원 26-05, 2026-02-12, 2000~2024년 695,304건).
  - 목표주가에 담긴 기대수익은 평균 30.73%인데 실현은 4.07%다(26-06, 2026-05-04).
  - 컨센서스 이익수정은 한국에서 비용을 빼고 표본 밖에서 남는 근거를 찾지 못했다.
  - LLM 기업분석의 대표 근거(Kim·Muhn·Nikolaev)는 2025-02-20 저자가 철회했다.
  - 위 넷 다 수익 신호로는 탈락이다. 결정권 없는 보조(카드 사실 추출 · 공시 요약)만 시험 후보로 남는다. 적용하지 않았다.
  - 리포트 원문을 저장하거나 공개 저장소에 올리지 않는다(저작권 · 약관).
- **확인:** `test/paper-benchmark.test.js` 1개 추가(평가점 환율 · 출처 섞지 않음 · 환율만큼 오른 것은 비교선도 오름).

## (41) 2026-11-16 규칙 화면 맨 위 '월급 적립': 쉬운 말 · 계좌 순서 · 같은 지수 비용 (사용자 결정)
- **요청:** 사용자의 말을 요약하면 아래와 같다.
  - 사용자가 자기 규칙을 쉽게 세우고 그대로 사고팔게 하는 것이 중요하다.
  - 적립식은 월급처럼 고정 수입을 차곡차곡 넣기 위한 것이다.
  - 지금은 규칙 말이 너무 어렵고, 일반 사용자는 그게 왜 중요한지도 모른다.
  - ISA·수수료·ETF를 일반인이 다 찾아 고려하기 어렵다. 이 수고를 아껴 주는 것이 나와야 한다.
- **같은 날 직전 답에서 탈락시킨 것:** 배당이나 과거 수익률 순위로 추천하는 방식.
  - 배당을 따로 세는 것 자체가 실수다(Hartzmark·Solomon, JF 2019).
  - 순위가 기간 따라 뒤집힌다. 미국 고배당 ETF(SPYD)와 S&P500(SPY)은 1년 +21.5% 대 +13.4%, 10년 연 8.7% 대 15.1%(2026-11-13 종가).
  - 일반 계좌의 분배금에는 15.4%가 먼저 붙는다.
- **만든 것:** 규칙 화면 맨 위 카드(`lib/dca-guide.js` · `dca-guide-ui.js` · `data/dca-guide.json`). 아래 모의계좌 규칙 카드는 그대로다.
  - **입력 3개:** 매달 넣을 돈 · 연봉(만 원) · 그중 55세까지 안 꺼낼 돈(전부·절반·0원 단추).
  - **넣는 곳:**
    - 노후용 돈은 연금저축(연 600만) → IRP(합산 900만) 순서다. 나머지 돈은 ISA(연 2,000만) → 일반 계좌 순서다.
    - 월급이 없으면 공제가 0원이므로 노후용 돈도 ISA로 보낸다. 화면에는 "월급이 생긴 해부터 1순위"라고 적는다.
    - 연금저축·IRP는 1년 최대 환급액을 보인다(13.2·16.5%, 낸 소득세 한도 안).
    - ISA는 비과세 200만(서민형 400만)과 3년 예시를 보인다. 예시는 연 6% 가정이며 예측이 아니다. 한국 주식 ETF 몫은 0으로 센다.
  - **사는 것:** 같은 지수 안에서 실부담 비용이 가장 낮은 큰 상품을 고른다(순자산 1,000억 이상). 섞는 비율은 사용자가 정한다.
    - S&P500(2026-08-31 집계): ACE 0.0958%. 가장 비싼 큰 상품은 SOL 0.1405%로, 1,000만 원당 1년 4,470원 차이다.
    - 코스피200(2026-03-06 ETF체크): RISE 200 0.0543%. KODEX 200은 0.1857%로, 1,000만 원당 1년 13,140원 차이다.
    - 나스닥100·금은 믿을 만한 최신 비교 자료가 없어 넣지 않았다.
  - **신경 쓰지 않아도 되는 것:**
    - 수수료: 30만 원이면 한 달 45원이다.
    - 사는 날·횟수: 최종 금액 차이가 0.4% 이하다.
    - 하락 기다리기: 오히려 4~13% 덜 모인다.
    - 배당 많은 상품 고르기.
    - 이미 산 상품 바꿔 타기.
  - **내 규칙:** 한 문장으로 만들고 복사할 수 있다. 입력값은 이 브라우저(localStorage)에만 남는다.
- **원칙:**
  - 숫자는 data 파일(출처·기준일 포함)에서만 읽는다.
  - 세법은 2026-11 현행 기준이다. 2026-08-03 세제개편안(생산적금융 ISA 등)은 국회 심의 중이라 반영하지 않았다.
  - 매수 권유가 아니라 규칙 기반 계산이라고 ⓘ에 적었다.
  - 순서는 같은 지수 안의 비용으로만 매긴다. 다른 지수끼리 수익률·배당으로 순위를 매기지 않는다.
- **법률 메모:** 방문자마다 연봉과 노후용 금액을 받아 계좌·상품을 계산한다. 그래서 11-16 검토의 F1(방문자별 계산)과 같은 영역이다. 무료·비영리라 지금 위험은 낮다. 유료화하거나 운용사·증권사와 제휴하면 다시 검토한다.
- **한계:**
  - 환급액은 '최대'다. 낸 소득세보다 많이 받을 수 없는데, 결정세액은 계산하지 않는다.
  - 비용 자료는 집계일 기준이라 바뀔 수 있다. 고칠 때 파일의 checked 날짜를 올린다.
- **확인:**
  - `test/dca-guide.test.js` 10개를 추가했다.
  - 격리 서버(8774)에서 1600·390px 화면을 확인했다. 가로 넘침·콘솔 오류·질문형 문구 모두 없었다.
  - 저장소 테스트 410/410. 실행본 437/439(기존 실패 2개 그대로).

## (42) 2026-11-16 홈 수익률을 토스 계산과 같게: 미국 주식 원금은 산 날 환율

- **보고:** 사용자가 "토스증권에서는 약 10%인데 앱 수익률이 다르다. 달러 기준이라 그런가"라고 했다.
- **원인:** 홈의 '넣은 돈 · 평가 손익 · 수익률'이 미국 주식 원금(토스 종목별 purchaseAmount, 달러)을 **오늘 환율**로 바꿔 더했다. 그래서 미국 주식은 달러 기준이 되고, 산 뒤 환율이 바뀐 만큼(환차손익)이 빠졌다. 산 뒤 원화가 강해진 계좌에서는 토스보다 높게 나왔다. 자산 추이의 원금선 끝점도 같은 방식이었다.
- **확인:** 토스 보유 응답에는 계좌 합계 손익률 `profitLoss.rate`(비용 반영 `rateAfterCost`)가 있다. 문서는 "현재 환율로 원화 환산한 기준"이라고만 적는다. 주문 이력으로 미국 주식 원금을 체결일 환율(KRW=X 종가)로 다시 세면, 수량·달러 원금은 토스와 정확히 맞고 원화 원금은 토스 손익률에서 되돌린 값과 1% 안에서 맞았다. 오늘 환율로만 세면 맞지 않았다. 즉 토스 손익률은 평가액은 오늘 환율, 원금은 산 날 원화다. 조회만 한 검산이고 숫자는 로컬 기록에만 둔다.
- **바꾼 것:**
  - `lib/toss.js`: 계좌 합계 손익률을 `account`(basis `purchase_fx`)로 보존한다. 값이 없거나 이상하면 null.
  - `lib/asset-timeline.js`: `holdingsReturn(snapshot)`를 추가했다. 토스 합계가 있으면 그 손익률을 쓰고 원금 = 평가액 ÷ (1 + 손익률)로 되돌린다. 없으면(모의계좌·예시) 기존 계산을 쓰고 basis `current_fx`로 표시한다. `buildAssetTimeline`은 `costKrwNow`를 받는다.
  - `brief-ui.js`: 홈 KPI가 `holdingsReturn`을 쓴다. 토스 기준이면 '미국 주식은 산 날 환율', 아니면 '· 달러 기준'을 붙인다. ⓘ에 달러 기준 값과 비용 반영 값을 적는다. 종목별 '내 수익'은 토스가 종목 통화로만 주므로 미국 종목에 '(달러)'를 붙였다.
- **한계:** 종목별 원화 기준 수익률은 만들지 않는다. 토스가 종목별 원화 원금을 주지 않고, 앱은 주문 이력을 1년만 읽기 때문이다. 원금은 평가 환율(매매기준율)로 되돌리므로 토스 앱 금액과 몇천 원 다를 수 있다.
- **검증:** `test/krw-return.test.js` 6개를 추가했다(지어낸 숫자). 저장소 테스트 416/416. 실행본 443/445(기존 실패 2개 그대로).

## (43) 2026-11-17 역할 봇 교차 검증 · 숫자 오류 5건 수정(비교선 BM3 등)

- **요청:** 사용자가 "에이전트 여러 개가 서로 검증하게 · 어떤 모델이 나은지 · 디자인 봇, 사용자 봇, 수익 봇으로 나눠서"라고 했다. 에이전트 9개 실행을 승인했다.
- **방법:**
  - 디자인·사용자·수익 봇을 각각 Opus 5.5와 Sonnet 5.5로 돌렸다(찾기 6개).
  - 각 역할의 검증 봇(Opus)이 다른 두 역할의 발견을 직접 재현해 확인 또는 반박했다(검증 3개). 검증 봇에게는 어느 모델의 발견인지 숨겼다.
  - 모든 봇은 읽기 전용이었다. 공개 사이트와 코드만 보았고 실계좌·키·8766에는 접근하지 않았다.
- **결과:**

  | | Opus | Sonnet |
  |---|---|---|
  | 보고 | 22건 | 20건 |
  | 확인 | 22건 | 14건(반박 5, 엇갈림 1) |
  | 서로 다른 문제 | 21개 | 11개 |
  | 이 모델만 찾음 | 11개(심각 2건 포함) | 1개 |
  | 찾기 시간 · 출력 토큰 | 14~18분 · 28.5만 | 2~3분 · 3.1만 |

  - 수익 역할 확인 비율: Opus 6/6, Sonnet 2/5.
  - 1회 실행이고 검증 봇이 Opus라 같은 계열 편향이 있을 수 있다. Sonnet은 같은 지시에도 일찍 멈췄다.
- **고친 것(숫자가 틀린 것만):**
  1. **비교선 BM3 (F15, 심각):** 평가점 날짜는 한국 날짜라 같은 날짜의 미국 종가는 다음 날 아침에야 나온다. BM2까지는 시작값으로 그 종가(그 시각엔 없던 값)를 써서, 시작일 미국장 하루가 비교선에서 빠졌다. 이제 평가 시각(at)에 끝난 장의 종가만 쓴다. 국내는 16:00 KST, 미국은 뉴욕 17:00(서머타임 반영)부터다. `lib/performance-benchmark.js`의 '직전 완료 일봉'과 같은 규칙이다. 공개 모의계좌(11-09 시작, 미국 54%)를 다시 계산하면 지수 대비가 −0.19%p에서 −1.44%p로 바뀐다(계좌 +0.70%, 비교선 +2.15%). 실계좌 기록의 비교도 같은 함수를 쓴다.
  2. **자산 추이 원금 (F18, 심각):** 과거 달의 '넣은 돈'을 '지금 원금 − 그 뒤 순매수'로 되돌리면서 매도를 판 금액으로 되더했다. 그래서 이익을 보고 판 적이 있으면 그 전 달들이 손실로 칠해졌고, 첫 매수 전 달에도 넣은 돈이 생겼다. 이제 월말 원금은 그때 들고 있던 주식의 원가(이동평균)다. 범위 안에서 연 종목은 앞에서부터 쌓고, 범위 앞부터 든 종목은 지금 원가에서 거꾸로 되돌린다. 다 판 뒤 다시 산 종목은 그 매도 전 원금을 비운다. 기간 손익은 체결로 직접 세어 판 이익까지 포함한다.
  3. **매매 성적표 날짜 (F06):** 미국 체결을 한국 날짜로 묶어 지수 기준을 다음 장 종가로 잡았다. `fillsFrom`에 `marketDate`(미국은 뉴욕 날짜)를 더하고 지수 기준에 쓴다.
  4. **월급 적립 규칙 문장 (F25):** IRP에 넣는 돈이 있으면 'IRP에서는 30% 이상을 예금이나 채권형으로 둔다(주식형은 법으로 70%까지)'를 넣는다. 결정 41의 문장이 IRP 몫까지 주식형 100%로 사라고 썼다.
  5. **환율을 못 읽을 때 (F19):** 원화 금액만 비우고 토스가 준 손익률은 그대로 보인다.
- **고치지 않은 것(결정 필요):**
  - 모의계좌 수익률이 화면마다 다르게 나온다(원금 대비 · 첫 평가 대비 · 보유 주식만 · 규칙 화면 '좋음').
  - 월급 적립 규칙과 '지금 규칙'·홈 '오늘 점검'이 서로 다르게 말한다.
  - 홈 첫 화면에 목적과 첫 행동이 없고, 본문에 전문용어가 나온다.
  - 휴대폰 표 잘림, 배지 깨짐, 터치 대상·명암비.
  - 매매 성적표가 액면분할 종목을 큰 손실로 채점한다.
- **검증:**
  - 회귀 테스트를 더했다: 지수만 든 계좌의 차이 0%p, 이익 매도 전 달의 원금, 거꾸로 되돌리기와 다시 산 종목, 미국 평균 환율 몫, 뉴욕 날짜 지수, IRP 문장.
  - 미래 종가를 기대값으로 고정했던 기존 테스트 3곳은 근거를 적고 기대값을 바꿨다.
  - 저장소 테스트 422/422. 실행본 449/451(기존 실패 2개 그대로).
- **공개 기록:** 공개 모의계좌 파일은 서버가 다음에 게시할 때 BM3 값으로 바뀐다. 지금은 C6 동의가 없어 게시가 멈춰 있다.

## (44) 2026-11-17 재점검 · 결정 43 숫자 정정 · 결함 4건 수정(같은 날 체결 순서 · 다 판 종목 문구 · 환율 일봉 날짜 · 비교선 방식 표시)

- **요청:** 사용자가 오늘 고친 것을 다시 점검하고, "오늘 자동매매를 했다면?"을 사용자 계좌로 모의 점검하며, 이렇게 떨어질 때의 대응을 여러 검증 에이전트로 확인하라고 했다. 에이전트 6개를 승인했다(역할 봇 4 + 교차 검증 2, 모두 Opus, 읽기 전용).
- **방법:** 메인 계산과 역할 봇 4개(재점검 · 규칙 · 숫자 · 반대)가 같은 기준 문서로 따로 계산했다. 그 결과에서 주장 19개를 뽑아, 교차 검증 봇 2개가 출처를 모른 채 다시 확인했다. 19개 모두 확인됐고 일부는 보정됐다. 실계좌로 한 모의 점검의 숫자와 결론은 로컬 기록에만 둔다(공개·커밋·노션 금지).
- **정정 (결정 43의 내 숫자 오류):**
  - 결정 43에 "공개 모의계좌 지수 대비 −0.19%p → −1.44%p"라고 적었다. 이것은 시작 환율을 Yahoo 일봉 종가(1,362.70)로 둔 값이었다.
  - 서버는 평가점 환율(BM2, 11-09는 1,346.63)과 평가 시각(BM3)을 쓴다. 같은 시점(11-16 01:19 KST)을 서버 방식으로 다시 세면 **−2.10%p**다(계좌 +0.70%, 비교선 +2.80%).
  - 서버 화면에 보이던 비교선 판 'BM1-2026-11-12'는 기준선 날 고정한 정의의 판이었다. 계산은 이미 BM3였다.
- **고친 것:**
  1. **자산 추이 원금 (결정 43에서 생긴 결함):** 같은 날 산 뒤 판 체결이 있으면, 월말 원금이 입력 순서에 따라 달라졌다. 토스 이력은 최신 체결이 먼저 온다. 시험 사례에서 원금이 600이어야 하는데 1000이 나왔다. 이제 체결 시각 순으로 정렬한다.
  2. **같은 곳의 안내 문구:** 조회 범위 앞부터 들고 있다가 다 판 종목에도 '다 판 뒤 다시 산 종목' 안내가 떴다. 다시 사지 않은 경우에도 그랬다. 문구를 고쳤다. 그 매도 전 달의 원금이 비는 것은 그대로다(체결 이력으로 원가를 알 수 없음).
  3. **시세 일봉 날짜 (전부터 있던 결함):**
     - `lib/market.js`가 일봉 날짜를 UTC 날짜로 붙였다. 환율(KRW=X) 일봉은 런던 자정에 찍히므로, 영국 서머타임(3~10월)에는 하루 앞 날짜가 됐다.
     - 그래서 그 기간 월~목 미국 종가를 다음 날 환율로 환산했다.
     - 이제 거래소 현지 날짜를 쓴다(`candleDay`). 한국·미국 일봉 날짜는 바뀌지 않는다.
     - 연구 스크립트들의 같은 방식(gmtoffset)은 그대로 두었다. 그 산출물을 다시 만들 때 고친다.
  4. **비교선 표시:**
     - 결과에 계산 방식 `method`(지금 BM3-2026-11-17)를 붙인다.
     - 공개 스냅샷의 평가점에 시각(at)과 환율(fx)을 싣는다. 둘 다 계좌 정보가 아니다.
     - 지금까지 공개 파일만으로는 비교선을 다시 계산할 수 없었다. 시각이 없으면 −0.06%p, 시각만 있으면 −1.33%p, 서버 방식이면 −2.10%p가 나온다.
- **고치지 않은 것 (결정 필요):**
  - **비교선 시각 불일치 (BM3의 한계):**
    - 평가점은 장중에 실시간 가격으로 갱신된다. 특히 미국장 시작 직후에 갱신된다.
    - 비교선은 그 시각에 끝난 장의 종가만 쓴다. 그래서 장중 평가점마다 그날 시가 갭만큼 어긋난다. 예를 들어 지수만 든 계좌가 장중 +1%면 비교선 대비 +1%p로 보인다.
    - 공개 모의계좌는 시작 시점(11-09 23:38 KST)에 계좌는 미국 시가 부근에 샀고, 비교선은 11-06 종가에서 시작했다. 약 0.49%p가 계좌에 불리하다.
    - 고치는 방법: 새 평가점에는 그 시각의 지수 가격을 함께 남기고, 과거 평가점은 그 시각 분봉에 맞춘다.
    - 공개(C6) 전에 정할 것.
  - **실계좌 홈 '오늘 점검'의 미국 200일선 규칙:**
    - 개별 종목에도 적용된다. 모의계좌는 결정 28로 개별 종목을 뺀다.
    - 그래서 200일선 아래인 보유 종목은 '전량 줄이기'로 나온다. 이 규칙이 검증된 것은 미국 지수에서다.
    - 개별 종목에 쓸지는 사용자가 정한다.
  - **실계좌 자동매매를 하게 된다면 먼저 고칠 것:** 지금은 앱에 실계좌 주문 경로가 없다.
    - 한도를 넘는 매도는 쪼개지 않고 통째로 막힌다. 그래서 실거래 기본 한도(1회 100만 원)에서는 큰 매도가 끝내 나가지 못한다.
    - 한 번 실행 안의 주문들이 하루 한도에 누적되지 않는다.
    - 하루 손실 정지(3%)가 엔진에 연결돼 있지 않다. 그대로 연결하면 매도까지 막는다.
    - 30일 매매 횟수 상한(8회)이 매도에도 걸린다. 그래서 매일 적립 체결이 쌓이면 규칙 매도가 막힌다.
- **검증:**
  - 회귀 테스트를 더했다: 같은 날 체결 순서, 다 판 종목 문구, 환율 일봉 날짜(서머타임), 비교선 method, 공개 평가점 at·fx.
  - 저장소 테스트 424/424.

## (45) 2026-11-17 하락 매수는 모의계좌로 검증 · 종목 분석을 거쳐서 · 뉴스 경중 · 하루 1번 분석 루틴 (사용자 결정)

- **요청(사용자):** 하락 매수는 모의투자 기능으로 검증. 개별 종목의 하락 매수는 그 회사 분석(왜 떨어졌나 — 예: SK하이닉스는 데이터센터 건설 차질 불확실성 + 엔비디아 불확실성)을 거쳐야 함. 소송은 전례와 실제 영향으로 경중을 판단(단순 개인사는 무관). 리스크·성장·경쟁 등 봇이 종목을 채점하되, 자동은 아니고 **하루 1번**, **API 키 없이**. 종목은 최소 3개월 단위로 재선정. 분산은 ETF·금 같은 자산군 비중으로.
- **사용자 결정:** 금 ETF 핵심 편입은 첫 분기 재선정(2027-02-15 예정)과 묶어 한 번에(계획 변경 30일 2회 한도 · 11-16 PP4c 가 1회) · 하루 봇 상한 3개.
- **왜 '하락 매수'가 지금 규칙 안에 없었나:** 변동성이 커지면 계좌 손실 범위(VaR) 규칙이 목표를 줄이고, 지수 대비 −5%p 뒤지면 위성 매수를 막는다. 즉 공포 때 '줄이는' 쪽이다. 하락 매수는 ① 종목 층(근거가 살아 있나)과 ② 시장 층(공포가 과한가 · 예비 현금)으로 나눠야 서로 싸우지 않는다. 이번에는 ①을 만들었다. ②(VIX 30/40/50 사다리 · 시험 통과)는 다음.
- **만든 것:**
  1. **뉴스 경중(`lib/issue-watch.js`):** 소송·과징금·파업 기사는 '기록(note)' — 보이기만 하고 매수를 막지 않는다. 근거: D램 담합 전례 2005년 벌금 1.85억 달러(분기 영업이익 83조의 0.3%), 2018년 유사 소송 기각, 판결까지 수년. 금액이 큰 소송은 DART 공시(자기자본 5% 이상만 공시)로 들어와 '주의'가 된다. 수사·규제·경영진·회계·리콜·보안은 그대로 '주의'. 기준 전에 걸린 같은 종류의 주의는 다음 감시 때 기록으로 내린다(SK하이닉스 11-16 담합 소송 주의 → 해제).
  2. **엔진(`lib/paper-live.js`):** `setIssue` 가 'note' 를 받음(noAdd false · 주의·긴급이 있으면 덧쓰지 않음). 나눠 사기는 `noAdd` 인 이슈만 막는다. **하락 매수 검증 카드**(`data/dip-cards.json`, `dipCard` 주입) — 허용/보류/금지. 보류·금지면 15% 하락에도 올리지 않고, 허용이면 올린다. 3단계 조건에 '첫 매수가 −30%' 추가(더 떨어질 때). 기한(until)이 지난 카드는 없는 것으로. status·공개 파일에 `dipCards`(판정·이유만).
  3. **카드 형식:** asOf · verdict · cause(market/sector/customer/company/none) · reason · until · facts[{text,url,date}] 2개 이상 · watch[]. `scripts/analyst-card.mjs set|list|remove`. 첫 카드: SK하이닉스 **허용**(원인 = 최대 고객 지배구조 충격·외국인 매도·이익 지속성 의심 · 깨짐 조건 4개 이상 없음 · 2027~28 생산능력 절반 이상 장기계약 · 2027 클라우드 투자 전망 증가 유지 · 데이터센터 지연은 사실이나 가이던스 미반영 · 재확인 12-17), 엔비디아 **보류**(CEO 사임·이사회 복귀 불검토·스파이 연루 조사 · 실적 11-18 · 12-01까지).
  4. **하루 1번 루틴(API 키 없음):** `scripts/analyst-worklist.mjs` 가 '오늘 볼 것'(지수 대비 5일 −10%p · 카드 없는 이슈 · 카드 기한 7일 · 구조 카드 90일 · 분기 재선정 기한)을 `data/analyst-worklist.json` 에 쓴다. Claude Code 스킬 `analyst-daily`(사용자 `~/.claude/skills`)가 그 목록으로 봇 ≤3개(종목 봇 + 교차 검증 1 · Opus · 읽기 전용)를 돌려 카드를 쓰고 저장소에 커밋한다. 봇은 주문·계획 변경·서버 재시작을 하지 않는다. 분기 재선정은 후보안(`data/paper-plan.next.json`)만 만들고 사용자가 승인. `data/analyst-state.json` lastRefresh 2026-11-16.
  5. 화면(`paper-ui.js` 이슈 대응): 기록은 '기록 · 매수 영향 없음', 검증 카드는 '하락 매수 허용/보류/금지'로 표시. 설명은 ⓘ.
- **자산군 분산(확인한 숫자 · 원화 월간 2005-01~2026-11):** 금–S&P500 상관 0.05, 금–코스피 0.00. S&P70/코스피30 = 연 10.0% · 변동성 13.5% · MDD −28.5% → 금 20% 섞으면 10.8% · 11.5% · −22.5%. 주식이 월 −8% 넘게 빠진 5번 중 금이 오른 건 3번(평균 −2.7%) — 금은 폭락 당일 방패가 아니라 긴 기간 분산. 지난 20년은 금이 유난히 좋아 수익은 과장될 수 있음.
- **한계(그대로 적음):** 봇 분석은 오를 종목을 맞히지 못한다(LLM 기업분석 대표 논문 철회 · G2 표본 외 예측력 없음). 가치는 깨짐 조건·뉴스 경중·감사 기록의 일관성이다. 3개월 판정으로는 큰 실패만 보인다(연 2%p 우위를 가르려면 약 12년). 카드는 아직 체인에 봉인하지 않는다(장부 tranche 로그에 카드 날짜만 남김).
- **검증:** 테스트 — 기록은 매수를 막지 않음 · 주의가 있으면 기록이 덧쓰지 않음 · 카드 보류/금지/허용/기한 만료 · −30% 3단계 · 공개 파일 판정 · 소송 기사 note 와 옛 주의 내리기. 저장소 전체 통과(아래 커밋 참조). 운영 루틴 첫 실행: 오늘 볼 것 1건(엔비디아 지수 대비 5일 −10.9%p) — 카드는 이미 있음(보류).
- **다음(사용자 결정 뒤):** 시장 층(VIX 사다리 예비 현금 → 지수 ETF, 모의 예비 현금 15%부터) · 분기 재선정 때 금 편입 · 카드 체인 봉인.

## (46) 2026-11-18 공포 예비 현금(VIX 사다리 → 핵심 지수) · 비교선 BM4(평가 시각의 지수 가격) · 노션 방향 재점검

- **요청(사용자):** "적립 재개 · 니가 할 걸 먼저 시작 · 노션 방향과 맞는지 재점검 · 직관과 어느 정도의 리스크 감수도 필요". 적립 재개(C10)는 실거래 동의라 사용자만 할 수 있다(`node toss-dca.mjs consent`) — 코드·예약 작업은 그대로이고 동의만 없다(11-17 연습 실행: 금·국내 로봇·중국 로봇 1주씩). 결정 45 '다음' 중 시장 층과 BM3 시각 불일치를 만들었다.
- **만든 것:**
  1. **공포 예비 현금(`lib/paper-live.js` checkFear · withFear · fearInfo):** 끝난 세션의 VIX 종가가 30·40·50 을 넘을 때마다 예비 현금(계획 `reservePct`, PP4c 15%)의 1/3 을 핵심 지수(S&P500 ETF · KODEX 200, 계획의 핵심 비율대로)에 얹는다(각 단계 한 번). S&P500 ETF 종가가 새 최고점(읽는 5년 창 안)이면 단계를 지워 비중을 되돌린다(되채움). 계획 버전에 `+F:n` 이 붙어 다음 열린 장에서 평소 재조정 경로(주문 보호 전부)로 산다. 오늘(장중) 봉은 쓰지 않고, VIX 가 5~150 밖이면 시세 오류로 보고 바꾸지 않는다. 개별 종목에는 쓰지 않는다 — 시험한 것은 지수만이고 종목 하락 매수는 결정 45 카드가 정한다.
     - 근거(사전 등록 `PREREG.md` S3 · 결과를 보기 전에 규칙과 판정 기준을 적음): 1990~2026 S&P500 총수익·나스닥100·코스피(1997~)·S&P500 원화(2004~), 80/20 시작, 다음 날 시가 체결 0.1% 비용. 두 방식(되채움 있음/없음) 모두 통과한 유일한 규칙. 예비를 그냥 둔 것보다 10년 창 75~100% 에서 앞섰고 연 +0.4~0.9%p, 처음부터 전부 투자한 것과는 거의 같음. 산 뒤 더 떨어진 최악 −44%(코스피 1997). VIX 30 이상은 1990년 이후 27번. 2026-11-17 VIX 22.9 → 0단계.
     - 모의 현금 최소 규칙(기본 10%)과 부딛히지 않는다: 계획 투자 67.5% + 15 = 82.5% 라 현금 17.5% 가 남는다.
  2. **비교선 BM4(`lib/paper-benchmark.js` · `BENCHMARK_VERSION` BM4-2026-11-18):** 평가점에 평가 시각의 지수 가격 `marks[].idx = {KR:{date,close}, US:{date,close}}`(KODEX 200 · SPY 마지막 봉, `idxNow`)을 적고, 비교선은 그 날짜·다리에 이 값을 쓴다. BM3 는 '끝난 장의 종가'라 23:50 KST 평가점(미국 장 진행 중)에서 계좌는 지금 가격, 비교선은 전날 종가였다(미국 54% 에서 하루 움직임만큼 어긋남 · 결정 44 미결 3번). 지수 가격이 없는 옛 평가점은 BM3 그대로 — 같은 뜻('그때 알 수 있던 값')이라 섞어도 된다. 공개 파일 `marks.idx` 에 남긴다(공개 시세이지 계좌 정보가 아님).
  3. **화면·공개:** 모의투자 '운용 기록·점검' 안에 `공포 예비 현금 n/3단계 · VIX` 한 줄(설명은 ⓘ). 공개 스냅샷 `fear`(단계·VIX·최고점·최근 기록 5건).
- **검증:** `test/fear-reserve.test.js` — VIX 30 → 1단계(핵심 10% → 15%, 위성 그대로, 버전 +F:1) · 같은 단계 한 번 · 40 → 2단계 · 장중 봉 제외 · 새 최고점에서 해제·되돌림·공개 파일 · 평가점 idx. `paper-benchmark.test.js` — BM4 평가점 값 우선 · reader method BM4. 저장소 432/432. 기존 시험 스텁 3곳(tranche-sleeve · day5-fixes · paper-limits)은 모든 종목에 같은 가격을 돌려줘 그 값이 VIX 로 들어가 3단계가 켜졌다 → `^VIX` 20 으로 고정.
- **노션 방향 재점검(Team#15 페이지 · 2026-11-18 읽음):** 컨셉 "투자 원칙을 과거 데이터로 검증하고 최신 시장 정보에 일관되게 적용해 판단을 돕는 AI 퀀트 에이전트".
  - 맞는 것: 규칙 엔진·사전 등록 시험·모의 운용·근거 카드. 스크럼 "AI 설명과 규칙 충돌 시 승인 규칙 보존(CAP-07)" — 검증 카드(결정 45)는 규칙이 허락한 추가 매수를 **막기만** 하고 더 사게 하지 않는다 → 일치. "모든 신호에 데이터 기준 시각 표시 · 지연·결측이면 보류(CAP-06)" — BM4 idx 날짜 · fail-closed 유지.
  - 팀 결정이 아직 없는 것: "실거래 포함 여부와 AI 권한 경계 합의(D-05 · D-06, In progress)". 봇 판정이 모의 집행을 막는 것도 AI 권한의 한 형태다 → 팀 기록 필요. 실거래는 스크럼대로 "별도 승인 전 범위 밖" — 사용자의 토스 적립은 팀 프로젝트 밖의 개인 계획(결정 41 이후 그대로).
  - 사용자 메모 "직관과 리스크 감수": 노션 틀 안의 통로는 이미 있는 **가설**(종목 1~10% · 합 30% · 기간 3/6/12개월 · 깨짐 조건 · 결과 기록, CAP-08). 규칙을 넘는 임의 매수가 아니라 한도가 있는 가설 슬롯으로 들어간다. 모의계좌에 열린 가설 0건.
- **한계(그대로 적음):** 최고점 기준은 읽는 5년 창 안(더 긴 하락장은 창 최고점) · 지수 가격은 공개 시세(국내 15~20분 지연) · 실제 발동 전까지 운영 검증 없음 · 규칙 우위 +0.4~0.9%p 는 20년 표본 4곳에서 나온 값이고 미래 보장이 아님.
- **다음:** 노션 개발 기록(사용자 승인 뒤) · 분기 재선정(2027-02-15) 때 금 편입 · 카드 체인 봉인. 사용자: Claude GitHub App 설치(매일 루틴 커밋) · C10 결정 · 실계좌 비중 규칙 A/B 선택.

## (46-재검증) 2026-11-18 오후 결정 46 재검증 — 고친 것 6 · 사용자 결정 4(상한·200일선·재조정 범위·현금 최소)

- **요청(사용자):** "그 규칙을 제일 잘 세워야 하고, 종목을 잘 세워야 해. 다시 오늘 것 검증해줘." 방법: 내 재점검 + 블라인드 검증 봇 1개(Opus · 읽기 전용 · 커밋 bd09080 사본 · 프로브 실행 · 약 21만 토큰). 봇 보고 11건 중 내 발견과 겹친 것 3건(상한 · 끝난 세션 시각 · 지연 보호).
- **고친 것(이 커밋):**
  1. **끝난 세션 판정:** 뉴욕 날짜만 보던 것 → 미국 장이 끝난 뒤(16:00 ET~자정 ET)면 오늘 봉도 끝난 세션. 13:57 KST 에 11-17 VIX 종가 25.46 이 있는데 11-16 으로 표시됨을 실측. 국내 다리 매수가 D+1 14:00 이후로 늦던 것(봇 8)도 함께 해소.
  2. **지연 보호:** VIX 와 S&P500 ETF 의 마지막 세션 날짜가 다르면(어느 쪽이든 결측·지연) 표시만 갱신하고 단계는 바꾸지 않는다(화면 "지연"). 낡은 VIX 로 해제→재점화가 반복되는 경우(봇 5)도 막힌다.
  3. **새 최고점 날은 단계를 켜지 않는다**(에피소드 밖 · 사전 등록 정의와 일치). 최고점 판정은 '넘었을 때'(같은 값은 새 최고점이 아님).
  4. **계획 `reservePct` 0 = 예비 없음.** 전에는 0 이 15 로 바뀌었다(봇 6).
  5. **자동 루프 시작에서 공포 단계 갱신.** 전에는 status() 에서만 갱신해, 공개 동의(C6)가 없으면 화면을 열기 전까지 단계도 되채움도 바뀌지 않았다(봇 4).
  6. **BM4 보완 — 장중 평가점은 그날 시가:** 지수 가격(idx)이 없는 평가점이 그 다리의 장중(시각이 기록된 것만)에 찍혔으면 전날 종가 대신 그날 봉의 시가. 공개 모의계좌 시작 평가점은 11-09 23:38 KST(09:38 ET · 미국 장 8분 뒤)인데 BM3 는 11-06 종가 735.29 를 시작값으로 썼다 → 11-09 개장 갭(+0.9%) × 미국 54% ≈ 0.5%p 가 비교선에 유리하게 들어가 있었다(봇 7). 그동안의 헤드라인 차이(−0.3~−0.6%p)는 그만큼 계좌에 불리하게 적혀 있었다. 시각이 없는 평가점은 그 날짜 끝으로 보는 약속 그대로.
  - 시험: `fear-reserve.test.js` 9건(끝난 세션 시각 · 지연 두 방향 · 최고점 날 · reservePct 0 · 자동 실행 +F) · `paper-benchmark.test.js` 'BM4 보완' 1건(BM3 시험은 시가 없는 봉으로 고정). 저장소 438/438 · 실행본 465/467(기존 2).
- **고치지 않은 것 — 규칙 설계라 사용자 결정(실제 발동 전에 정해야 함):**
  - **A(상) 한 종목 상한 25% 가 S&P500 ETF 목표 29.2% 를 자른다.** 규칙(`maxSingle`)과 주문 보호(`maxWeightPct`) 두 층. 계산 단계에서 잘려 주문이 나가지 않고, 공포 단계의 미국 지수 몫(단계당 +3.6%p)은 통째로 사지 않는다. 봇 프로브(1억 · SPY 25% · VIX 33): SPY 주문 없음, KODEX 200 +140만 원만 — 단계당 5%p 중 1.4%p. 막힌 문구가 재시도 목록에 없어 '집행'으로 적힌다. 선택: (a) 계획 role core 지수 ETF 는 상한 예외 — 권고(상한의 목적은 개별 종목 집중, 사전 등록 시험은 지수를 산다고 가정, 사용자 규칙 B 안에도 S&P500 ETF 40) (b) 상한 유지 · SPY 목표 25 · 공포 몫은 KODEX 200 으로 (c) 그대로(미국 쪽 공포 규칙은 무력).
  - **B(상) 200일선 규칙(`trendUS`)이 핵심 지수에도 적용된다.** VIX≥30 구간에는 SPY 가 200일선 아래가 보통 → 목표 0 → 공포 단계의 재조정이 SPY 를 전량 판다(봇 프로브 · maxSingle 40 가정: SPY SELL 2,485만 ok). 사전 등록 규칙 S3 와 정반대. 두 규칙의 조합은 시험한 적이 없다. 선택: (a) 공포 단계가 켜진 동안 핵심 지수에 추세 규칙을 쓰지 않음 (b) 핵심 지수에서 200일선 규칙 제거(S3 그대로) (c) 추세 우선(공포 규칙 무력). 어느 쪽이든 조합 백테스트 전엔 '미검증'.
  - **C(중) +F 변경이 전체 재조정으로 돈다**(letWinnersRun 끔 · 열린 주문 취소 · 위성도 목표로 깎음, 예 엔비디아 4.5→3.56). 사전 등록 규칙은 지수만 산다. 선택: 단계 올림은 매수만, 되채움(해제)만 재조정.
  - **D(하) 손실 5% 프리셋(minCash 20)과 3단계가 겹치면 82.5 > 80** → 목표 전부 ×0.97. 예비 15 계획은 minCash 10 전제.
- **종목 쪽(사용자 "종목을 잘 세워야"):** 오늘 작업은 종목 선정을 바꾸지 않았다. 카드 2장(엔비디아 보류 12-01 · SK하이닉스 허용 12-17) 그대로, 모의계좌 열린 가설 0건, 분기 재선정 2027-02-15. 뉴스 분류가 "현대차 사장 '엔비디아 韓에 매우 중요…'" 기사를 엔비디아 경영진 주의(추가 매수 금지)로 붙였다 — 보유 없음·영향 0 이지만 이름 언급 매칭의 잡음(기록만).
- **봇이 문제 없다고 확인한 것:** 단계 한 번씩 · 20→45 는 두 단계 한 번에 · 범위 밖 VIX·읽기 실패 fail-closed · 계획 변경 한도(결정 36) 소모 안 함 · 매매 횟수는 묶음 1회 · withFear 는 core 만 · 공개 스냅샷에 계좌 정보 없음 · 옛 장부에서 안 던짐.
- **한계(그대로):** 최고점은 5년 창 비조정 종가(봇 9) · 지수 시가도 근사(09:38 ≠ 09:30) · 하루 손실 한도(VaR)가 공포 매수를 줄이는지는 미확인 · 규칙 우위 +0.4~0.9%p 는 20년 표본 4곳 값.

## (47) 2026-11-18 핵심 지수 ETF 는 한 종목 상한의 예외 · 핵심 지수에 200일선 규칙을 쓰지 않음(사전 등록 시험 PREREG-B) · 실계좌 홈도 개별 종목엔 200일선 미적용(결정 28 정렬)

- **요청(사용자):** "일단 시작해봐. 뭐든 시작해." (46-재검증의 사용자 결정 A·B 와 11-17 드릴 미결 1번에 대해). 외부 리뷰(사용자가 붙인 글)도 같은 지점 두 곳을 짚었다: 개별 종목 200일선 전량 매도의 함정, 전략과 가드레일의 미분리.
- **① 한 종목 상한 예외(결정 A 의 권고안 채택):** 계획 문서에서 `role: core` · `sector: index` 인 종목(S&P500 ETF · KODEX 200)은 한 종목 상한(규칙 `maxSingle` · 주문 보호 `maxWeightPct`)의 예외다. 상한의 목적은 개별 종목 집중이고 지수 ETF 는 그 안에서 이미 분산돼 있다. 사전 등록 시험(S3)은 지수를 산다고 가정했고, 사용자 규칙 B 안에도 S&P500 ETF 40 이 있다.
  - 구현: `paper-live.js` decide 가 계획 항목에 `capExempt: true` 를 붙이고 주문 보호 intent 에도 넘긴다. `core-rules.js` `capPctOf(rules, planned)`: 오늘 점검(계획 비중 자르기·상한 위반·급함 판정)·주문 전 점검·새 돈 배분이 이 상한을 쓴다. `order-guard.js` 는 `intent.capExempt` 면 비중 검사만 건너뛴다(다른 검사 그대로). 규칙 페이지 ⓘ 에 예외를 적었다.
  - 효과: PP4c S&P500 ETF 29.2% 목표가 25 로 잘리지 않고, 공포 단계의 미국 지수 몫(단계당 +3.6%p)이 실제로 산다. 개별 종목·가설 종목은 그대로 25%.
- **② 핵심 지수의 200일선 규칙 제거(결정 B 를 시험으로 정함):** 결정 전에 `PREREG-B.md` 에 변형·시장·측정·판정 기준을 적고 돌렸다(`scripts/research/trend-fear.mjs` · 결과 `docs/research/trend-fear.json`). 80/20 시작 · 다음 날 시가 · 0.1% 비용 · 상태가 바뀔 때만 매매.
  - 변형: V0 채택 규칙(공포 사다리만, 되채움) · V1 200일선만(80↔0) = "추세 우선" 선택지와 같음 · V3 200일선 + 공포 우선(단계 켜진 동안 추세 무시) · V5 반추세(80↔40, 외부 리뷰의 '단계형 비중') · V6 반추세 + 공포 우선. 판정: 모든 시장에서 10년 창 ≥70% 이김 · 두 반기 이김 · 전체 CAGR 2%p 이상 안 뒤짐.
  - 결과(V0 대비): 10년 창 이김 비율 — V1 26/33/25/0%, V3 44/41/50/46%, V5 30/37/20/0%, V6 44/44/50/54% (S&P500 총수익 1990~ / 나스닥100 / 코스피 1997~ / S&P500 원화 2004~). 전체 CAGR 차 — V1 −1.8/−1.6/+0.6/−5.2%p, V3 −0.2/+0.2/+1.5/−0.1, V5 −0.9/−0.5/+0.3/−2.8, V6 +0.1/+0.5/+1.1/+0.1. 낙폭 — 추세만(V1)은 크게 줄인다(S&P −45→−18, 나스닥 −74→−46) 대신 수익이 뒤지고, 공포 우선(V3·V6)은 V0 와 비슷하되 낙폭이 더 크다(−54·−77). **네 변형 모두 미달 → 사전 등록대로 V0 유지, 핵심 지수에서 200일선 제거.**
  - 구현: `paper-live.js` risk 매핑에서 role core 도 `trendApplies: false`. 계획 밖 종목(가설 등)에는 규칙 그대로. 결정 28 시험(핵심은 안 산다)을 새 규칙으로 바꿨다.
  - 뜻: 모의계좌에서 '미국 200일선 규칙'은 계획 밖 종목에만 남는다. 낙폭 방어는 규칙 비중·현금 최소·하루 손실 한도·공포 예비 현금이 맡는다. 외부 리뷰의 "단계형 비중(50%)" 제안은 V5·V6 으로 시험했고 통과하지 못했다.
- **③ 실계좌·예시 홈(core-ui): 200일선은 지수 ETF 에만.** `assetRisk(…, { trendUS: isIndexEtf(p) })` — 분류는 `lib/sectors.js` classify 가 'index' 인 종목. 11-17 드릴 미결 1번(실계좌 개별 종목에 "0%로 줄이기" 권고)을 닫는다. 규칙 라벨 '미국 종목 200일선 규칙' → '미국 지수 200일선 규칙'. 실계좌의 한 종목 상한은 그대로 25%(계획 문서가 없어 예외 표시가 없다).
- **검증:** `test/decision-47.test.js` 4건(capPctOf · 오늘 점검 · 주문 전 점검·새 돈 배분 · 주문 보호) · `fear-reserve.test.js` "핵심 24 + 공포 5 = 29% 그대로 산다" · `tranche-sleeve.test.js` 결정 28 시험을 새 규칙으로. 저장소 443/443 · 실행본 470/472(기존 2).
- **한계·남은 것:** 리허설 엔진(`paper-trading.js` · `report-card.js` '규칙대로')은 아직 미국 개별 종목에 200일선을 적용한다 — 홈 규칙과 어긋나며 다음 정리 대상. 결정 C(+F 전체 재조정)·D(minCash 20)는 그대로 미결. 시험은 지수 수준이고 모의계좌 구현(목표 비중 재조정)과는 체결 방식이 다르다. 추세 규칙이 낙폭을 크게 줄이는 것은 사실이라, 낙폭을 더 중시하면 V1 을 택할 수 있다 — 그 경우 연 −1.6~−1.8%p(미국)와 원화 환산 −5.2%p 를 받아들이는 결정이다.

## (47-C) 2026-11-18 공포 단계만 올라간 변경은 지수 매수만(결정 C · 사용자 선택 b)

- **요청(사용자):** "3. b로 하든가." 결정 D 는 "현금은 10%정도까지 해도 상관없어" → 현금 최소 10 유지, 20 프리셋과의 겹침은 해당 없음(기록만).
- **구현:** `paper-live.js` autoRun 이 계획 버전의 차이가 `+F:n` 증가만일 때(`fearOnly`) `run({ rebalance: true, keepWinners: true })` 로 돈다 — 열린 주문은 거두고 묶음으로 세되 `letWinnersRun` 을 끄지 않아 오른 종목을 목표로 깎지 않는다(핵심 지수 매수가 주된 결과). 되채움(n 감소)·계획 변경·첫 운용은 평소 재조정. 사유 문구 `공포 n단계(지수 매수만)`, 자동 실행 결과에 `rebalance`·`keepWinners` 를 적는다.
- **검증:** `fear-reserve.test.js` "결정 47-C" — 첫 운용은 평소 재조정, 다음 날 1단계는 지수 매수만. 저장소 444/444 · 실행본 471/473(기존 2).

## (48) 2026-11-18 가격 사다리 규칙(떨어질수록 사고 올라갈수록 팔기 · −10% 에서 20% 손절 뒤 추가 매수) 사전 등록 시험 — 전부 미달 → 실계좌 매도 모듈은 목표 계획 재조정·공포 되채움만

- **요청(사용자):** 토스 모듈에 매도를 더해 달라. 매도 범위 전부, 전환 매도 뒤 핵심은 달러 ETF 로(환전 없음). 금액 상한보다 "떨어질수록 추가 구매·올라갈수록 추가 판매" 규칙으로, 예: 10만 원짜리가 9만 원이면 20% 팔고 더 떨어지면 추가 매수(심한 하락이면 변동성 이슈로 보류). "확인해봐."
- **시험(`docs/research/PREREG-C.md` 를 먼저 적음 · `scripts/research/grid.mjs` · 결과 `docs/research/grid.json`):** 자산 1 + 현금, 60/40 시작, 다음 날 시가, 0.1% 비용, 현금 2%. H 보유 · RB 밴드 재조정(45~75% 벗어나면 60 으로) · GRID 기준가 −10% 마다 포지션의 20% 매수, +10% 마다 20% 매도 · GRIDV 변동성 급등(20일 변동성 > 1년 중앙값 2배)이면 매수 보류 · TRIM 첫 −10% 에서 20% 매도 뒤 GRID. 지수 3(S&P500 총수익 1990~ · 나스닥100 · 코스피 1997~) · 개별 종목 20(미국 16 · 한국 4 · 15년 이상 · 생존 편향 있음) · 참고 PLTR·TEM.
- **결과:** 지수 — GRID/TRIM 은 CAGR 연 −3.2~−9.9%p(S&P 9.32→2.79 · 나스닥 12.32→2.89 · 코스피 5.73→2.53), 10년 창에서 보유를 이김 11~30%. 낙폭은 크게 줄지만(S&P −48→−11) 이유는 오를 때마다 팔아 결국 현금이 되기 때문(현금 수익률 수준). RB 는 −1.2/−1.9/+0.4%p, 이김 30~41%, 매매 6~9회. 개별 종목 — GRID/TRIM 은 20종목 중 0 에서 보유보다 나음(중앙 −9.4%p/년), 손실 종목(F·INTC·GE)에서도 떨어질수록 산 것이 더 잃었다. RB 는 3/20. 짧은 참고(TEM 2024~)에서만 GRID 가 보유를 앞섬 — 횡보 구간의 모습.
- **판정(사전 등록 기준):** 네 변형 모두 지수·종목 두 집단에서 미달. "올라갈수록 팔기"는 오르는 자산을 현금으로 바꾸는 규칙이라 수십 년 단위에서 뒤진다. "떨어질수록 사기"는 지수에서 공포(VIX) 기준으로만 통과했고(결정 46), 개별 종목에서는 가격 기준으로는 실패하고 회사 분석 카드가 문이다(결정 45). −10% 20% 손절(TRIM)이 가장 나빴다.
- **실계좌 매도 모듈 설계(이 결과 반영 · 사용자 승인 뒤 구현):** 매도 이유 셋 — ① 전환 매도(목표 B' 초과분만, 목표까지만) ② 밴드 재조정 매도(목표의 1.25배 또는 +3%p 초과 시 목표까지, 월 1회 점검) ③ 공포 되채움. 가격 사다리·손절 없음. 핵심은 달러 ETF(S&P500 · 금)로 사서 환전 없이. 보호 장치(매도 가능 수량 조회 · 지정가 · 미리보기 → 알림 → 동의 C11 · STOP 파일 · 중복 확인 · 첫 실행 dry-run)는 전략이 아니라 가드레일. 하루 금액 상한은 넣지 않는다(사용자) — 종목당 "목표까지만"이 상한 역할.

## (49) 2026-11-18 임계값을 변동성·비용·세금에서 유도(사전 등록 PREREG-D · PREREG-E) — "계속 오르면 팔지 않는다"가 식에서 나옴 · 매도 규칙 확정안

- **요청(사용자):** "떨어졌을 때 산 몫은 원래 값보다 올랐을 때 팔아야 한다 · 적립도 같이 넣어라 · 계속 오른다면 팔 이유가 없다 · 10% 는 naive 하니 수학적으로 계산해 그 과정이 진행되게 하라."
- **시험 D(`docs/research/PREREG-D.md` · `scripts/research/anchor.mjs` · `anchor.json`):** 기준 A = 평균 매입가, 매달 적립(시작 자산 1%) 모든 규칙 동일. D1 A −10/−20/−30% 에 예비 1/3 매수 · A 위에서 그 몫만 매도 — 지수 연 +0.0%p(10년 창 이김 52~90%, 최악 0~−1.4%), 종목 중앙 +0.0(5/20) → 해롭지 않지만 거의 안 켜짐(오르는 자산은 평균가 −10% 아래로 잘 안 옴 · 예비가 적립으로 커진 계좌에 비해 작아짐). D3 적립 조절(평균가 아래 2배 · +20% 위 보류) 연 −0.7~−1.2%p, 0/20 — 보류가 원인. D4 보유분을 평균가 +30% 에서 10% 매도 연 −2.3~−6.8%p, 0/20 — 가장 나쁨. F(VIX 사다리) 종목 15/16 에서 나음(81% 종목이 창 70% 이상) · S&P 89% · 나스닥 67%(간발 미달).
- **시험 E(`docs/research/PREREG-E.md` · `scripts/research/mathrule.mjs` · `mathrule.json`):** 식 — u = σ₆₀·√(63/252)(3개월 1σ), 매수 단계 k 는 A·exp(−k·z·u); 무거래 밴드 δ = (3κ·w*²(1−w*)²/2γ)^(1/3)(Davis–Norman/Rogers 계열 1차 근사), γ = (μ−r)/(w*·σ²₂₅₀), μ−r 4% 고정, κ_buy 0.1%, κ_sell 0.1% + 0.22·g(g = 미실현 이익률). 결과 — NT(세금 반영 밴드): 30~40년에 매도 1~5회, 매도 시 이익률 중앙 80~99% → "오르는 동안은 팔지 않는다"가 식에서 나왔다. 그래도 보유 대비 연 −0.5~−0.9%p(고정 밴드 RB −0.6~−0.9 보다 조금 나음), 낙폭은 2~7%p 작음. V1(z=1) 지수 +0.0~+0.04%p(코스피 창 75%), 종목 ±0, 매도 0 — 해롭지 않음·거의 휴면. V2(z=1.645) 더 적게 켜짐. F 그대로 통과(종목).
- **판정(사전 등록 기준):** 어떤 재조정·사다리도 "보유 + 즉시 적립"을 70% 창 기준으로 이기지 못했다. 매도는 수익 규칙이 될 수 없다(세 번째 시험에서도 같음). 매도의 정당한 이유는 위험 예산(집중)과 떨어졌을 때 산 몫의 회수뿐이고, 그 비용(연 0.5~0.9%p)은 변동성을 낮추는 값이다. 매수 쪽에서 통과한 것은 VIX 사다리(지수)만.
- **매도 규칙 확정안(개인 모듈 · 사용자 승인 뒤 구현 · 실계좌 숫자는 기록하지 않음):**
  1. 적립은 즉시, 목표 비중대로, 모자란 종목부터. 비싸 보여도 보류 없음(D3).
  2. 보유분은 "올랐다"는 이유로 팔지 않는다(D4 · NT 의 세금 밴드가 같은 결론).
  3. 매도는 ① 전환(목표 초과분, 목표까지) ② 위험 예산 위반 — 종목 비중 w > w* + δ_sell(세금 반영 밴드, 월 1회 점검) ③ 공포 사다리 되채움(새 최고점) ④ 떨어졌을 때 산 몫은 그 몫의 매입가 위에서만.
  4. 매수 단계는 10% 가 아니라 자산별 u(3개월 1σ). 예(공개 지수 · 2026-11-18): S&P500 ETF u 6.4% → 단계 −6.2/−12/−17.4%, 금현물 ETF u 11.2% → −10.6/−20/−28.5%. 변동성 50~90% 종목은 −20~−35% 가 1단계. 지수는 VIX 사다리가 1차, 개별 종목은 분석 카드 허락 + 이 단계.
  5. 매도 밴드 δ_sell 은 매일 다시 계산(지수 ETF 목표 42% 기준 약 2.6pp, 소형 위성 1pp 안팎; 이익률이 클수록 넓어짐).
- **한계:** μ−r 4%·z=1 은 고정 가정(조정 안 함) · 1차 근사 밴드 · 단일 자산 시험이라 포트폴리오 분산 효과는 안 들어감 · 예비를 적립으로 채우는 변형(결정 48 의 2번)은 아직 시험 안 함 · 생존 편향(대형 생존 종목).

## (50) 2026-11-18 밤 매도 모듈 설계 조사(봇 3개) — 세금 구조 · 토스 API 능력 · 분기 배분 모델(사전 등록 PREREG-F)

- **요청(사용자):** 세금은 250만 원 공제 초과분만이라 크게 신경 쓰지 말되 관리는 해야 함 · "그래서 ETF 비중을 늘려야 하나" · 토스로 이 기준의 매수·매도가 되는지와 해외 ETF 매수 방식 재검증 · 위성은 3~4개월마다 재조정, ETF 는 그 안에서 배분 · 시계열·상관 모델로 수식을 다시 세울 것 · 에이전트 여러 개 허용.
- **세금(2026 귀속, 일반 과세계좌 · 규칙 엔진용 정보, 자문 아님):** 국내 상장 해외지수·금 ETF 매매차익 = 배당소득 15.4%(공제·통산 없음, 금융소득 2천만 원 합산). 미국 상장 ETF·주식 = 양도소득 22%, 연 250만 원 공제, 해외주식 손익통산, 환차익 포함(결제일 환율). 손익분기 G ≈ 833만 원/년(0.22(G−250만) = 0.154G). 뜻: 분기 재조정 매도만 하는 계좌는 연 실현이익이 공제 안에 들 가능성이 커 **핵심 S&P·금은 미국 상장(SPY·IAU)이 세금상 유리**하고, 달러 매도대금을 환전 없이 쓸 수 있다. 적립(원화)은 국내 상장 ETF 그대로(환전 API 없음). "ETF 비중" 은 세금 문제가 아니라 위험 배분 문제. 기록 항목: lot 원가(결제일 환율) · 연간 순실현손익 · 남은 공제 · 배당 원천징수 · 금융소득 누계. 미확인: 금현물 ETF 과세유형 원문, 2026 특례 시행 여부(로컬 기록 참조).
- **토스 Open API(공식 문서 2026-11-18):** 미국 매도·달러 ETF 매수·국내 ETF 매매 모두 `POST /api/v1/orders` 로 가능. 조건 — 환전 API 없음(FAQ 39) · 샌드박스·사전검증 없음(dry-run 은 코드 안) · 금액·소수점 주문은 정규장 시작~종료 1시간 전 · 미국 정정은 가격만 · 국내는 SOR 설정·반대 방향 미체결 409 · ORDER 초당 10 · client 당 토큰 1개(적립 모듈과 공유) · 허용 IP · 매도 대금의 USD 매수 가능 시점 미확인(체결 확인 뒤 buying-power 재조회). 세션 시각은 `market-calendar/US` 의 endTime −1h 로 계산(서머타임 자동).
- **배분 모델(`PREREG-F` 먼저 작성 · 걷기-전진 2001-03~2026-11 102분기 · 20종목 무작위 6종목 바구니 100개 + 전체):** 비교 EW · 역변동성 · ERC(표본 S / EWMA 0.97·0.94 / Ledoit–Wolf 상수상관 축소 / 군집 상한). 판정(사전 규칙): **위성 = ERC-LW**(대 EW: 변동성 23.2→21.1%, MDD −42.1→−38.6%, 위험기여 분산 0.414→0.266 · 대 역변동성 3/3 이지만 폭 작음), **핵심(S&P:금) = 역변동성**(고정 73/27 대비 3/3). EWMA 는 회전율 1.5배 초과로 탈락. 변동성 예측 오차는 추정량과 무관하게 RMSE 0.42~0.44(위기 분기 2~4배). 수익은 서술만(EW 보다 1.3%p/년 낮음 · 생존 편향 표본). 봇의 사후 변경 2건(거래량 0 봉 제거 · 2008-08 환율 공백 FRED 보정)은 기록돼 있고 판정은 세 실행 모두 같음. 역변동성 핵심은 최근 1년 원화 변동성(금 31% vs S&P 18%)으로 금 비중이 고정값보다 커진다 — 계획 변경 한도(결정 36)와 사용자 결정 대상.
- **매도 모듈 규칙(결정 48·49 + 이 조사 · 사용자 승인 뒤 구현):** 적립 즉시(국내 ETF) · 보유분 "올랐다"로 안 팜 · 매도는 전환·위험 예산 위반(세금 밴드)·공포 되채움·하락 매수분 회수 · 분기(3·6·9·12월 말) 위성 ERC-LW 재조정 + 핵심 역변동성 · 매수 단계 σ 단위 · 전환 매도 대금은 미국 상장 핵심 ETF 로 · 결제 확인 뒤 매수 · 토큰 공유 · dry-run 은 조회 API 로 모의 계산 · 세금 lot 기록.
- **한계:** 세 조사 모두 2차 자료·문서 요약 포함(원문 미확인 항목은 로컬 기록) · 배분 모델은 위험 배분이며 수익 예측 아님 · 한·미 종가 시각 차이로 국내 종목 상관이 낮게 잡힘(주간 수익률 재확인 미검증).

## (51) 2026-11-22 배분은 전체 공분산 위험예산(RB-FULL · 사전 등록 PREREG-G) · 실계좌 재조정(매도) 모듈 RB1 제작 · 동의 조항 C11

- **요청(사용자):** "더 수학적으로 옳은 걸 해봐 … 전부 다 확인하고 실행해줘." 슬리브별(핵심 역변동성 · 위성 ERC) 대신 자산 전체의 상호 상관을 한 번에 반영하는 모델.
- **시험 G(`PREREG-G.md` 먼저 작성 · 걷기-전진 2005-12~2026-11 83분기 · 무작위 6종목 바구니 100개 + S&P500 ETF + 금 ETF, 원화):** SLEEVE(PREREG-F 결과) · **RB-FULL**(8×8 Ledoit–Wolf 축소 공분산 위에서 위험기여 RC_i = w_i(Σw)_i/wᵀΣw = 예산 b_i — S&P 40 · 금 20 · 위성 40/n — 순환 좌표하강 y_i = [−a_i+√(a_i²+4Σ_ii b_i)]/(2Σ_ii), w = 0.9·y/Σy, 위성 상한 10% 반복 재분배) · RB-VT(여기에 변동성 목표 13.5% 스케일) · MV-LW(최소분산) · EW-ALL. 판정 지표: 위험예산 추적오차(실현 RC − 예산 RMSE) 최소, 회전율 ≤ 1.5×SLEEVE, 변동성 예측 오차 ≤ SLEEVE+0.02.
  - 결과: 추적오차 SLEEVE 0.051 → **RB-FULL 0.036**(부트스트랩 90% 구간 [−0.020, −0.009], 0 미포함) · 실현 RC 35/29/36 → 40/21/39 · 총위험은 거의 같음(변동성 16.0 vs 16.1% · MDD −18.3 vs −18.8%) · 회전율 0.065 vs 0.067 · 변동성 예측 RMSE 0.455 vs 0.460(허용 안). MV-LW 는 회전율 0.170 으로 탈락. **RB-VT 는 목표 달성 기준 미달**(경로 변동성 13.6% · 분기 16.2% 초과 비율 16% > 10% — 1년 창은 2020-1Q 같은 충격을 미리 못 봄) → 덧씌우지 않음. 위성–S&P 1년 원화 상관 중앙 0.62(의뢰 전제 맞음). 봇의 사후 수정 2건(MV 수렴 판정 · 중복 제약) 기록됨, 판정 불변.
  - 뜻: 바뀌는 것은 "누가 위험을 지느냐"(핵심 지수가 예산대로 40%), "위험이 얼마냐"는 그대로. 수익 예측이 아니다. 한계: 한·미 종가 시각 차이로 국내 종목 상관이 낮게 잡혀 비중이 상한까지 감(측정 착시 가능) · 생존 편향 · 83분기 · 예산 40/20/40 자체는 시험하지 않음.
- **실행:** 개인 모듈(`personal/toss-dca/`, 공개 저장소 밖)에 재조정 RB1 을 만들었다 — `risk-budget.mjs`(표본공분산 · LW 축소 · 위험예산 풀이 · 상한 · 원화 수익률 행렬), `rebalance-core.mjs`(계산: 전환/분기 · 세금 반영 매도 밴드 · 하락 매수분 보호 · 통화별 매수(환전 없음) · 50% 보호 · FIFO 세금 lot · 250만 공제 요약), `rebalance-runner.mjs`(시장 창 · 매도 가능 수량 · 동의 C11 · STOP · 장부 먼저 · 매도 먼저/같은 통화 매수는 다음 실행 · 체결→lot), `rebalance.mjs` CLI(plan · run --live · check · consent · status · tax · stats · **weights --apply**). `toss-trade.mjs` 에 placeOrder(매수·매도 · 지정가 · 정수 수량)·sellableQty·buyingPowerUsd·exchangeRate·calendarUS·cancel. `lib/consent.js` 에 조항 **C11**(실거래 재조정 주문 · 설정이 바뀌면 다시 묻음). 시험 35/35 · 실행본 478/480(기존 2) · 저장소 444/444. 실계좌 읽기 전용 dry-run 정상(주말이라 전부 '휴장' 표시).
  - 비중은 설정에 박지 않고 `weights --apply` 가 분기마다 데이터에서 계산한다(RB-FULL · 표본 238일 · LW δ 0.099 · 사전 변동성 18.7% — 사용자가 받아들인 13.5% 보다 높으며 변동성 목표는 기준 미달이라 쓰지 않음, 기록만). 실제 주문은 사용자가 `node rebalance.mjs consent`(C11) 와 설정 `live:true` 를 켠 뒤에만. 핵심은 미국 상장(결정 50 세금), 적립 모듈의 국내 ETF 는 계획 밖 보유로 둔다.
- **남은 것:** 초대형 IPO 사건연구(PREREG-H, 진행 중) · 미국 밤 실행 예약 작업(사용자 등록) · 공포 사다리의 실계좌 연결(되채움 목표 전달) · 결제 전 매도대금 사용 가능 여부(실거래 첫 회에서 확인).

## (52) 2026-11-22 초대형 IPO 자금 흐름 — 사전 등록 사건연구(PREREG-H) 미달 → 이슈 스캐너에 '기록(note)' 등급 사건 메모만, 매매 차단·유발 없음

- **요청(사용자):** "주요 스타트업의 IPO 도 매우 큰 영향을 미칠 수 있다 … 초대기업 상장으로 인한 금액의 흐름까지 분석해야 한다."
- **이번 주 사실(Anthropic IPO · 출처 로컬 기록):** 2026-11-18 공모가 $83(희망 $70~78) · 11-19 나스닥 상장(ANT) · 공모 약 $81.3B(그린슈 포함 약 $93.5B) + 전략 투자자 사모 $26.0B · 첫날 종가 $97.17(+17.1%) · 락업 일반 2027-05-17 · 나스닥100 신속 편입 12-21 보도(공식 미확인) · S&P500 은 12개월·흑자 요건 유지. 상장 주간 S&P500 −8.6%, 나스닥100 −10.4% — 그러나 같은 주에 엔비디아 CEO 사임(11-12)·SEC 조사 보도(11-20)가 겹쳤고, LSEG Lipper 자금 흐름은 미국 주식형 +$45.7B 유입이었다. "IPO 대금 마련 매도"는 측정된 근거가 없는 해석(추론).
- **사건연구(PREREG-H 먼저 작성 · 2012~2026 미국 최대 IPO 25건 → 묶음 뒤 23건 · 비교 대상 = 같은 섹터 시총 상위 5 · 시장 조정 수익률):** 상장 전 [−10,−1] 평균 +0.80%(p 0.25) · 직후 [0,+5] +0.84%(p 0.07) · [+6,+20] +0.40% · 락업 만료 [−5,+5] −0.08%(p 0.88). 음수로 유의한 창 없음(판정 기준 p<0.05 · 중앙값 < −1%). 80% 검정력으로 잡을 수 있는 효과는 −1.3~−2%. IPO 종목 자체의 락업 AR 평균 −0.95%(편차 큼). **판정: NOTE_ONLY.**
- **문헌:** Braun–Larrain 2009(신흥시장에서만 공급 효과) · Field–Hanka 2001(락업 만료 −1.5%, 1988~97) · Hsu–Reed–Rocholl 2010(경쟁사 하락은 유동성이 아니라 경쟁 경로) · Greenwood–Sammon 2025(지수 편입 효과 1% 미만으로 축소) · Baker–Wurgler 2000 · Loughran–Ritter 1995. 2023~26 초대형 IPO 유동성 효과의 동료심사 연구는 없음(미검증).
- **실행:** `scripts/ipo-events.mjs` 가 Nasdaq IPO 캘린더(비공식 API)와 SEC EDGAR 424B4 검색을 하루 1번 읽어 공모액 $2.5B 이상을 `data/ipo-events.json` 에 사건 메모({date, issuer, sector, sizeUsdM, lockupDate, indexDates, src, rule:'PREREG-H NOTE_ONLY'})로 적는다. 화면(모의투자 운용 기록·점검)에 '시장 사건' 한 줄로 보이고, 공개 스냅샷 `events` 에 들어간다. 등급은 note 만 — 하락 매수 카드·매매 차단·주문에 연결하지 않는다. 표본이 늘면 같은 규칙으로 다시 돌린다(조정 없음).
- **한계:** 표본 23건 · 2020~21·2026 에 몰림 · 베타 보정 없는 단순 시장 조정 · 26위 이하 후보 누락 가능 · Nasdaq API 는 비공식(막힐 수 있음) · SEC 요청 User-Agent 연락처는 사용자가 정함.

## (53) 2026-11-22 정밀화 시험(사전 등록 PREREG-I) — 재료 6개를 하나씩 바꿔도 RB-FULL 을 넘는 것 없음 → RB-FULL 유지

- **요청(사용자):** "더 정밀하고 완벽한 금융 모델 · 클로드 기능을 최대한 · 가장 강한 모델로."
- **시험(`PREREG-I.md` 먼저 작성 · PREREG-G 와 같은 걷기-전진 83분기 · 바구니 100개 일치 확인):** I0 RB-FULL(재현: 모든 지표 차이 0) · I1 비동기 종가 보정(교차시간대 쌍에 1-시차 리드–래그 합 S_ij = Γ0_ij + Γ1_ij + Γ1_ji 뒤 LW 축소) · I2 비선형 축소(Ledoit–Wolf 2022 QIS 전체 구현) · I3 시변 공분산(자산별 GARCH(1,1) QMLE × EWMA 0.97 상관, Σ = DRD) · I4 CVaR95 위험예산(쌍대 문제) · I5 20일 블록 부트스트랩 200회 평균 비중 · I6 HRP(대조). 판정: 자기 목표 지표를 부트스트랩 90% 구간이 0 을 배제하며 개선 + 위험예산 추적오차 악화 ≤ 0.005 + 회전율 ≤ 1.5×.
- **결과:** 통과 0개. I1 — 다음 분기 주간 KR–US 상관 예측 오차 개선 안 됨(0.261→0.269, 사후 진단: 같은 창 안의 비동기 편향은 실제로 고치지만(RMSE 0.148→0.094) 다음 분기 상관 자체가 예측 불가 — 같은 창 주간 상관으로도 0.272). I2 — 효과 0(N=8, c≈0.03 이라 고유값이 거의 안 움직임, 사전 예측대로). **I3 — 변동성 예측 RMSE 0.460→0.413(구간 [−0.077,−0.015], 유의)이지만 회전율 1.53×(한도 1.5×) 초과로 탈락**; 비용 차이는 연 약 0.014%p 로 작음. I4 — CVaR 추적이 오히려 나쁨(1년 창 꼬리 시나리오 ≈13개). I5 — 지표 변화 없음(상한 걸린 분기 37%→9%만). I6 — 예산을 무시해 위성이 위험의 58%.
- **뜻:** 공분산 추정의 정밀화는 이 규모(8자산·1년 창)에서는 비중을 거의 바꾸지 못하고, 유일하게 개선된 변동성 예측(I3)은 변동성 목표 덧씌우기가 기준 미달로 빠진 뒤로는 **비중에 쓰이지 않는 수치**다. 그래서 I3 의 근소 회전율 초과를 받아들여 규칙을 고칠 이유가 약하다(사용자가 원하면 새 사전 등록으로). 정밀도의 병목은 추정량이 아니라 분기 단위 83개의 표본·국면 전환·한·미 시차라는 데이터 쪽이다. 수익 예측은 어느 변형도 하지 않는다.
- **GARCH 참고(채택 안 함):** φ 중앙값 0.975, 21% 가 ≥0.99(거의 적분형). 미국 지수 장기 σ 20.7% · 63일 예측 23.1%.
- **한계:** 생존 편향 · 83분기 공유 경로 · 일간 실현 지표도 비동기 편향 · 다중검정 보정 없음 · 환율 종가 시각 미검증.
- **다음:** 파이썬 라이브러리 교차 검증(사용자가 pip 설치 뒤) · 가장 강한 모델 워크플로의 매도 모듈 검토 결과 반영.
