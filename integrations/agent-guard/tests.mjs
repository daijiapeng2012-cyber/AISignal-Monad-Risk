import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGuard, validateBaseURL, validateOperatorPolicy, digest, MAX_BYTES } from './guard.mjs';

const policy = JSON.parse(await readFile(new URL('./policy.example.json', import.meta.url), 'utf8'));
const proposal = { network: 'mainnet', market_id: 1, intent: { side: 'buy', notional_usd: 1000, hold_hours: 4, adverse_move_pct: 5 } };
function receipt(input, overrides = {}) {
  const value = { schema: 'aisignal-preflight-receipt/1', evaluated_at: new Date().toISOString(), input, snapshots: { context: {}, book: {}, ticker: {} }, evidence: [], result: { decision: 'pass', expires_at: new Date(Date.now() + 25000).toISOString() }, ...overrides };
  return { ...value, sha256: digest(value), authentication: { type: 'hmac-sha256', value: 'a'.repeat(64) } };
}
const verification = { integrityValid: true, signatureValid: true, replayMatches: true, expired: false, authentication: 'hmac-sha256', current_action_authorized: false };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function mockGuard({ mutateReceipt = value => value, mutateVerification = value => value } = {}) {
  const calls = [];
  const guard = createGuard(policy, undefined, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return url.endsWith('/api/preflight') ? json(mutateReceipt(receipt(JSON.parse(options.body)))) : json(mutateVerification({ ...verification }));
  });
  return { guard, calls };
}

