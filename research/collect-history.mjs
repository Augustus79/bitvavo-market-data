import fs from 'node:fs';
import {createGzip} from 'node:zlib';
import {once} from 'node:events';
const base='https://api.bitvavo.com/v2', step=300000, end=Date.UTC(2026,10,26), start=Date.UTC(2024,10,26);
async function get(path){for(let i=0;i<6;i++){try{const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});if(r.ok)return await r.json();if(r.status!==429&&r.status<500)throw Object.assign(Error('HTTP '+r.status),{fatal:true});}catch(e){if(e.fatal||i===5)throw e;}await new Promise(r=>setTimeout(r,2000*2**i));}throw Error('Retries exhausted');}
const tickers=await get('/ticker/24h');
const universe=tickers.filter(t=>t.market.endsWith('-EUR')&&Number.isFinite(Number(t.volumeQuote))).sort((a,b)=>Number(b.volumeQuote)-Number(a.volumeQuote)).slice(0,50).map(t=>t.market);
const shard=Number(process.env.SHARD??0), shards=5;
fs.mkdirSync('research-data',{recursive:true});
const report={start,end,universe,selection:'Current 24h EUR quote volume; survivorship and selection bias, not historical universe',shard,markets:[]};
for(const market of universe.filter((_,i)=>i%shards===shard)){
 const gz=createGzip();const out=fs.createWriteStream('research-data/'+market+'.jsonl.gz');gz.pipe(out);
 let count=0,missing=0,invalid=0,duplicates=0,failedWindows=0,first=null,last=null;
 for(let from=start;from<end;from+=999*step){
 const to=Math.min(end,from+999*step);
 try{const rows=await get('/'+market+'/candles?interval=5m&limit=1000&start='+from+'&end='+to);
 if(!Array.isArray(rows))throw Error('Non-array response');
 const seen=new Set();
 for(const x of rows.map(r=>r.map(Number)).sort((a,b)=>a[0]-b[0])){
 if(x[0]<from||x[0]>=to)continue;
 if(x.length!==6||!x.every(Number.isFinite)||x[0]%step!==0||x[3]<=0||x[2]<Math.max(x[1],x[4])||x[3]>Math.min(x[1],x[4])||x[5]<0){invalid++;continue;}
 if(seen.has(x[0])){duplicates++;continue;}seen.add(x[0]);count++;first??=x[0];last=x[0];
 if(!gz.write(JSON.stringify(x)+'\n'))await once(gz,'drain');
 }missing+=(to-from)/step-seen.size;
 }catch(e){failedWindows++;missing+=(to-from)/step;console.error(market,from,String(e));}
 await new Promise(r=>setTimeout(r,350));
 }
 gz.end();await once(out,'finish');
 const result={market,count,missing,invalid,duplicates,failedWindows,first,last,coverage:count/((end-start)/step)};report.markets.push(result);console.log(JSON.stringify(result));
 fs.writeFileSync('research-data/manifest.json',JSON.stringify(report,null,2));
}
if(report.markets.some(m=>m.failedWindows>0))process.exitCode=1;
