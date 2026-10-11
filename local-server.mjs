import http from 'node:http';
import worker from './worker/index.js';
const port=Number(process.env.PORT||8794);
http.createServer(async(req,res)=>{try{const options={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method)){options.body=req;options.duplex='half';}const response=await worker.fetch(new Request('http://localhost:'+port+req.url,options),{PREFLIGHT_RECEIPT_SECRET:process.env.PREFLIGHT_RECEIPT_SECRET});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end('Local server failure');}}).listen(port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+port));