test('operator policy is frozen, canonical and independent of caller or later mutation', async () => {
  const original = structuredClone(policy), supplied = structuredClone(policy), calls = [];
  const guard = createGuard(supplied, undefined, async (url, options) => { calls.push(JSON.parse(options.body)); return url.endsWith('/api/preflight') ? json(receipt(JSON.parse(options.body))) : json(verification); });
  supplied.budgets.max_notional_usd = 99999999;
  const result = await guard.propose(proposal);
  assert.equal(result.verified, true); assert.equal(result.guard_decision, 'pass'); assert.equal(result.current_action_authorized, false);
  assert.equal(result.operator_policy_sha256, digest(original)); assert.deepEqual(calls[0].policy, original.budgets);
});
test('caller policy, endpoint, unknown intent fields and disallowed network never reach HTTP', async () => {
  const { guard, calls } = mockGuard();
  for (const args of [{ ...proposal, policy: policy.budgets }, { ...proposal, endpoint: 'http://169.254.169.254' }, { ...proposal, intent: { ...proposal.intent, api_key: 'unused' } }, { ...proposal, market_id: 2 }, { ...proposal, network: 'other' }, { ...proposal, intent: { ...proposal.intent, notional_usd: 1.001 } }, { ...proposal, intent: { ...proposal.intent, adverse_move_pct: 0 } }]) await assert.rejects(guard.propose(args));
  assert.equal(calls.length, 0);
});
test('operator file schema rejects unsafe caps, foreign fields, strings and empty permissions', () => {
  for (const candidate of [{ ...policy, url: 'https://example.com' }, { ...policy, allowed_markets: {} }, { ...policy, budgets: { ...policy.budgets, max_notional_usd: 1e9 } }, { ...policy, budgets: { ...policy.budgets, max_total_cost_usd: '25' } }, { ...policy, allowed_markets: { mainnet: [1, 1] } }]) assert.throws(() => validateOperatorPolicy(candidate));
});
test('startup endpoint allowlist excludes SSRF, production HTTP, credentials, paths and alternate hosts', () => {
  for (const url of ['http://169.254.169.254', 'https://example.com', 'http://aisignal-monad-risk.daijiapeng2012.chatgpt.site', 'https://user:password@aisignal-monad-risk.daijiapeng2012.chatgpt.site', 'http://localhost:8794/private', 'http://127.0.0.1?url=evil', 'https://localhost']) assert.throws(() => validateBaseURL(url));
  assert.equal(validateBaseURL('http://127.0.0.1:1234'), 'http://127.0.0.1:1234');
});
test('changed signed input or changed policy fails before verification call', async () => {
  for (const mutate of [value => { value.input.intent.notional_usd++; const { sha256, authentication, ...payload } = value; value.sha256 = digest(payload); return value; }, value => { value.input.policy.max_notional_usd++; const { sha256, authentication, ...payload } = value; value.sha256 = digest(payload); return value; }]) {
    const { guard, calls } = mockGuard({ mutateReceipt: mutate }); await assert.rejects(guard.propose(proposal)); assert.equal(calls.length, 1);
  }
});
test('tampered digest fails; unsigned, invalid signature/replay, expired result fail closed', async () => {
  const { guard } = mockGuard({ mutateReceipt: value => ({ ...value, sha256: 'b'.repeat(64) }) }); await assert.rejects(guard.propose(proposal), /digest mismatch/);
  for (const change of [{ signatureValid: false }, { integrityValid: false }, { replayMatches: false }, { expired: true }, { authentication: 'unsigned' }, { current_action_authorized: true }]) {
    const instance = mockGuard({ mutateVerification: value => ({ ...value, ...change }) }); const result = await instance.guard.propose(proposal); assert.equal(result.verified, false); assert.equal(result.guard_decision, 'reject');
  }
  const unsigned = mockGuard({ mutateReceipt: value => ({ ...value, authentication: { type: 'unsigned', value: null } }), mutateVerification: value => ({ ...value, authentication: 'unsigned', signatureValid: false }) });
  assert.equal((await unsigned.guard.propose(proposal)).verified, false);
});
test('receipt expiry and excessive TTL are rejected without accepting a fresh policy pass', async () => {
  const input = { ...proposal, policy: policy.budgets };
  const stale = receipt(input, { evaluated_at: new Date(Date.now() - 40000).toISOString(), result: { decision: 'pass', expires_at: new Date(Date.now() - 15000).toISOString() } });
  const { guard } = mockGuard(); assert.equal((await guard.verify({ receipt: stale })).verified, false);
  const overTTL = receipt(input, { result: { decision: 'pass', expires_at: new Date(Date.now() + 60000).toISOString() } }); await assert.rejects(guard.verify({ receipt: overTTL }), /timing/);
});
test('receipt that expires during verification transit fails closed', async () => {
  let current = Date.now();
  const guard = createGuard(policy, undefined, async (url, options) => {
    if (url.endsWith('/api/preflight')) return json(receipt(JSON.parse(options.body)));
    current += 30000; return json(verification);
  }, () => current);
  const result = await guard.propose(proposal); assert.equal(result.verified, false); assert.equal(result.guard_decision, 'reject');
});
test('manual redirects, malformed JSON, HTTP errors and oversized HTTP bodies fail without follow', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://evil.invalid/' } }), new Response('{broken', { headers: { 'content-type': 'application/json' } }), new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } }), new Response('x'.repeat(MAX_BYTES + 1), { headers: { 'content-type': 'application/json' } })]) {
    let count = 0; const guard = createGuard(policy, undefined, async (_, options) => { count++; assert.equal(options.redirect, 'manual'); return response; });
    await assert.rejects(guard.propose(proposal)); assert.equal(count, 1);
  }
});

async function client(t, { handler, extraArgs = [], policyContent = JSON.stringify(policy) } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aisignal-guard-'));
  const policyPath = join(dir, 'policy.json'); await writeFile(policyPath, policyContent);
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ path: req.url, body: JSON.parse(raw) });
    res.setHeader('content-type', 'application/json');
    const value = handler ? await handler(req.url, JSON.parse(raw)) : req.url === '/api/preflight' ? receipt(JSON.parse(raw)) : verification;
    res.end(typeof value === 'string' ? value : JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), '--policy', policyPath, '--base-url', 'http://127.0.0.1:' + server.address().port, ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
  let stdout = '', stderr = ''; const waiting = [], messages = [];
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk;
    let end; while ((end = stdout.indexOf('\n')) >= 0) { const value = JSON.parse(stdout.slice(0, end)); stdout = stdout.slice(end + 1); if (waiting.length) waiting.shift()(value); else messages.push(value); }
  });
  const next = async () => messages.length ? messages.shift() : Promise.race([new Promise(resolve => waiting.push(resolve)), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('MCP response timeout; ' + stderr)), 4000); timer.unref(); })]);
  const send = async message => { child.stdin.write(JSON.stringify(message) + '\n'); return next(); };
  t.after(async () => { child.kill(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  return { child, send, next, requests, stderr: () => stderr, policyPath };
}
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'independent-test-client', version: '1.0' } } };
const call = args => ({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'propose_trade', arguments: args } });

