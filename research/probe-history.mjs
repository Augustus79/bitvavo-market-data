const end=Date.UTC(2026,10,26);
const markets=["BTC-EUR","ETH-EUR","SOL-EUR","ADA-EUR","XRP-EUR"];
for(const market of markets)for(const months of [1,6,12,24]){
 const start=new Date(end);start.setUTCMonth(start.getUTCMonth()-months);
 const from=start.getTime(),to=from+999*300000;
 try{
 const url=new URL("https://api.bitvavo.com/v2/"+market+"/candles");
 for(const [k,v] of Object.entries({interval:"5m",limit:1000,start:from,end:to}))url.searchParams.set(k,String(v));
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)}),j=await r.json();
 if(!r.ok||!Array.isArray(j)){console.log(JSON.stringify({market,months,status:r.status,error:j}));continue;}
 const bars=j.map(x=>x.map(Number)).sort((a,b)=>a[0]-b[0]);
 const valid=bars.filter(x=>x.length>=6&&x.every(Number.isFinite)&&x[0]>=from&&x[0]<=to&&x[3]>0&&x[2]>=Math.max(x[1],x[4])&&x[3]<=Math.min(x[1],x[4])&&x[5]>=0);
 const unique=new Set(valid.map(x=>x[0]));
 console.log(JSON.stringify({market,months,status:r.status,count:bars.length,valid:valid.length,unique:unique.size,coverage:unique.size/1000,first:bars[0]?.[0],last:bars.at(-1)?.[0]}));
 }catch(e){console.log(JSON.stringify({market,months,error:String(e)}));}
 await new Promise(r=>setTimeout(r,250));
}
