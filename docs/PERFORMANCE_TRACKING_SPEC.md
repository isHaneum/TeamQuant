# Portfolio performance — staged implementation

## Foundation: Task A

Task A baseline: a versioned observation model and PC-local persistence for the existing Toss holdings reader. That stage did not include a performance dashboard or returns. Current follow-up features are specified below. This spec is reconstructed from the user's pasted request; the referenced sandbox ZIP and separate documents were not attached.

### Observation contract (schemaVersion 1)

- Successful record: `kind=holdings_snapshot`, `status=success`, `scope=holdings_only`.
- `accountId`: HMAC of broker, API client ID and broker account reference with a PC-local random salt. Original references and API credentials never enter the record or browser response. The current connector still reads the first brokerage account only.
- `observedAt`: UTC time of the broker read; `recordedAt`: UTC local recording time. This is an observation timestamp, not a historical trade timestamp or a guaranteed quote exchange timestamp.
- Each position: symbol, name, currency, fractional quantity, average cost, quoted price, cost basis, holding value, unrealized P/L. Totals stay separated by KRW/USD.
- Current FX quote and its provider timestamp text are retained when available. A date-only FX timestamp is not expanded into an invented precise instant.
- Cash and total account equity remain `null`. Cash/transaction/external-flow coverage is explicitly false. USD holdings without FX do not become an invented KRW total.
- Failed record: `kind=collection_failure`, `status=failed`, `scope=unavailable`, `data=null`. Only a sanitized error code is recorded. An unknown account is `null`, not assigned to another owner.
- No TWR, XIRR, realized P/L, monthly account return, historical reconstructed balance, MDD or benchmark alpha fields are generated.

### Persistence

- Defaults to `%LOCALAPPDATA%/TeamQuant/portfolio-history` on Windows; `$XDG_DATA_HOME/TeamQuant/portfolio-history` or `~/.local/share/TeamQuant/portfolio-history` elsewhere.
- Optional `TEAMQUANT_HISTORY_DIR` must stay outside the application root. Vercel storage is rejected before creating files.
- JSON snapshot store: `records/<payload-hash>.history.json` and a local `.identity-salt`. Files are plaintext, not encrypted. POSIX modes 0700/0600 are requested; on Windows OS account access controls apply.
- Atomic publication uses a synced temporary file and an exclusive hard link. Existing records are not overwritten. Concurrent duplicate observations retain the first recorded time; a later read time is a separate observation.
- Restart-safe account partitioning. Changed API client ID starts a new partition; automatic account merging is out of scope.
- `list({accountId,from,to,limit})` is a local module API, with newest-first results and `hasMore`. No historical-data HTTP endpoint or UI is exposed in Task A. The initial store scans records; database indexing, retention and backup/restore are later design work.
- Corrupt records or schema mismatches raise an error; never replace them with zero valuations or silently discard them. Incomplete temporary files are not published records.
- Recording failure must be reported without discarding a successful broker response. Clearing a browser view does not delete local history.

### Acceptance tests

Restart persistence; deduplication/concurrent writes; account partitioning; unknown cash/FX; negative P/L and fractions; missing/bad fields; sanitized failed observations; no credential/account-number serialization; cloud/public-root rejection; corruption; date/limit queries; reader integration; graceful recording failure.

## Later work — not implemented

The subsequent user request authorized the CSV and analytics stage below. Automatic complete broker statements, corporate-action accounting, verified causal principle attribution, encrypted storage and long-term recovery remain separate work. Today's held basket backtest remains a hypothetical comparison and must not be relabeled as actual account performance.


## Authorized follow-up: CSV-based account analysis

- New nav: 나의 투자 성과. Separate tabs for holdings-only observations and user-provided full-account CSV. Never promote Task A holdings into full equity.
- Three common-format CSVs: valuations (timestamp,currency,equity,phase), external flows (id,timestamp,currency,type,amount), optional trades (id,timestamp,currency,symbol,side,quantity,price,fee,tax). Optional trade decision fields link user-recorded expected/actual actions. Native broker CSV mappings are not implied.
- One currency per dataset; calendar month and XIRR cash-flow dates use the selected Asia/Seoul, America/New_York or UTC zone. UTC timestamps remain visible. No cross-currency account aggregation.
- `MARK` denotes an ordinary total-equity observation including cash. Period start MARK already includes any flow at the same instant. External flows strictly after start through end affect period net deposits. For every other flow instant, PRE_FLOW and POST_FLOW observations must both exist and reconcile with net flow. No interpolation.
- Coverage requires explicit user confirmation of cash-inclusive valuations and all external flows. Without it, no investment P/L, net deposit, TWR or XIRR claim is made. Source is always user CSV, not broker-verified statements.
- Investment P/L = ending equity − opening equity − net external flows. Buys/sells/dividends/interest are internal, not external cash flows.
- TWR geometrically links each pre-flow segment and resets its value base after flows. Invalid/missing boundaries block TWR/MDD. MDD is from observed cash-flow-neutral index points; unobserved intraperiod losses are unknown.
- XIRR adds the negative opening valuation and positive ending valuation to investor-signed external flows. 365-day annualization; grouped account-calendar dates. Multiple sign changes yield an ambiguity warning rather than an arbitrary root. Log-rate bisection has a declared search range exp(-20)-1 through exp(20)-1. It is not a short-period raw return.
- Monthly rows show their actual observed span and flag missing calendar month-end boundaries. 1M/3M/6M/1Y/3Y/ALL select observed windows; no synthetic history is inserted.
- Trade-only realized P/L uses moving-average basis with buy costs, sale commission/tax and optional OPENING lots. Missing basis/oversell makes realized P/L unavailable. Corporate actions, FX tax accounting and tax reporting are not implemented. The user-recorded action match rate is not independent strategy verification or a causal return attribution.
- Benchmark uses same-currency KOSPI/SPY, prior completed daily prices only (conservative 16:00 KST/17:00 New York availability, max 7 calendar-day lag). Report exact quote anchors, source/fetch time and percentage-point difference. No real asset amounts or cash-flow dates are sent to Vercel's market endpoint; only a public index symbol/range is requested.

### Private APIs and dataset lifecycle

Authenticated loopback bridge actions: history-list, performance-import/list/load/archive. Existing one-use code/bearer policy applies before any data callback. They work without a current broker snapshot; CSV does not require a broker API key. Imports have a 4MB request cap, individual files 1MB and 10,000 rows. No history API exists on Vercel.

Normalized immutable `*.performance.json` datasets are saved under PC user data / portfolio-history/performance. Content IDs deduplicate, archive is recoverable and restore never overwrites an existing target. JSON export is initiated in the browser and includes inputs/report/benchmark provenance. Raw CSVs and filenames are not persisted. Plaintext local storage remains a limitation. Browser clear removes imported memory as well as the report, without deleting PC files.

DEMO is synthetic, memory-only and has saving disabled. Holdings-only view reports failed samples separately and discloses the latest 1,000-record cap. Complete broker cash/transfer history ingestion is not claimed.

### Method references

- https://openapi.tossinvest.com/openapi-docs/latest/openapi.json : /trades is market tape; /orders has coverage restrictions and cannot replace a complete cash-flow/equity ledger.
- https://www.gipsstandards.org/wp-content/uploads/2021/03/2020_gips_standards_firms.pdf : geometric linking and external-flow distinction inform the implementation; no GIPS compliance claim.
- https://support.microsoft.com/en-us/excel/functions/xirr-function : 365-day XIRR definition and numeric example used as a regression reference.