test('actual child stdin/stdout initializes, lists only guarded tools, proposes and verifies frozen receipt', async t => {
  const c = await client(t);
  const before = await c.send({ jsonrpc: '2.0', id: 0, method: 'tools/list' }); assert.equal(before.error.code, -32000);
  const init = await c.send(initialize); assert.equal(init.result.protocolVersion, '2025-06-18');
  c.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await c.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.deepEqual(list.result.tools.map(tool => tool.name), ['propose_trade', 'verify_receipt']);
  const proposed = await c.send(call(proposal)); assert.equal(proposed.result.isError, false); assert.equal(proposed.result.structuredContent.verified, true);
  assert.deepEqual(c.requests.map(req => req.path), ['/api/preflight', '/api/verify-receipt']); assert.deepEqual(c.requests[0].body.policy, policy.budgets);
  const verified = await c.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'verify_receipt', arguments: { receipt: proposed.result.structuredContent.receipt } } }); assert.equal(verified.result.structuredContent.verified, true);
  assert.equal(c.stderr(), '');
});
test('actual child negotiates its supported version with a newer MCP client', async t => {
  const c = await client(t); const result = await c.send({ ...initialize, params: { ...initialize.params, protocolVersion: '2025-11-25' } });
  assert.equal(result.result.protocolVersion, '2025-06-18'); assert.equal(c.requests.length, 0);
});
test('actual child denies policy injection, endpoint overrides, execution command and notifications without HTTP', async t => {
  const c = await client(t); await c.send(initialize);
  for (const args of [{ ...proposal, policy: { max_notional_usd: 1e8 } }, { ...proposal, base_url: 'http://169.254.169.254' }]) { const value = await c.send(call(args)); assert.equal(value.result.isError, true); }
  const denied = await c.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'execute_trade', arguments: proposal } }); assert.equal(denied.result.isError, true);
  c.child.stdin.write(JSON.stringify({ ...call(proposal), id: undefined }) + '\n');
  await c.send({ jsonrpc: '2.0', id: 7, method: 'ping' }); assert.equal(c.requests.length, 0);
});
test('actual child rejects malformed and oversized messages then recovers without HTTP', async t => {
  const c = await client(t); await c.send(initialize);
  c.child.stdin.write('{malformed\n'); assert.equal((await c.next()).error.code, -32700);
  c.child.stdin.write('x'.repeat(MAX_BYTES + 1) + '\n'); assert.equal((await c.next()).error.code, -32000);
  const recovered = await c.send({ jsonrpc: '2.0', id: 8, method: 'ping' }); assert.deepEqual(recovered.result, {}); assert.equal(c.requests.length, 0);
});
test('actual child freezes policy file at startup and rejects oversized responses', async t => {
  const c = await client(t, { handler: (path, body) => path === '/api/preflight' ? 'x'.repeat(MAX_BYTES + 1) : verification }); await c.send(initialize);
  await writeFile(c.policyPath, JSON.stringify({ ...policy, budgets: { ...policy.budgets, max_notional_usd: 99999999 } }));
  const value = await c.send(call(proposal)); assert.equal(value.result.isError, true); assert.match(value.result.content[0].text, /exceeds limit/); assert.deepEqual(c.requests[0].body.policy, policy.budgets);
});
test('actual child startup rejects unknown flags and oversized operator files', async t => {
  for (const config of [{ extraArgs: ['--secret', 'not-a-credential'] }, { policyContent: ' '.repeat(8193) }]) {
    const c = await client(t, config); const exit = await new Promise(resolve => c.child.on('exit', resolve)); assert.equal(exit, 1); assert.match(c.stderr(), /startup rejected/); assert.equal(c.requests.length, 0);
  }
});
