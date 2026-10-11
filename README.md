# AISignal Monad Risk

**Check the trade before it becomes a transaction.** An open-source trade-intent preflight for Monad Metropolis 2026, Onchain Finance & Trading.

**Live product:** https://aisignal-monad-risk.daijiapeng2012.chatgpt.site

An agent proposes $50,000 of exposure. AISignal sweeps real Perpl liquidity, computes entry costs and stress loss, and identifies the rules it breaches. Apply a smaller admissible reference notional, check fresh live data, and export a frozen receipt for authenticated verification and deterministic replay. English/Chinese, light/dark and mobile interfaces are included. The previous research workspace remains under an expandable section.

## Run locally

Node.js 22 or newer. No packages, API keys, wallet signatures or database required.

```sh
node local-server.mjs
# http://127.0.0.1:8794
npm test
```

Source modules are `worker/index.js`, `worker/preflight.js` and `worker/preflight-ui.js`. The dependency-free build flattens them into one standard Cloudflare Worker ESM artifact. `local-server.mjs` adapts the same fetch handler and JSON bodies to Node. Build: `npm run build && npm run validate`. Sites source/deploy tooling is infrastructure; the app runs independently in a standard Worker runtime. Optional server-only `PREFLIGHT_RECEIPT_SECRET` enables HMAC-SHA256 authentication. Without it, receipts explicitly state `unsigned`; SHA-256 integrity cannot authenticate server origin. Never commit a production secret; tests use deliberately public fixture keys.

## Trade-intent preflight

Set buy/open-long or sell/open-short, reference notional, hold hours, supplied adverse stress move and policy limits. Retrieve fresh Perpl configuration, L2 book and ticker, validate native scales/time/network/sequence, sweep asks or bids with exact BigInt native lots and price×quantity products, then show VWAP, spread, average/worst slippage, base-tier taker fee, signed funding estimate and stress loss.

Five rules (`DEPTH`, `SIZE`, `SLIPPAGE`, `COST`, `STRESS`) produce `pass`, `revise` or `reject`. Incomplete native-lot fills cannot pass. When feasible, a bounded search finds the largest smaller reference notional at cent resolution under the same frozen book and limits. Applying it always retrieves new data. The public policy editor is a rehearsal tool, not custodial authority; the [operator-controlled MCP agent adapter](integrations/agent-guard/README.md) freezes a separate policy that tool callers cannot overwrite. Neither component controls an external wallet or prevents bypass elsewhere.

Books/tickers must be no older than 30 seconds, never future-dated, and within 15 seconds of each other. At most 100 strictly sorted nonzero levels per side are accepted. Funding timestamps identify application, not publication; documented advance under a minute is allowed, and age is bounded by the configured interval plus 60 seconds. Missing required fee/funding/time fields never become zero. Failure is closed with HTTP 502, without synthetic data fallback.

| Calculation | Definition |
|---|---|
| Reference | Best-bid/ask midpoint, with published price decimals |
| Target lots | Floor(reference-notional / midpoint) in native size decimals |
| VWAP | Exact scaled quote product sum / filled native lots |
| Slippage | Adverse midpoint-relative difference; policy bounds worst filled level |
| Fee | Executed notional × base-tier `taker_fee / 1e6` |
| Funding | Executed notional × latest `funding.rate / 1e6` × hold seconds / interval; buy pays positive rate, sell has opposite sign |
| Conservative cost | Adverse entry impact + entry fee + max(0, funding estimate) |
| Stress loss | Executed notional × supplied adverse percentage + conservative cost |

Funding holds the latest rate constant and prorates by hold time; income does not relax budgets. Exit fees, gas, actual account tier, account equity, liquidation, cross-margin, hidden liquidity and queue effects are excluded. Margin documentation examples have inconsistent semantics, so this product does not infer liquidation or margin sufficiency. Native products and policy comparisons use exact BigInt rational arithmetic, including exposure, cost, stress and slippage boundaries; final displayed ratios/dollars use JavaScript numbers and may be rounded. No epsilon relaxes the budgets.

## Monad and agent integration

Perpl's Monad-native onchain order book is the actual source used to size the intent. Receipts bind chain ID 143/10143, order-book block/sequence and ticker block, with observed time consistency. These are sequential public observations, not atomic same-block reads. The existing RPC panel independently checks a pinned Monad block/hash/time and deployed exchange code.

`POST /api/preflight` uses strict bounded JSON and re-reads hardcoded public upstreams. `POST /api/verify-receipt` verifies digest integrity, optional server HMAC, frozen replay equality and expiry separately. Exported receipts contain parsed public snapshots, intent, policy, result, source hashes/timestamps and expiry. A client can edit and rehash an unsigned receipt; HMAC authenticates it to the server with that secret, not to arbitrary third parties. Key rotation can invalidate earlier authentication. An expired receipt can remain a valid historical replay, but never a current pass. Verification always returns `current_action_authorized:false`.

A configured snapshot pass is not execution authorization, a guarantee, wallet permission or a forecast. No actual order, deposit, signature, authenticated position or LLM inference is implemented. See [API schema and examples](docs/preflight-api.md) and the [agent guard](integrations/agent-guard/README.md).

## What works

