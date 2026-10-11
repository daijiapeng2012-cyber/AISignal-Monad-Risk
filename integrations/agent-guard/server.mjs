#!/usr/bin/env node
import { createGuard, DEFAULT_BASE_URL, loadOperatorPolicy, MAX_BYTES, TOOLS } from './guard.mjs';

const versions = ['2024-11-05', '2025-03-26', '2025-06-18'];
function parseArgs(args) {
  const config = { base: DEFAULT_BASE_URL }, seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--policy', '--base-url'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node server.mjs --policy /absolute/operator-policy.json [--base-url http://localhost:8794]');
    const key = args[i] === '--policy' ? 'policy' : 'base';
    if (seen.has(key)) throw new Error('Duplicate startup argument'); seen.add(key);
    config[key] = args[i + 1];
  }
  if (!config.policy) throw new Error('Operator --policy is required');
  return config;
}
let guard;
try { const config = parseArgs(process.argv.slice(2)); guard = createGuard(await loadOperatorPolicy(config.policy), config.base); }
catch (error) { process.stderr.write('AISignal Agent Guard startup rejected: ' + error.message + '\n'); process.exit(1); }
let initialized = false;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
async function dispatch(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || Object.keys(message).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) || (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || Number.isSafeInteger(message.id) || message.id === null))) return rpcError(null, -32600, 'Invalid JSON-RPC request');
  const id = message.id, notification = !Object.hasOwn(message, 'id');
  if (notification) return; // Notification messages never trigger network operations.
  if (message.method === 'initialize') {
    const params = message.params;
    if (!params || typeof params.protocolVersion !== 'string' || typeof params.clientInfo?.name !== 'string' || typeof params.clientInfo?.version !== 'string' || !params.capabilities || typeof params.capabilities !== 'object') return rpcError(id, -32602, 'Unsupported or malformed initialize');
    initialized = true;
    return { jsonrpc: '2.0', id, result: { protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions.at(-1), capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aisignal-agent-guard', version: '1.0.0' }, instructions: 'Operator policy is frozen at startup. These tools perform advisory checks only and have no execution, wallet or signing capabilities.' } };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (!initialized) return rpcError(id, -32000, 'Initialize before calling tools');
  if (message.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (message.method === 'tools/call') {
    try {
      const params = message.params;
      if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(key => !['name', 'arguments'].includes(key)) || !Object.hasOwn(params, 'arguments')) throw new Error('Invalid tool call');
      const run = params.name === 'propose_trade' ? guard.propose : params.name === 'verify_receipt' ? guard.verify : null;
      if (!run) throw new Error('Unknown tool; execution and signing are not supported');
      const result = await run(params.arguments);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.verified } };
    } catch (error) { return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ verified: false, guard_decision: 'reject', current_action_authorized: false, error: error.message }) }], isError: true } }; }
  }
  return rpcError(id, -32601, 'Method not found');
}
// Serialize requests so large input bursts cannot create unbounded HTTP concurrency.
let buffer = Buffer.alloc(0), queue = Promise.resolve(), pending = 0, discarding = false;
function schedule(line) {
  if (pending >= 16) { send(rpcError(null, -32000, 'Pending request limit exceeded')); return; }
  pending++;
  queue = queue.then(async () => {
    let message;
    try { message = JSON.parse(line.toString('utf8')); } catch { send(rpcError(null, -32700, 'Parse error')); return; }
    const result = await dispatch(message); if (result) send(result);
  }).catch(() => send(rpcError(null, -32603, 'Internal error'))).finally(() => { pending--; });
}
process.stdin.on('data', chunk => {
  // Scan each newline frame without allowing a single huge chunk to inflate retained memory.
  let start = 0;
  while (start < chunk.length) {
    const newline = chunk.indexOf(10, start), end = newline < 0 ? chunk.length : newline;
    const segment = chunk.subarray(start, end);
    if (!discarding && buffer.length + segment.length > MAX_BYTES) { buffer = Buffer.alloc(0); discarding = true; send(rpcError(null, -32000, 'JSON-RPC message exceeds limit')); }
    if (!discarding) buffer = Buffer.concat([buffer, segment]);
    if (newline >= 0) { if (!discarding && buffer.length) schedule(buffer); buffer = Buffer.alloc(0); discarding = false; start = newline + 1; }
    else break;
  }
});
process.stdin.on('end', () => { if (buffer.length && !discarding) send(rpcError(null, -32700, 'NDJSON message requires a newline')); });
