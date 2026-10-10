# AISignal Monad Risk

An open-source, read-only risk workspace built for Monad Metropolis 2026, Onchain Finance & Trading.

**Live product:** https://aisignal-monad-risk.daijiapeng2012.chatgpt.site

Markets → stress a hypothetical exposure → inspect a public wallet → export the evidence. English and Chinese interfaces, light/dark themes and mobile layouts are included.

## Run locally

Node.js 22 or newer. No packages, API keys, wallet signatures or database required.

```sh
node local-server.mjs
# http://127.0.0.1:8794
node --test tests.mjs
```

The deployable Cloudflare Worker is `worker/index.js`, with the HTML, CSS, client code and icon embedded. `local-server.mjs` adapts the same Worker to Node. Build: `npm run build && npm run validate`. Sites source/deploy tooling is infrastructure; the app runs independently in a standard Worker runtime.

## What works

- Actual Perpl public market configuration and approximately seven days of hourly candles on Monad mainnet and testnet. Network-specific IDs are loaded from configuration.
- Completed candle validation, sample volatility, maximum drawdown, worst hourly return and protocol market comparison. Automatic refresh every 60 seconds while the page is visible; can be disabled. Hourly risk metrics change only when a bar completes.
- Independent Monad RPC proof of chain ID, block hash/time and deployed Perpl exchange code at that exact block.
- Public address inspection: exact MON balance to 18 decimals, nonce and deployed-code presence at one pinned block. No login or account connection. The exchange-address example is clearly a contract, not a user's wallet.
- Browser-local hypothetical single-position and up-to-eight-position portfolio stress. Each position has its own shock. Editable labels do not imply fetched holdings.
- Downloadable JSON report with inputs, data snapshots, formulas, source URLs, read timestamps, RPC parameters and SHA-256 of raw decoded responses.

## Data sources and formulas

Primary source documentation: [Perpl REST](https://github.com/PerplFoundation/perpl-docs/blob/main/docs/resources/for-developers/api/rest.md), [Monad networks](https://docs.monad.xyz/developer-essentials/network-information).

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

Historical statistics are not forecasts or investment advice. No AI inference or trading is implemented. Hypothetical margin is not verified account equity. Fees, funding, entry-price differences, liquidation and cross-margin rules are excluded. MON wallet balance is not Perpl collateral, and nonce is not total wallet activity. Authenticated Perpl positions and order history are not fetched.

The app uses only hardcoded upstream hosts, strict public address/network/market parameters and read-only RPC methods. It rejects arbitrary URLs, duplicate query parameters and mutating HTTP methods. Upstream request timeout: 12 seconds; response maximum: 4 MiB; candle count maximum: 1024. Upstream failure produces unavailable data and never fabricated values.

Addresses are forwarded to the configured Monad RPC when Inspect is requested; the app does not persist addresses, scenarios or account information. Downloaded reports can contain the inspected address. Hosting/network providers may retain routine access logs. This repository contains no private AISignal databases, strategies, broker adapters, credentials or history.

## Build window & AI disclosure

The pre-existing AISignal project remains private. A local static interface existed before this hackathon (sample date 2026-08-01). Its layout/CSS concepts informed an earlier sanitized prototype; its stock snapshots, portfolio data, PDF and contact assets were excluded.

New during the Metropolis build window, on 2026-10-10: Perpl public-data adapter, validated risk calculations, Monad RPC proof, standalone Python prototype, then this Worker-based public product with bilingual redesigned interface, public-wallet lens, protocol comparison, local portfolio stress, evidence export, logo and submission videos. `docs/source-lineage.json` records the prior baseline and new scope.

OpenAI Codex assisted coding, tests, documentation and media preparation. The logo was generated with an image model. Video narration is synthesized. Product risk explanations are deterministic calculations; these development tools are not integrated as product AI features. New source is MIT licensed; deployment artifacts are derived from this repository.

## Judging walkthrough

1. Open the live product, select mainnet/BTC. Read actual completed bars and timestamps.
2. Compare markets; missing/gapped histories remain unavailable.
3. Change leverage to 10 and shock to −10% on $1,000 margin; P&L is −$1,000, with a margin-loss warning. Add to the hypothetical portfolio and compare a short scenario.
4. Inspect the public exchange address or another public address. Compare its pinned block, MON balance/nonce/code with the explorer.
5. Expand receipts and export JSON. Review formulas and provenance.
6. Switch to testnet and repeat; observe independent market IDs and Chain ID 10143.

## Submission media

Technical demo (under 3 minutes), pitch (under 2 minutes) and 1024px logo are included in the GitHub release assets once produced. Public landing/video links are listed on the release page and in `docs/submission.md`.
