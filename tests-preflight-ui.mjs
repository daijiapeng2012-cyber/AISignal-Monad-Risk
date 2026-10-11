import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PF_CLIENT} from './worker/preflight-ui.js';
function client(){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,hidden:false,textContent:'',dataset:{},children:[],listeners:{},style:{setProperty(){}},classList:{toggle(){}},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(...x){this.children=x;},append(...x){this.children.push(...x);},reportValidity:()=>true});return nodes.get(id);};
  const context=vm.createContext({$:get,t:(a)=>a,el:(_,text,cls)=>({textContent:text,className:cls,style:{setProperty(){}},append(){}}),money:x=>String(x),dt:x=>String(x),JSON,Date,Number,Math,Blob,URL,setTimeout(){},request:async()=>{throw new Error('Fixture data unavailable');}});
  vm.runInContext(PF_CLIENT.replace(/setInterval\(pfExpire[\s\S]*$/,''),context);
  for(const[k,v]of Object.entries({pfNetwork:'mainnet',pfMarket:'1',pfSide:'buy',pfNotional:'5000',pfHold:'8',pfShock:'3',pfMaxNotional:'10000',pfMaxSlip:'20',pfMaxCost:'12',pfMaxLoss:'300'}))get(k).value=v;
  return {get,context,run:s=>vm.runInContext(s,context)};
}
test('editing during a pending preflight restores button and stale completion never changes current UI',async()=>{
  const c=client(),pending=[];c.context.pending=pending;c.run('fetch=()=>new Promise(resolve=>pending.push(resolve))');const first=c.run('pfRun()');assert.equal(c.get('pfRun').disabled,true);c.get('pfNotional').value='1000';c.run('pfClear()');assert.equal(c.get('pfRun').disabled,false);assert.equal(c.run('pfLoading'),false);pending[0]({ok:true,json:async()=>({result:{decision:'pass'}})});await first;assert.equal(c.run('pfReceipt'),null);assert.equal(c.get('pfExport').disabled,true);
});
test('failed new preflight removes old pass revision costs and export',async()=>{
  const c=client();c.run("pfReceipt={result:{decision:'pass'}};fetch=async()=>({ok:false,json:async()=>({error:'Stale ticker snapshot'})})");await c.run('pfRun()');assert.equal(c.run('pfReceipt'),null);assert.equal(c.get('pfVerdict').dataset.decision,'unavailable');assert.equal(c.get('pfExport').disabled,true);assert.equal(c.get('pfRevision').hidden,true);assert.equal(c.get('pfCosts').children.length,0);assert.equal(c.get('pfRun').disabled,false);
});
test('expired historical pass is visibly marked as expired and requires recheck',()=>{
  const c=client();c.run("pfReceipt={result:{expires_at:new Date(Date.now()-1000).toISOString()}};pfExpire()");assert.match(c.get('pfState').textContent,/Expired/);assert.match(c.get('pfTitle').textContent,/Recheck/);assert.match(c.get('pfExpiry').textContent,/cannot be a current pass/);
});
test('receipt imports finishing in reverse order only show the current receipt digest and verification',async()=>{
  const c=client(),pending=[];c.context.pending=pending;c.run('fetch=()=>new Promise(resolve=>pending.push(resolve))');
  const file=digest=>({size:100,text:async()=>JSON.stringify({sha256:digest})});
  c.get('pfImport').files=[file('a'.repeat(64))];const first=c.run('pfVerifyFile()');await new Promise(resolve=>setImmediate(resolve));
  c.get('pfImport').files=[file('b'.repeat(64))];const second=c.run('pfVerifyFile()');await new Promise(resolve=>setImmediate(resolve));
  pending[1]({ok:true,json:async()=>({integrityValid:false,signatureValid:false,replayMatches:false,expired:false})});await second;
  pending[0]({ok:true,json:async()=>({integrityValid:true,signatureValid:true,replayMatches:true,expired:false})});await first;
  assert.equal(c.run('pfImported.signatureValid'),false);assert.equal(c.run('pfImported.receipt_sha256'),'b'.repeat(64));assert.match(c.get('pfVerify').textContent,/bbbbbbbbbbbb/);assert.doesNotMatch(c.get('pfVerify').textContent,/aaaaaaaaaaaa/);
});
test('clear or oversized imported file clears success and prevents old pending verification overwrite',async()=>{
  for(const replacement of [[],[{size:512*1024+1}]]){const c=client(),pending=[];c.context.pending=pending;c.run('fetch=()=>new Promise(resolve=>pending.push(resolve))');c.get('pfImport').files=[{size:100,text:async()=>JSON.stringify({sha256:'a'.repeat(64)})}];const first=c.run('pfVerifyFile()');await new Promise(resolve=>setImmediate(resolve));c.get('pfImport').files=replacement;await c.run('pfVerifyFile()');const current=c.get('pfVerify').textContent;pending[0]({ok:true,json:async()=>({integrityValid:true,signatureValid:true,replayMatches:true,expired:false})});await first;assert.equal(c.run('pfImported'),null);assert.equal(c.get('pfVerify').textContent,current);}
});
test('late parse or HTTP errors from replaced receipt do not replace current verification',async()=>{
  const c=client(),pending=[];c.context.pending=pending;c.run('fetch=()=>new Promise(resolve=>pending.push(resolve))');c.get('pfImport').files=[{size:100,text:async()=>JSON.stringify({sha256:'a'.repeat(64)})}];const first=c.run('pfVerifyFile()');await new Promise(resolve=>setImmediate(resolve));c.get('pfImport').files=[{size:100,text:async()=>JSON.stringify({sha256:'b'.repeat(64)})}];const second=c.run('pfVerifyFile()');await new Promise(resolve=>setImmediate(resolve));pending[1]({ok:true,json:async()=>({integrityValid:false,signatureValid:false,replayMatches:false,expired:true})});await second;const current=c.get('pfVerify').textContent;pending[0]({ok:false,json:async()=>({error:'Late old error'})});await first;assert.equal(c.get('pfVerify').textContent,current);assert.equal(c.run('pfImported.receipt_sha256'),'b'.repeat(64));
});
