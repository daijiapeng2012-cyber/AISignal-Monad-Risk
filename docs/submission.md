# Metropolis submission

## Name
AISignal Monad Risk

## One-line description
Trade-intent preflight for Monad: real Perpl liquidity, deterministic risk limits and replayable receipts for traders and autonomous agents.

## Description
AISignal Monad Risk checks a proposed trade before it becomes a transaction. Users enter buy/open-long or sell/open-short, reference exposure, holding hours, an adverse stress move and explicit policy limits. The working product retrieves live Perpl L2 order-book depth, ticker and configuration on Monad mainnet or testnet, validates native scales and snapshot timing, and sweeps real bid/ask levels with exact native-lot arithmetic. It calculates full/partial fill, VWAP, spread, worst-level slippage, base-tier taker fee, constant-current-rate funding and conservative stress loss.

Five deterministic checks produce pass, revise or reject with rule-level explanations. An oversized agent intent is blocked; when possible the product finds the largest smaller reference notional within the same frozen policy/book. Applying that size retrieves fresh data. Missing, stale, future or inconsistent required data fails closed. A pass only means the configured snapshot policy is met; it is not execution authorization, a forecast or a guarantee.

A strict JSON API and a stdio MCP adapter let autonomous agents propose an intent while the adapter freezes an operator-defined policy and stress floor. The public policy editor is a rehearsal tool; neither component controls an external wallet. There is no actual order submission, signing, authenticated account read or LLM inference. Frozen receipts contain public raw input snapshots, policy, decision, expiry and source provenance; optional server HMAC authentication, SHA-256 integrity and deterministic historical replay are verified separately. Expired receipts never authorize a current action.

Monad is integral to the liquidity source: receipts bind native Perpl book/sequence, ticker block, chain ID and time-consistency checks. Additional panels retain historical market comparison, hypothetical portfolio stress and public-address RPC context at a pinned Monad block. The interface is responsive, English/Chinese and light/dark. Exit fees, gas, account-tier discounts, account equity and liquidation are outside the preflight model.

The complete AISignal remains private; this independent MIT repository contains the submitted product only. A pre-existing static interface informed an earlier sanitized layout. Perpl/Monad integrations, the risk workspace and the new live-L2 preflight, policy engine, agent API/adapter and authenticated frozen receipts were built during the hackathon window. Codex assisted development, the logo is generated and narration synthesized. No customers, revenue or partnerships are claimed.

## Go-to-market strategy
Start with Monad/Perpl builders creating automated trading interfaces and users who need to understand entry costs before taking exposure. Offer the hosted rehearsal workspace, MIT policy engine and operator-controlled MCP adapter for integration, then recruit a small developer pilot to measure rule comprehension, integration effort, freshness failures and usefulness of size revisions. Prioritize reproducible failure cases and protocol-specific user feedback rather than claims of trading returns. Validate demand before introducing hosted policy APIs or paid observability. No live-trade outcomes, active customers, revenue or established partnerships are claimed.

## Track
Onchain Finance & Trading

## Public URLs
Repository: https://github.com/daijiapeng2012-cyber/AISignal-Monad-Risk
Live product: https://aisignal-monad-risk.daijiapeng2012.chatgpt.site
Demo page: https://daijiapeng2012-cyber.github.io/AISignal-Monad-Risk/demo.html
Pitch page: https://daijiapeng2012-cyber.github.io/AISignal-Monad-Risk/pitch.html
Media release: https://github.com/daijiapeng2012-cyber/AISignal-Monad-Risk/releases/tag/v3.0.0

## Judge instructions
No credentials, deposits or wallet connections required. Select mainnet/BTC and click Try an oversized agent order. Read the violated exposure/cost/stress rules and the real simulated fill. Apply the suggested size to run a fresh check; changing liquidity may require another revision. Set a zero stress-loss budget to show refusal, then restore feasible limits. Export the frozen receipt and import it for digest/authentication/replay/expiry verification. Review the JSON request/response and operator-policy MCP integration in the repository. After 30 seconds the report becomes historical only. Repeat on testnet. Public-data failures display unavailable and block any pass. The demo and pitch explain the preflight flow, show actual product interactions, and use synthetic English narration with subtitles.
