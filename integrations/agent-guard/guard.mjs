import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const DEFAULT_BASE_URL = 'https://aisignal-monad-risk.daijiapeng2012.chatgpt.site';
export const MAX_BYTES = 256 * 1024;
export const CLOCK_SKEW_RESERVATION_MS = 5000;
const BUDGET_KEYS = ['max_notional_usd', 'max_slippage_bps', 'max_total_cost_usd', 'max_stress_loss_usd'];
const NETWORKS = ['mainnet', 'testnet'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function exactKeys(value, keys) {
  assert(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Unexpected or missing fields');
}
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
}
export const digest = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
function number(value, min, max, name, cents = false) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, 'Invalid ' + name);
  if (cents) assert(Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, name + ' requires at most two USD decimals');
}
function deepFreeze(value) { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export function validateOperatorPolicy(policy) {
  exactKeys(policy, ['schema', 'allowed_markets', 'min_adverse_move_pct', 'budgets']);
  assert(policy.schema === 'aisignal-agent-policy/1', 'Unknown operator policy schema');
  assert(object(policy.allowed_markets) && Object.keys(policy.allowed_markets).length > 0 && Object.keys(policy.allowed_markets).every(key => NETWORKS.includes(key)), 'Invalid allowed networks');
  for (const ids of Object.values(policy.allowed_markets)) {
    assert(Array.isArray(ids) && ids.length > 0 && ids.length <= 32 && new Set(ids).size === ids.length && ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 99999999), 'Invalid allowed market IDs');
  }
  number(policy.min_adverse_move_pct, 0.01, 100, 'minimum stress move');
  exactKeys(policy.budgets, BUDGET_KEYS);
  for (const key of BUDGET_KEYS) number(policy.budgets[key], 0, key === 'max_slippage_bps' ? 10000 : 100000000, key, key !== 'max_slippage_bps');
  return deepFreeze(structuredClone(policy));
}
export async function loadOperatorPolicy(path) {
  assert(typeof path === 'string' && isAbsolute(path), '--policy requires an absolute file path');
  const handle = await import('node:fs/promises').then(fs => fs.open(path, 'r'));
  try {
    const stat = await handle.stat(); assert(stat.isFile() && stat.size <= 8192, 'Policy file exceeds 8192 bytes or is not a regular file');
    const data = Buffer.alloc(8193); const { bytesRead } = await handle.read(data, 0, data.length, 0);
    assert(bytesRead <= 8192, 'Policy file exceeds 8192 bytes');
    let value;
    try { value = JSON.parse(data.subarray(0, bytesRead).toString('utf8')); } catch { throw new Error('Policy file must contain valid JSON'); }
    return validateOperatorPolicy(value);
  } finally { await handle.close(); }
}
export function validateBaseURL(base) {
  const url = new URL(base);
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Base URL must be an origin without credentials, path or query');
  const production = url.origin === DEFAULT_BASE_URL;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:';
  assert(production || local, 'Base URL must be the public AISignal origin or loopback HTTP for development');
  return url.origin;
}
export function validateProposal(args, policy) {
  exactKeys(args, ['network', 'market_id', 'intent']);
  assert(NETWORKS.includes(args.network) && policy.allowed_markets[args.network]?.includes(args.market_id), 'Network or market is outside operator allowlist');
  exactKeys(args.intent, ['side', 'notional_usd', 'hold_hours', 'adverse_move_pct']);
  assert(['buy', 'sell'].includes(args.intent.side), 'Side must be buy or sell');
  number(args.intent.notional_usd, 0.01, 100000000, 'notional', true);
  number(args.intent.hold_hours, 0, 168, 'hold hours');
  number(args.intent.adverse_move_pct, policy.min_adverse_move_pct, 100, 'adverse move (operator minimum)');
  return { ...structuredClone(args), policy: structuredClone(policy.budgets) };
}
export async function boundedResponse(response) {
  assert(response.ok, 'Upstream HTTP ' + response.status);
  assert(response.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'Upstream response must be JSON');
  const reader = response.body?.getReader(); assert(reader, 'Missing upstream JSON body');
  let bytes = 0; const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Upstream JSON body exceeds limit'); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createGuard(policy, baseURL = DEFAULT_BASE_URL, fetchImpl = fetch, now = Date.now) {
  const frozen = validateOperatorPolicy(policy), base = validateBaseURL(baseURL), policySHA256 = digest(frozen);
  async function post(path, input) {
    const encoded = JSON.stringify(input); assert(Buffer.byteLength(encoded) <= MAX_BYTES, 'Request body exceeds limit');
    return boundedResponse(await fetchImpl(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: encoded, redirect: 'manual', signal: AbortSignal.timeout(12000) }));
  }
  function validateReceipt(receipt, expectedInput) {
    exactKeys(receipt, ['schema', 'evaluated_at', 'input', 'snapshots', 'evidence', 'result', 'sha256', 'authentication']);
    assert(receipt.schema === 'aisignal-preflight-receipt/1' && /^[a-f0-9]{64}$/.test(receipt.sha256), 'Invalid receipt schema or digest');
    exactKeys(receipt.input, ['network', 'market_id', 'intent', 'policy']);
    const { policy: submittedPolicy, ...proposal } = receipt.input;
    const authorizedInput = validateProposal(proposal, frozen);
    assert(canonicalJSON(submittedPolicy) === canonicalJSON(frozen.budgets), 'Receipt policy differs from operator policy');
    if (expectedInput) assert(canonicalJSON(receipt.input) === canonicalJSON(expectedInput), 'Receipt does not match proposed trade');
    assert(canonicalJSON(authorizedInput) === canonicalJSON(receipt.input), 'Receipt input is not permitted');
    const { sha256, authentication, ...payload } = receipt;
    assert(digest(payload) === sha256, 'Receipt digest mismatch');
    exactKeys(authentication, ['type', 'value']);
    assert((authentication.type === 'hmac-sha256' && /^[a-f0-9]{64}$/.test(authentication.value)) || (authentication.type === 'unsigned' && authentication.value === null), 'Invalid receipt authentication');
    const evaluated = Date.parse(receipt.evaluated_at), expiry = Date.parse(receipt.result?.expires_at);
    assert(Number.isFinite(evaluated) && evaluated <= now() + CLOCK_SKEW_RESERVATION_MS && Number.isFinite(expiry) && expiry > evaluated && expiry <= evaluated + 30000, 'Invalid receipt timing');
    assert(['pass', 'revise', 'reject'].includes(receipt.result?.decision), 'Invalid receipt decision');
    // Reserve the entire tolerated clock offset; this never extends signed expiry.
    return { expired: now() >= expiry - CLOCK_SKEW_RESERVATION_MS, sha256 };
  }
  async function verify(receipt, expectedInput) {
    const local = validateReceipt(receipt, expectedInput);
    const verification = await post('/api/verify-receipt', { receipt });
    // Digest, authenticated origin, deterministic replay and expiry are all mandatory.
    const valid = local.expired === false && now() < Date.parse(receipt.result.expires_at) - CLOCK_SKEW_RESERVATION_MS && verification.integrityValid === true && verification.signatureValid === true && verification.replayMatches === true && verification.expired === false && verification.authentication === 'hmac-sha256' && verification.current_action_authorized === false;
    return { operator_policy_sha256: policySHA256, receipt_sha256: local.sha256, verified: valid, guard_decision: valid ? receipt.result.decision : 'reject', server_verification: verification, receipt, current_action_authorized: false, safety_scope: 'Advisory pre-execution check only. This adapter has no wallet, signing or order capability. Execution code must independently enforce the result and recheck fresh evidence.' };
  }
  return {
    policySHA256,
    async propose(args) { const input = validateProposal(args, frozen); const receipt = await post('/api/preflight', input); return verify(receipt, input); },
    async verify(args) { exactKeys(args, ['receipt']); return verify(args.receipt); }
  };
}
const numberSchema = (minimum, maximum) => ({ type: 'number', minimum, maximum });
export const TOOLS = [
  { name: 'propose_trade', description: 'Check a hypothetical trade against an operator-frozen policy and fresh public Perpl evidence. Does not sign or submit. Return a verified policy pass, revision, or rejection; unsigned/expired receipts fail closed.', inputSchema: { type: 'object', additionalProperties: false, required: ['network', 'market_id', 'intent'], properties: { network: { type: 'string', enum: NETWORKS }, market_id: { type: 'integer', minimum: 1, maximum: 99999999 }, intent: { type: 'object', additionalProperties: false, required: ['side', 'notional_usd', 'hold_hours', 'adverse_move_pct'], properties: { side: { type: 'string', enum: ['buy', 'sell'] }, notional_usd: numberSchema(0.01, 100000000), hold_hours: numberSchema(0, 168), adverse_move_pct: numberSchema(0, 100) } } } } },
  { name: 'verify_receipt', description: 'Verify an exported preflight receipt against this operator policy, server authentication, digest, frozen replay and expiry. Does not authorize a transaction.', inputSchema: { type: 'object', additionalProperties: false, required: ['receipt'], properties: { receipt: { type: 'object', description: 'Complete aisignal-preflight-receipt/1 JSON from propose_trade or the product export.' } } } }
];
