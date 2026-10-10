# Metropolis submission

## Name
AISignal Monad Risk

## One-line description
A public-data risk workspace for Monad and Perpl, combining transparent market metrics, wallet context, local stress tests and verifiable evidence.

## Description
AISignal Monad Risk helps Monad builders and Perpl users inspect risk before taking exposure. The working product reads real Perpl public market configuration and completed hourly candles, validates data continuity, and calculates daily historical volatility, maximum drawdown and worst hourly returns. Users can compare markets, switch between mainnet and testnet, and see each observation window.

A Monad RPC proof panel independently checks Chain ID, a pinned block and the deployed Perpl Exchange bytecode. A public-address lens reads exact MON balance, nonce and code presence at one block without a wallet connection or signature. This is public address context, not reconstructed trading positions.

The browser-local stress lab lets users vary margin, leverage, direction and shock, combine up to eight hypothetical positions, and download a JSON report with formulas, inputs, source URLs, timestamps and response hashes. The product has English/Chinese interfaces, light/dark themes and mobile layouts. It does not submit trades or make price predictions; fees, funding and liquidation rules are excluded from scenarios.

The private AISignal application and old sample data are excluded. A pre-existing static layout informed an earlier prototype; the Perpl/Monad adapters, risk logic, Worker deployment, redesigned bilingual UI, wallet lens, portfolio scenarios and evidence export were built during this hackathon window. Codex assisted development; the icon is image-generated and video narration is synthesized. No AI model is used for product inference. Public source, setup instructions and tests are MIT licensed.

## Go-to-market strategy
Start with Monad builders and risk-aware Perpl users who want a reproducible, low-friction way to inspect public risk data. Publish the working product and MIT source, then recruit a small community pilot for task-based feedback on market comparison, leverage sensitivity and evidence export. Use that feedback to prioritize data freshness, protocol-specific risk context and optional authenticated integrations. Share reproducible walkthroughs through relevant developer communities and request ecosystem partner feedback. No active customers, revenue or established partnerships are claimed. The initial release is free; any paid workflow or API offering would follow evidence of actual user demand.

## Track
Onchain Finance & Trading

## Public URLs
Repository: https://github.com/daijiapeng2012-cyber/AISignal-Monad-Risk
Live product: https://aisignal-monad-risk.daijiapeng2012.chatgpt.site
Demo page: https://daijiapeng2012-cyber.github.io/AISignal-Monad-Risk/demo.html
Pitch page: https://daijiapeng2012-cyber.github.io/AISignal-Monad-Risk/pitch.html
Media release: https://github.com/daijiapeng2012-cyber/AISignal-Monad-Risk/releases/tag/v2.0.0

## Judge instructions
No credentials, wallet funding or login are required. Open the live product and follow the README walkthrough. Click Inspect the public exchange contract for a clearly identified public contract sample, or inspect another public address. Use a $1,000 long scenario at 10× leverage and −10% shock to verify a −$1,000 modeled P&L. All scenarios are hypothetical. If a source is rate-limited, an unavailable state is displayed; retry or switch networks. GitHub release videos have English synthetic narration and subtitles. The demonstration uses screenshots of actual product interactions rather than a continuous screen recording.
