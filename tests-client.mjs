import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=process.env.DEMO_WORKER||fileURLToPath(new URL('./worker/index.js',import.meta.url));
const {handle}=await import(pathToFileURL(source));
const html=await(await handle(new Request('https://demo.test/'))).text();
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/setInterval\([\s\S]*$/,'');
function fixture(){
 function element(tag='div'){
  return {tagName:tag.toUpperCase(),value:'',disabled:false,hidden:false,textContent:'',style:{},children:[],listeners:{},classList:{contains:()=>false,toggle(){}},
   addEventListener(event,cb){this.listeners[event]=cb;},replaceChildren(...nodes){this.children=nodes;this.textContent='';},append(...nodes){this.children.push(...nodes);},setAttribute(){},click(){},
   querySelectorAll(selector){return this.children.flatMap(c=>[...(selector==='input'&&c.tagName==='INPUT'?[c]:[]),...(c.querySelectorAll?.(selector)||[])]);},
   checkValidity(){if(this.tagName!=='INPUT'||this.type!=='number')return true;const x=Number(this.value);if(!Number.isFinite(x))return false;if(this.min!==undefined&&x<Number(this.min))return false;if(this.max!==undefined&&x>Number(this.max))return false;const step=Number(this.step||1),base=Number(this.min||0);return Math.abs((x-base)/step-Math.round((x-base)/step))<1e-7;}
  };
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},blobs=[];
 const document={getElementById:get,createElement:element,createElementNS:(_,tag)=>element(tag),querySelectorAll:()=>[],documentElement:{},body:{classList:{contains:()=>false}}};
 const url={createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}};
 const context=vm.createContext({document,Intl,Date,Map,Number,Math,JSON,Blob,URL:url,setTimeout(){}});
 vm.runInContext(script,context);
 get('network').value='mainnet';get('margin').value='1000';get('leverage').value='3';get('shock').value='-5';get('direction').value='1';
 return {get,context,run:code=>vm.runInContext(code,context),blobs};
}
test('failed compare clears old successful snapshot and cannot rerender it',async()=>{
 const f=fixture();f.run("overviewData={network:'mainnet',markets:[{symbol:'BTC',price:100,metrics:{status:'available',realized_vol_daily_pct:10,max_drawdown_pct:-5},evidence:[]}]};request=async()=>{throw new Error('synthetic upstream outage')}");
 await f.run('compare()');assert.equal(f.run('overviewData'),null);
});
test('last wallet request wins when two same-network responses finish in reverse order',async()=>{
 const f=fixture(),pending=[];f.context.pending=pending;f.run('request=()=>new Promise(resolve=>pending.push(resolve))');
 const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
 f.get('address').value=a;const first=f.run('inspect()');f.get('address').value=b;const second=f.run('inspect()');
 const payload=address=>({network:'mainnet',address,balance_mon:'1.000000000000000000',transaction_count:'0',has_code:false,block_number:123,checked_at:new Date().toISOString(),evidence:[]});
 pending[1](payload(b));await second;pending[0](payload(a));await first;
 assert.equal(f.run('walletData.address'),b);assert.equal(f.get('walletRead').disabled,false);
});
test('exported edited portfolio position derives PnL and notional from current inputs',async()=>{
 const f=fixture();f.run("positions=[{symbol:'BTC',margin:1000,leverage:3,shock:-5,direction:1,pnl:-150,notional:3000}];portfolio()");
 const input=f.get('positions').children[0].children[2].children[0];input.value='10';input.listeners.input();
 f.get('export').listeners.click();assert.equal(f.blobs.length,1);const report=JSON.parse(await f.blobs[0].text());
 const p=report.hypothetical_positions[0];assert.equal(p.leverage,10);assert.equal(p.notional,10000);assert.equal(p.pnl,-500);
});
test('source receipts retain different RPC method and parameters even for identical raw digests',()=>{
 const f=fixture();f.run("walletData={evidence:[{url:'https://rpc.monad.xyz',sha256:'same-zero-digest',method:'eth_getBalance',params:['0x'+'1'.repeat(40),'0x1'],retrieved_at:new Date().toISOString()},{url:'https://rpc.monad.xyz',sha256:'same-zero-digest',method:'eth_getTransactionCount',params:['0x'+'1'.repeat(40),'0x1'],retrieved_at:new Date().toISOString()}]}");
 assert.equal(f.run('receipts().length'),2);
});
