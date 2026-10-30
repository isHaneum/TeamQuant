# Portfolio performance — staged implementation

## Current stage: Task A only

Implemented: a versioned observation model and PC-local persistence for the existing Toss holdings reader. No performance dashboard, transaction import or new return calculation in this stage. This spec is reconstructed from the user's pasted request; the referenced sandbox ZIP and separate documents were not attached.

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

Transactions/CSV ingestion, an external-flow ledger, complete account valuations, TWR/XIRR and monthly returns, benchmark/principle-adherence attribution, an analysis UI and authenticated history export/delete. Their acceptance criteria require a separate request. Today's held basket backtest remains a hypothetical comparison and must not be relabeled as actual account performance.
