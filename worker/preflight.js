// Frozen public-data simulation. This module never signs or submits a transaction.
export const PREFLIGHT_VERSION = 'preflight-1.0';
const PF_CHAIN_IDS = {mainnet:143,testnet:10143};
const PF_MAX_AGE = 30000;
const PF_MAX_SKEW = 15000;
function pfAssert(ok,message){if(!ok)throw new Error(message);}
function exactKeys(value,keys){pfAssert(value&&typeof value==='object'&&!Array.isArray(value),'Expected an object');pfAssert(Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Unexpected or missing fields');}
function pfNumber(value,min,max,name){pfAssert(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max,'Invalid '+name);return value;}
function decimalFraction(value){const [mantissa,exponent='0']=String(value).toLowerCase().split('e'),[whole,part='']=mantissa.split('.');let n=BigInt(whole+part),d=10n**BigInt(part.length),exp=Number(exponent);if(exp>=0)n*=10n**BigInt(exp);else d*=10n**BigInt(-exp);return {n,d};}
function pfCents(value,name){pfNumber(value,0,100000000,name);const {n,d}=decimalFraction(value);pfAssert(n*100n%d===0n,'Use at most two USD decimals');return n*100n/d;}
function addFraction(a,b){return {n:a.n*b.d+b.n*a.d,d:a.d*b.d};}
function serializeFraction(a){return {numerator:String(a.n),denominator:String(a.d)};}
function fractionLTE(a,value){const b=decimalFraction(value);return BigInt(a.numerator)*b.d<=b.n*BigInt(a.denominator);}
export function validateIntent(input){
  exactKeys(input,['network','market_id','intent','policy']);
  pfAssert(Object.hasOwn(PF_CHAIN_IDS,input.network),'Unknown network');pfAssert(Number.isSafeInteger(input.market_id)&&input.market_id>0&&input.market_id<=99999999,'Invalid market ID');
  exactKeys(input.intent,['side','notional_usd','hold_hours','adverse_move_pct']);pfAssert(['buy','sell'].includes(input.intent.side),'Side must be buy or sell');
  pfAssert(pfCents(input.intent.notional_usd,'notional')>0n,'Notional must be positive');pfNumber(input.intent.hold_hours,0,168,'hold hours');pfNumber(input.intent.adverse_move_pct,0,100,'adverse move');
  exactKeys(input.policy,['max_notional_usd','max_slippage_bps','max_total_cost_usd','max_stress_loss_usd']);
  for(const k of ['max_notional_usd','max_total_cost_usd','max_stress_loss_usd'])pfCents(input.policy[k],k);
  pfNumber(input.policy.max_slippage_bps,0,10000,'slippage budget');return input;
}
export function canonicalJSON(value){
  // Match JSON transport semantics: omit undefined object fields; array holes become null.
  if(value===undefined)return undefined;
  if(value===null)return 'null';
  if(typeof value!=='object'){pfAssert(['string','number','boolean'].includes(typeof value)&&!(typeof value==='number'&&!Number.isFinite(value)),'Unsupported canonical JSON value');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+Array.from(value,x=>x===undefined?'null':canonicalJSON(x)).join(',')+']';
  pfAssert(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null,'Canonical JSON requires plain objects');
  return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
}
export async function pfDigest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJSON(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function pfInteger(value,name){pfAssert((typeof value==='number'&&Number.isSafeInteger(value))||(typeof value==='string'&&/^\d{1,30}$/.test(value)),'Unsafe scaled '+name);const n=BigInt(value);pfAssert(n>0n,'Nonpositive '+name);return n;}
function point(at,now,maxAge,name,future=0){pfAssert(Number.isSafeInteger(at?.b)&&at.b>0&&Number.isSafeInteger(at?.t)&&at.t>0,'Missing '+name+' block/time');pfAssert(at.t<=now+future,'Future '+name+' snapshot');pfAssert(now-at.t<=maxAge,'Stale '+name+' snapshot');return at;}
export function prepareSnapshot(raw,input,now){
  pfAssert(raw?.context?.chain?.chain_id===PF_CHAIN_IDS[input.network],'Network mismatch');
  const m=raw.context.markets?.find(x=>x.id===input.market_id);pfAssert(m,'Unknown market on this network');
  const c=m.config;pfAssert(c?.is_open===true,'Market is not open');
  for(const k of ['price_decimals','size_decimals'])pfAssert(Number.isInteger(c[k])&&c[k]>=0&&c[k]<=18,'Invalid '+k);
  pfAssert(Number.isSafeInteger(c.taker_fee)&&c.taker_fee>=0&&c.taker_fee<=1000000,'Missing or invalid base-tier fee');
  pfAssert(!c.taker_fees||c.taker_fees[0]===c.taker_fee,'Conflicting base-tier fee');
  pfAssert(Number.isInteger(m.funding_interval_sec)&&m.funding_interval_sec>0&&m.funding_interval_sec<=86400,'Invalid funding interval');
  pfAssert(Number.isSafeInteger(m.funding?.rate)&&Math.abs(m.funding.rate)<=1000000,'Missing funding rate');
  // Funding at is the application time, not publication time: documented advance <1 min.
  point(m.funding.at,now,m.funding_interval_sec*1000+60000,'funding',60000);
  point(c.at,now,365*86400000,'configuration');
  const book=raw.book,ticker=raw.ticker?.d?.[String(input.market_id)];
  const bt=point(book?.at,now,PF_MAX_AGE,'book'),tt=point(ticker?.at,now,PF_MAX_AGE,'ticker');
  pfAssert(Number.isSafeInteger(book.sn)&&book.sn===bt.b,'Book sequence does not match block');
  pfAssert(Number.isSafeInteger(raw.ticker.sn)&&raw.ticker.sn>=tt.b,'Invalid ticker sequence');
  pfAssert(Math.abs(bt.t-tt.t)<=PF_MAX_SKEW,'Book and ticker times diverge');
  const bids=book.bid,asks=book.ask;
  for(const [name,levels,asc]of [['bids',bids,false],['asks',asks,true]]){
    pfAssert(Array.isArray(levels)&&levels.length>0&&levels.length<=100,'Empty or excessive '+name);
    let previous=null;for(const level of levels){const p=pfInteger(level.p,'price'),s=pfInteger(level.s,'size');pfAssert(s<=10n**30n,'Size exceeds bound');pfAssert(previous===null||(asc?p>previous:p<previous),'Unsorted or duplicate '+name);previous=p;}
  }
  const bid=pfInteger(bids[0].p,'best bid'),ask=pfInteger(asks[0].p,'best ask');pfAssert(bid<ask,'Crossed or locked book');
  const tb=pfInteger(ticker.bid,'ticker bid'),ta=pfInteger(ticker.ask,'ticker ask');pfAssert(tb<ta,'Crossed ticker');
  // Independent sequential snapshots may differ, but reject gross inconsistency.
  pfAssert(Math.abs(Number(tb+ta)/Number(bid+ask)-1)<=0.01,'Book and ticker reference differ by over 1%');
  const scale=10n**BigInt(c.price_decimals+c.size_decimals),midNumerator=bid+ask;
  const reference=Number(midNumerator)/2/10**c.price_decimals;
  pfAssert(Number.isFinite(reference)&&reference>0,'Invalid reference');
  return {market:m,bids,asks,bid,ask,scale,midNumerator,reference,expires:Math.min(bt.t,tt.t)+PF_MAX_AGE};
}
export function simulateIntent(input,snapshot,notional=input.intent.notional_usd){
  const {market:m,scale,midNumerator,reference}=snapshot,usdCents=pfCents(notional,'notional');
  // Target base quantity is floor(reference-notional / book midpoint) in native lots.
  const target=usdCents*2n*scale/(100n*midNumerator),side=input.intent.side;
  let remaining=target,filled=0n,quote=0n,levels=[];
  for(const level of(side==='buy'?snapshot.asks:snapshot.bids)){
    if(remaining===0n)break;const p=pfInteger(level.p,'price'),available=pfInteger(level.s,'size'),take=available<remaining?available:remaining;
    filled+=take;remaining-=take;quote+=p*take;
    levels.push({price:Number(p)/10**m.config.price_decimals,base_quantity:Number(take)/10**m.config.size_decimals,quantity_lots:String(take),quote_usd:Number(p*take)/Number(scale)});
  }
  const full=target>0n&&remaining===0n,actual=Number(quote)/Number(scale),quantity=Number(filled)/10**m.config.size_decimals;
  const vwap=filled>0n?Number(quote)/Number(filled)/10**m.config.price_decimals:null;
  const direction=side==='buy'?1:-1,slippage=vwap===null?null:Math.max(0,Number((2n*quote-midNumerator*filled)*BigInt(direction))/Number(midNumerator*filled)*10000);
  const worst=levels.length?Math.max(0,Number((pfInteger((side==='buy'?snapshot.asks:snapshot.bids)[levels.length-1].p,'price')*2n-midNumerator)*BigInt(direction))/Number(midNumerator)*10000):null;
  const referenceExposure=quantity*reference,entryImpact=vwap===null?null:Math.max(0,Number((2n*quote-midNumerator*filled)*BigInt(direction))/Number(2n*scale));
  const fee=actual*m.config.taker_fee/1000000,funding=actual*m.funding.rate/1000000*(input.intent.hold_hours*3600/m.funding_interval_sec)*direction;
  const total=entryImpact===null?null:entryImpact+fee+Math.max(0,funding),stress=total===null?null:actual*input.intent.adverse_move_pct/100+total;
  const hold=decimalFraction(input.intent.hold_hours),shock=decimalFraction(input.intent.adverse_move_pct);
  const impactNumerator=(2n*quote-midNumerator*filled)*BigInt(direction);
  const impactFraction={n:impactNumerator>0n?impactNumerator:0n,d:2n*scale};
  const feeFraction={n:quote*BigInt(m.config.taker_fee),d:scale*1000000n};
  const fundingFraction={n:quote*BigInt(m.funding.rate)*hold.n*3600n*BigInt(direction),d:scale*1000000n*hold.d*BigInt(m.funding_interval_sec)};
  const costFraction=addFraction(addFraction(impactFraction,feeFraction),{n:fundingFraction.n>0n?fundingFraction.n:0n,d:fundingFraction.d});
  const stressFraction=addFraction(costFraction,{n:quote*shock.n,d:scale*shock.d*100n});
  const worstPrice=levels.length?pfInteger((side==='buy'?snapshot.asks:snapshot.bids)[levels.length-1].p,'price'):null;
  const worstFraction=worstPrice===null?null:{n:(2n*worstPrice-midNumerator)*BigInt(direction)*10000n,d:midNumerator};
  const exact={executed_notional_usd:serializeFraction({n:quote,d:scale}),conservative_total_cost_usd:serializeFraction(costFraction),stress_loss_usd:serializeFraction(stressFraction),worst_slippage_bps:worstFraction?serializeFraction(worstFraction):null};
  return {exact,requested_reference_notional_usd:notional,target_quantity_lots:String(target),filled_quantity_lots:String(filled),unfilled_quantity_lots:String(remaining),full_fill:full,base_quantity:quantity,executed_notional_usd:actual,reference_price_usd:reference,vwap_usd:vwap,spread_bps:Number(snapshot.ask-snapshot.bid)/Number(midNumerator)*20000,average_slippage_bps:slippage,worst_slippage_bps:worst,entry_price_impact_usd:entryImpact,taker_fee_rate:m.config.taker_fee/1000000,taker_fee_usd:fee,funding_rate_per_interval:m.funding.rate/1000000,funding_interval_sec:m.funding_interval_sec,funding_estimate_usd:funding,conservative_total_cost_usd:total,stress_loss_usd:stress,levels};
}
export function policyChecks(input,sim){
  const p=input.policy,rule=(id,label,actual,limit,pass)=>({id,label,actual,limit,pass});
  return [rule('DEPTH','Complete native-lot fill',sim.full_fill,true,sim.full_fill),rule('SIZE','Executed exposure within budget',sim.executed_notional_usd,p.max_notional_usd,fractionLTE(sim.exact.executed_notional_usd,p.max_notional_usd)),rule('SLIPPAGE','Worst fill versus midpoint',sim.worst_slippage_bps,p.max_slippage_bps,sim.worst_slippage_bps!==null&&fractionLTE(sim.exact.worst_slippage_bps,p.max_slippage_bps)),rule('COST','Entry impact + fee + positive funding',sim.conservative_total_cost_usd,p.max_total_cost_usd,sim.conservative_total_cost_usd!==null&&fractionLTE(sim.exact.conservative_total_cost_usd,p.max_total_cost_usd)),rule('STRESS','Adverse move + conservative costs',sim.stress_loss_usd,p.max_stress_loss_usd,sim.stress_loss_usd!==null&&fractionLTE(sim.exact.stress_loss_usd,p.max_stress_loss_usd))];
}
export function evaluateFrozen(input,raw,now){
  validateIntent(input);const snapshot=prepareSnapshot(raw,input,now),simulation=simulateIntent(input,snapshot),checks=policyChecks(input,simulation),passed=checks.every(x=>x.pass);
  let suggestion=null;
  if(!passed){const denominator=2n*snapshot.scale,minCents=(snapshot.midNumerator*100n+denominator-1n)/denominator;let lo=minCents,hi=pfCents(input.intent.notional_usd,'notional');if(lo<=hi&&policyChecks(input,simulateIntent(input,snapshot,Number(lo)/100)).every(x=>x.pass)){for(let i=0;i<40&&lo<hi;i++){const mid=(lo+hi+1n)/2n,s=simulateIntent(input,snapshot,Number(mid)/100);if(policyChecks(input,s).every(x=>x.pass))lo=mid;else hi=mid-1n;}const notional=Number(lo)/100,s=simulateIntent(input,snapshot,notional);if(policyChecks(input,s).every(x=>x.pass))suggestion={notional_usd:notional,simulation:s,checks:policyChecks(input,s)};}}
  return {policy_version:PREFLIGHT_VERSION,decision:passed?'pass':suggestion?'revise':'reject',simulation,checks,suggestion,market_name:snapshot.market.name||snapshot.market.symbol,expires_at:new Date(snapshot.expires).toISOString(),snapshot_blocks:{book:raw.book.at.b,ticker:raw.ticker.d[String(input.market_id)].at.b,book_sequence:raw.book.sn,ticker_sequence:raw.ticker.sn,chain_id:PF_CHAIN_IDS[input.network]},safety_scope:'Passes configured snapshot policy only. Recheck fresh data before any transaction; no execution authorization.',assumptions:['Public book is at most 100 levels per side; no hidden liquidity or queue simulation.','Notional is reference-midpoint exposure; target base lots round down.','Base-tier taker fee; entry only; no account-tier authentication.','Constant latest funding rate prorated by hold time; funding receipts never reduce conservative costs.','Adverse percentage is a supplied stress assumption, not a forecast. Exit fees, gas, liquidation and account equity are excluded.']};
}
async function signPayload(payload,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonicalJSON(payload))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function makeReceipt(input,raw,evidence,now,secret){
  const payload={schema:'aisignal-preflight-receipt/1',evaluated_at:new Date(now).toISOString(),input,snapshots:raw,evidence,result:evaluateFrozen(input,raw,now)};
  return {...payload,sha256:await pfDigest(payload),authentication:secret?{type:'hmac-sha256',value:await signPayload(payload,secret)}:{type:'unsigned',value:null}};
}
export async function verifyReceipt(receipt,secret,now=Date.now()){
  exactKeys(receipt,['schema','evaluated_at','input','snapshots','evidence','result','sha256','authentication']);
  pfAssert(receipt.schema==='aisignal-preflight-receipt/1','Unknown receipt schema');pfAssert(/^[a-f0-9]{64}$/.test(receipt.sha256),'Invalid receipt digest');
  exactKeys(receipt.authentication,['type','value']);pfAssert(['unsigned','hmac-sha256'].includes(receipt.authentication.type),'Unknown authentication');
  const {sha256,authentication,...payload}=receipt,integrityValid=await pfDigest(payload)===sha256;
  let signatureValid=false;if(secret&&authentication.type==='hmac-sha256'&&/^[a-f0-9]{64}$/.test(authentication.value)){const expected=await signPayload(payload,secret);let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^authentication.value.charCodeAt(i);signatureValid=diff===0;}
  const evaluated=Date.parse(receipt.evaluated_at);pfAssert(Number.isFinite(evaluated)&&evaluated<=now,'Invalid evaluation time');
  let replayMatches=false,replayError=null;try{replayMatches=canonicalJSON(evaluateFrozen(receipt.input,receipt.snapshots,evaluated))===canonicalJSON(receipt.result);}catch(e){replayError=e.message;}
  const expiry=Date.parse(receipt.result?.expires_at),expired=!Number.isFinite(expiry)||now>=expiry;
  return {integrityValid,signatureValid,authentication:authentication.type,replayMatches,replayError,expired,current_action_authorized:false,meaning:signatureValid?'Server receipt authentication verified; frozen computation only.':'Digest integrity is not server authentication; a client can edit and rehash an unsigned receipt.'};
}
export async function boundedJSON(request,max=512*1024){
  pfAssert(request.headers.get('content-type')?.split(';')[0].trim()==='application/json','Content-Type must be application/json');
  const reader=request.body?.getReader();pfAssert(reader,'Missing JSON body');let bytes=0,chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max){await reader.cancel();throw new Error('JSON body exceeds limit');}chunks.push(value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const c of chunks){joined.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(joined));
}
export async function loadPreflight(input,load,now=Date.now(),secret){
  validateIntent(input);const c=await load('context',input.network,input.market_id),[book,ticker]=await Promise.all([load('book',input.network,input.market_id),load('ticker',input.network,input.market_id)]);
  // Evaluation time follows retrieval, avoiding accidental future snapshots during network latency.
  const evaluated=Math.max(now,Date.now());return makeReceipt(input,{context:c.data,book:book.data,ticker:ticker.data},[c.receipt,book.receipt,ticker.receipt],evaluated,secret);
}
