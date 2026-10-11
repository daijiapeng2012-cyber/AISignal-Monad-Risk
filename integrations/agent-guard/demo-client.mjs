#!/usr/bin/env node
// A real MCP client demonstration. This is not an AI model or an execution client.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
if (!args.length || args.some((value, index) => index % 2 === 0 && !['--policy', '--base-url'].includes(value))) {
  process.stderr.write('Usage: node demo-client.mjs --policy /absolute/policy.json [--base-url http://localhost:8794]\n'); process.exit(1);
}
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url)), ...args], { stdio: ['pipe', 'pipe', 'inherit'], env: {} });
let line = '', nextID = 1; const pending = new Map();
child.stdout.on('data', chunk => {
  line += chunk;
  let end; while ((end = line.indexOf('\n')) >= 0) {
    const message = JSON.parse(line.slice(0, end)); line = line.slice(end + 1);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  }
});
function request(method, params) {
  const id = nextID++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('MCP request timed out')); }, 30000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
  });
}
try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aisignal-judge-demo', version: '1.0.0' } });
  if (init.error) throw new Error(init.error.message);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await request('tools/list'); console.log(JSON.stringify({ event: 'tools_discovered', tools: list.result.tools.map(tool => tool.name) }));
  const intent = { network: 'mainnet', market_id: 1, intent: { side: 'buy', notional_usd: 1000, hold_hours: 4, adverse_move_pct: 5 } };
  for (const [scenario, proposal] of [['ordinary_intent', intent], ['oversized_intent', { ...intent, intent: { ...intent.intent, notional_usd: 20000 } }], ['attempted_policy_override', { ...intent, policy: { max_notional_usd: 100000000 } }]]) {
    const response = await request('tools/call', { name: 'propose_trade', arguments: proposal });
    if (response.error) throw new Error(response.error.message);
    const result = response.result.structuredContent || JSON.parse(response.result.content[0].text);
    console.log(JSON.stringify({ event: scenario, isError: response.result.isError, verified: result.verified, decision: result.guard_decision, policy_sha256: result.operator_policy_sha256, receipt_sha256: result.receipt_sha256, checks: result.receipt?.result?.checks, suggested_notional_usd: result.receipt?.result?.suggestion?.notional_usd, server_verification: result.server_verification, error: result.error, current_action_authorized: result.current_action_authorized }));
  }
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
finally { child.kill(); }
