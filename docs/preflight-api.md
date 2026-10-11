# Trade-intent preflight API

`POST /api/preflight`, `Content-Type: application/json`, JSON body at most 512 KiB. Exact schema, no unsupported fields or query parameters:

```json
{"network":"mainnet","market_id":1,"intent":{"side":"buy","notional_usd":50000,"hold_hours":8,"adverse_move_pct":3},"policy":{"max_notional_usd":10000,"max_slippage_bps":20,"max_total_cost_usd":12,"max_stress_loss_usd":300}}
```

Network: `mainnet`/`testnet`. Side: `buy` (open long)/`sell` (open short). Notional: >0 and at most $100,000,000; USD fields allow up to two decimals. Hold: 0–168 hours, adverse move: 0–100%, slippage limit: 0–10,000bps. Other budgets may be zero. Use `GET /api/context?network=...` for current market IDs (BTC currently mainnet 1, testnet 16). This simulates new exposure, not closure of an authenticated position.

```js
const response = await fetch(origin + '/api/preflight', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({network,market_id,intent,policy})
});
const receipt = await response.json();
if (!response.ok) throw new Error(receipt.error);
const {decision,checks,suggestion,expires_at} = receipt.result;
// A pass is only a configured snapshot result. This example submits no order.
```

Response fields: `schema:'aisignal-preflight-receipt/1'`, `evaluated_at`, `input`, raw parsed public `snapshots:{context,book,ticker}`, `evidence` (URLs, retrieval times, original decoded-response SHA-256), `result`, canonical-payload `sha256`, `authentication:{type,value}`. Result includes `policy_version:'preflight-1.0'`, `decision:'pass'|'revise'|'reject'`, `simulation`, five `checks`, optional `suggestion`, `expires_at`, `snapshot_blocks`, `safety_scope`, `assumptions`. Check objects: `{id,label,actual,limit,pass}`; IDs: `DEPTH`, `SIZE`, `SLIPPAGE`, `COST`, `STRESS`.

`suggestion.notional_usd` is the maximum smaller reference notional at cent resolution under the same frozen book/policy. Execution notional may differ. Re-submit a revised intent to obtain fresh data. Schema errors return 400; unavailable/invalid/stale source data return 502 with `decision:'reject'`. No synthetic fallback is substituted.

## Frozen verification

`POST /api/verify-receipt`, exact body `{ "receipt": <exported receipt> }`. No network requests; recompute at original `evaluated_at`. Response separately reports `integrityValid`, `signatureValid`, `authentication`, `replayMatches`, `replayError`, `expired`, `current_action_authorized:false` and `meaning`.

The hash/HMAC cover the canonical receipt payload: sorted object keys, ordered arrays, all fields except `sha256` and `authentication`. `authentication.type` is `hmac-sha256` only with server-only `PREFLIGHT_RECEIPT_SECRET`, otherwise `unsigned`; `signatureValid` is then false. HMAC is symmetric, specific to that server secret, not a public-key or wallet signature. Clients can edit and rehash unsigned receipts; digest integrity is not server authentication. Key rotation can invalidate old authentication.

An expired report can remain authentic and reproducible historical evidence, never a current pass. Verification **always** returns `current_action_authorized:false`; obtain a fresh preflight and use an operator-frozen policy before any separately authorized execution.

## Other routes

`GET /api/orderbook?network=mainnet&market_id=1` returns validated public snapshots for visualization. `GET /api/health` reports version/mode and authentication configuration status, never a secret. Historical/context/network/wallet routes remain read-only. All other POST routes return 405; unknown routes return 404. No arbitrary host, private key, order submission, signature, funding, account authentication, model inference or persistent trade-intent storage exists.
