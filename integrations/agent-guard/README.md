# AISignal Agent Guard: a working stdio MCP adapter

This Node 22 adapter gives an AI agent two callable tools: `propose_trade` and `verify_receipt`. It fetches the live preflight service, freezes an operator policy at startup, verifies the receipt digest and submitted policy locally, then asks the originating service to verify its HMAC signature and replay the frozen calculation. It returns `pass`, `revise` or `reject` only when those checks pass and the receipt remains unexpired; otherwise it fails closed to `reject`.

The adapter performs advisory pre-execution checks. It does not hold a wallet, sign, submit, cancel or otherwise manage orders. An execution integration must enforce its verdict itself, recheck fresh market data immediately before a transaction and manage its own permissions. A policy pass describes a snapshot; it is not transaction authorization or a trading recommendation. No model inference is implemented in this server.

## Run locally

Clone this public repository. No npm packages are needed. Create your own private operator policy from `policy.example.json`. Its example budgets are hypothetical demonstration choices, not recommended risk limits.

```sh
cp integrations/agent-guard/policy.example.json /absolute/private/operator-policy.json
node integrations/agent-guard/server.mjs --policy /absolute/private/operator-policy.json
```

The policy must have exactly `schema`, `allowed_markets`, `min_adverse_move_pct` and `budgets`. Networks and market IDs are allowlisted. The four API budgets are bounded numbers; USD budgets allow at most two decimals. `min_adverse_move_pct` prevents the agent from weakening the stress test by supplying a zero-percent adverse move. The whole operator configuration is canonically hashed and frozen in memory. Changing the file requires a server restart. Protect the file and startup command from the agent if you rely on this separation.

Tool arguments may contain only the documented trade intent fields. A caller cannot supply a policy, alter the endpoint, change a network allowlist or invoke an execution command. Unknown fields fail before any network request. A low notional may still fail because its public book is stale or its costs exceed policy.

## Register with an MCP client

Any client supporting a stdio MCP subprocess can use the following configuration. Substitute absolute paths and a Node 22 executable available to that client. This adapter has been tested with a real child-process MCP test client; registration in your own desktop client still requires its configuration and a tool-discovery check.

```json
{
  "mcpServers": {
    "aisignal-agent-guard": {
      "command": "node",
      "args": [
        "/absolute/AISignal-Monad-Risk/integrations/agent-guard/server.mjs",
        "--policy",
        "/absolute/private/operator-policy.json"
      ]
    }
  }
}
```

For Codex CLI, the corresponding registration command is:

```sh
codex mcp add aisignal-agent-guard -- node /absolute/AISignal-Monad-Risk/integrations/agent-guard/server.mjs --policy /absolute/private/operator-policy.json
```

This README provides an example; the project does not silently edit your client configuration. The transport uses UTF-8 newline-delimited JSON-RPC on stdio and declares only tool capabilities, following the [MCP stdio specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) and [tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

## Tool calls

`propose_trade` accepts exactly this structure:

```json
{
  "network": "mainnet",
  "market_id": 1,
  "intent": {
    "side": "buy",
    "notional_usd": 1000,
    "hold_hours": 4,
    "adverse_move_pct": 5
  }
}
```

`verify_receipt` accepts exactly `{ "receipt": <complete exported receipt> }`. The result includes `operator_policy_sha256`, `receipt_sha256`, `verified`, `guard_decision`, `server_verification`, the complete receipt and `current_action_authorized: false`. A verified policy `revise` or `reject` is a successful evaluation, not permission to execute. An unsigned receipt always returns `verified: false` even if its digest and replay match.

Client and server clocks may differ. Receipt evaluation may be at most 5 seconds ahead of the client clock. The adapter subtracts the same 5 seconds from the signed expiry before use, and checks that conservative deadline again after the verification response. A receipt with 5 seconds or less remaining is rejected. The signed 30-second maximum TTL, HMAC, digest, replay and operator policy checks are unchanged; clock tolerance never extends receipt validity. Operators should synchronize their clocks.

The public production origin is fixed. For development only, the operator may start the server with `--base-url http://127.0.0.1:8794`. Only the exact production HTTPS origin or loopback HTTP origins are accepted. The tool caller cannot set this option. Redirects are rejected, HTTP operations time out after 12 seconds, response/message bodies are capped at 256 KiB and pending requests at 16. stdout contains only protocol messages. Startup errors go to stderr. This adapter does not read client credentials or production secrets.

## Judge demonstration and tests

```sh
node --test integrations/agent-guard/tests.mjs
node integrations/agent-guard/demo-client.mjs --policy /absolute/private/operator-policy.json
```

The demonstration is a real MCP client. It discovers tools, proposes a normal $1,000 trade, proposes an oversized $20,000 trade and attempts an unauthorized policy override. Its output comes from actual service responses; it does not manufacture verdicts. Live outcomes depend on evidence freshness and current book depth. If the service is not deployed with server receipt authentication, the adapter rejects its unsigned result.

Nineteen automated tests cover policy immutability, policy/endpoint injection, minimum stress, budget caps, allowlists, tampered/unsigned/expired receipts, receipt/input mismatch, signature/replay failures, clock offsets/5-second expiry reservation, expiry during verification transit, HTTP redirects/errors, malformed/oversized JSON, child-process version negotiation/initialize/list/call/verify, unsupported execution tools and policy-file mutation. The network fixtures in these tests are synthetic and are not proof of a deployed service's signature verification. Production readback is a separate acceptance step.

Funding/fee, book-depth, queue, liquidation and account-equity limitations remain those listed inside every preflight receipt. The server secret never belongs in this repository or the MCP client configuration.
