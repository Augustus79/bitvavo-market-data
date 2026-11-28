import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const day=86400000,step=300000,split=Date.UTC(2026,4,26),start=Date.UTC(2024,10,26),end=Date.UTC(2026,10,26);
const files=new Map();
for(const d of fs.readdirSync('input'))for(const f of fs.readdirSync('input/'+d))if(f.endsWith('.jsonl.gz'))files.set(f,'input/'+d+'/'+f);
const data=new Map();
for(const [f,p] of files){const days=new Map();for(const line of gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')){const [t,o,h,l,c,v]=JSON.parse(line),d=Math.floor(t/day)*day;const q=days.get(d)??{o,c,n:0,volume:0,first:t,last:t};q.c=c;q.last=t;q.n++;q.volume+=v*c;days.set(d,q);}data.set(f.replace('.jsonl.gz',''),days);}
const btc=data.get('BTC-EUR');if(!btc)throw Error('BTC missing');
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
function feature(m,t){const d=data.get(m),a=[];for(let i=60;i>=1;i--){const q=d.get(t-i*day);if(!q||q.n<260||q.first!==t-i*day||q.last!==t-i*day+day-step)return null;a.push(q);}const c=a.at(-1).c;return {c,sma20:avg(a.slice(-20).map(q=>q.c)),sma60:avg(a.map(q=>q.c)),mom:c/a[39].c-1,vol:avg(a.slice(-20).map(q=>q.volume)),prev:a.at(-2).c};}
const report={note:'Exploratory daily portfolios; current universe selection bias; daily close signal, next day open execution, cash on missing entry; missing exit deferred and marked stale; no historical book; fixed proportional fees; independent reset at split; observed holdout not fresh validation.',results:[]};
for(const [period,from,to] of [['development',start+60*day,split],['holdout',split,end]])for(const cost of [0,.0015,.0025,.006,.01])for(const strategy of ['cash','btc-hold','rotation','trend','pullback'])for(const capital of [300,1000,3000,5000,10000]){
let cash=capital,positions=new Map(),peak=capital,dd=0,turnover=0,trades=0,stale=0,days=0,lastEquity=capital;
for(let t=from;t<to;t+=day){const b=feature('BTC-EUR',t),riskOn=b&&b.c>b.sma60;let targets=[];
if(strategy==='btc-hold')targets=['BTC-EUR'];
else if(strategy!=='cash'&&riskOn){const candidates=[...data.keys()].filter(m=>!['USDC-EUR','USDT-EUR'].includes(m)).map(m=>({m,f:feature(m,t)})).filter(x=>x.f&&x.f.vol>=250000&&x.f.c>x.f.sma60&&x.f.mom>0);
targets=candidates.filter(x=>strategy==='rotation'||strategy==='trend'&&x.f.c>x.f.sma20||strategy==='pullback'&&x.f.prev<x.f.sma20&&x.f.c>x.f.sma20).sort((a,b)=>b.f.mom-a.f.mom).slice(0,5).map(x=>x.m);}
if(strategy==='rotation'&&days%7!==0&&riskOn)targets=[...positions.keys()];
const quote=m=>{const q=data.get(m)?.get(t);return q&&q.first===t?q.o:null;};
for(const [m,p] of positions){const o=quote(m);if(!targets.includes(m)&&o){cash+=p.qty*o*(1-cost/2);turnover+=p.qty*o;positions.delete(m);trades++;}else if(!o)stale++;}
const equity=cash+[...positions].reduce((s,[m,p])=>s+p.qty*(quote(m)??p.mark),0);
for(const m of targets){if(positions.has(m))continue;const o=quote(m);if(!o)continue;const amount=Math.min(cash,equity/(strategy==='btc-hold'?1:5));if(amount<10)continue;const qty=amount/(o*(1+cost/2));cash-=amount;turnover+=qty*o;positions.set(m,{qty,mark:o});}
for(const [m,p] of positions){const q=data.get(m)?.get(t);if(q&&q.last===t+day-step)p.mark=q.c;else stale++;}
lastEquity=cash+[...positions.values()].reduce((s,p)=>s+p.qty*p.mark*(1-cost/2),0);peak=Math.max(peak,lastEquity);dd=Math.max(dd,1-lastEquity/peak);days++;
}
report.results.push({period,cost,strategy,capital,equity:lastEquity,returnPct:100*(lastEquity/capital-1),drawdownPct:100*dd,turnover,trades,stale,open:positions.size});}
fs.writeFileSync('swing-report-v3.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report.results.filter(x=>x.capital===10000),null,2));