- Actual Perpl public market configuration and approximately seven days of hourly candles on Monad mainnet and testnet. Network-specific IDs are loaded from configuration.
- Completed candle validation, sample volatility, maximum drawdown, worst hourly return and protocol market comparison. Automatic refresh every 60 seconds while the page is visible; can be disabled. Hourly risk metrics change only when a bar completes.
- Independent Monad RPC proof of chain ID, block hash/time and deployed Perpl exchange code at that exact block.
- Public address inspection: exact MON balance to 18 decimals, nonce and deployed-code presence at one pinned block. No login or account connection. The exchange-address example is clearly a contract, not a user's wallet.
- Browser-local hypothetical single-position and up-to-eight-position portfolio stress. Each position has its own shock. Editable labels do not imply fetched holdings.
- Downloadable JSON report with inputs, data snapshots, formulas, source URLs, read timestamps, RPC parameters and SHA-256 of raw decoded responses.

## Data sources and formulas

Primary source documentation: [Perpl REST](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md), [types/scales](https://github.com/PerplFoundation/api-docs/blob/main/types.md), [Monad networks](https://docs.monad.xyz/developer-essentials/network-information).

| Network | Perpl API | Monad RPC | Chain ID |
|---|---|---|---|
| Mainnet | `https://app.perpl.xyz/api` | `https://rpc.monad.xyz` | 143 |
| Testnet | `https://testnet.perpl.xyz/api` | `https://testnet-rpc.monad.xyz` | 10143 |

Prices are scaled by the published `price_decimals`. An hourly candle is completed only when `t + 3600000 <= retrieval time`. At least 24 continuous completed bars are required. Duplicates, nonfinite/invalid prices, impossible OHLC and gaps reject or withhold calculations. No simulated market fallback is substituted when a source fails.

- Daily historical volatility: sample standard deviation of hourly `ln(close[t]/close[t-1])` × √24 × 100.
- Maximum drawdown: minimum `close / running_peak - 1`, in percent.
- Worst hourly return: minimum simple close-to-close return, in percent.
- Scenario P&L: margin × leverage × shock_percent / 100 × direction (+1 long, −1 short).
- Portfolio: sum independent scenario P&Ls; gross notional sums absolute exposure, signed net notional sums directions. Net across different assets is a bookkeeping total, not a hedge/risk equivalence claim.

Evidence hashes identify the exact responses read at that time; a subsequent live fetch can differ. The report contains parsed candles but not every raw upstream payload, so validating a historical raw-response digest requires retaining that original response separately. Code-presence proof is not a security audit of the exchange.

## Boundaries and failure behavior

Historical statistics are not forecasts or investment advice. No AI inference or trading is implemented. Hypothetical portfolio margin is not verified account equity. The older local portfolio laboratory excludes fees/funding/entry differences; the new preflight includes the scoped entry cost model above. Liquidation/cross-margin/account equity remain excluded. MON wallet balance is not Perpl collateral, and nonce is not total wallet activity. Authenticated Perpl positions and order history are not fetched.

The app uses only hardcoded upstream hosts, strict public address/network/market parameters and read-only RPC methods. Arbitrary URLs, unsupported fields, private keys, duplicate query parameters and all POST routes except simulation/verification are rejected. Upstream request timeout: 12 seconds; response maximum: 4 MiB; candle count maximum: 1024; POST JSON cap: 512 KiB. Failure produces unavailable data and never fabricated values. The app does not store trade intents or receipts.

Addresses are forwarded to the configured Monad RPC when Inspect is requested; the app does not persist addresses, scenarios or account information. Downloaded reports can contain the inspected address. Hosting/network providers may retain routine access logs. This repository contains no private AISignal databases, strategies, broker adapters, credentials or history.

## Build window & AI disclosure

The pre-existing AISignal project remains private. A local static interface existed before this hackathon (sample date 2026-08-01). Its layout/CSS concepts informed an earlier sanitized prototype; its stock snapshots, portfolio data, PDF and contact assets were excluded.

New during the Metropolis build window, on 2026-10-10: Perpl public-data adapter, validated risk calculations, Monad RPC proof, standalone Python prototype, Worker deployment, bilingual responsive interface, public-wallet lens, protocol comparison, local portfolio stress, evidence export and media, followed by live-L2 trade preflight, deterministic policy decisions, strict JSON agent API, frozen HMAC/replayable receipts and operator-policy MCP integration. `docs/source-lineage.json` records the prior baseline and new scope.

OpenAI Codex assisted coding, tests, documentation and media preparation. The logo was generated with an image model. Video narration is synthesized. Product risk explanations are deterministic calculations; these development tools are not integrated as product AI features. New source is MIT licensed; deployment artifacts are derived from this repository.

## Judging walkthrough

1. Open mainnet/BTC. Observe a real timestamped order book.
2. Click **Try an oversized agent order**. The $50,000 reference intent breaches the default $10,000 exposure policy and may also breach cost/stress limits. Review each rule and fill.
3. Click **Use this size & recheck live**. New data may pass, revise again or reject if liquidity changes; freshness is deliberate.
4. Set zero stress-loss budget to show refusal of a positive-cost intent. Restore a feasible policy; try sell direction and inspect signed funding.
5. Export the frozen receipt and import under **Verify an exported receipt**. Compare digest/authentication/replay/expiry. After 30 seconds, the observation is historical only.
6. Review the JSON request/response, use the operator-controlled agent guard, and repeat on testnet/BTC with its own market ID. Expand the additional historical/portfolio/RPC tools if useful.

## Submission media

The technical demo (under 3 minutes) and pitch (under 2 minutes) show the preflight flow and actual product interactions. Public URLs are listed in `docs/submission.md`; source, logo and media are grouped in release `v3.0.0`. Narration is synthesized with subtitles.
