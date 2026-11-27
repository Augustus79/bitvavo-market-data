import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const step=300000, split=Date.UTC(2026,4,26), end=Date.UTC(2026,10,26);
const files=new Map();
for(const dir of fs.readdirSync('input'))for(const f of fs.readdirSync('input/'+dir))if(f.endsWith('.jsonl.gz')){const p='input/'+dir+'/'+f;if(files.has(f)&&!gunzipSync(fs.readFileSync(files.get(f))).equals(gunzipSync(fs.readFileSync(p))))throw Error('Conflicting duplicate '+f);files.set(f,p);}
const families=['pullback','breakout','mean-reversion','momentum','trend-following'];
const costs=[0.006,0.01,0.015];
const report={split,end,markets:[],assumptions:'Long spot, next contiguous candle open, fixed 1 ATR stop / 2 ATR target, stop first on ambiguous bars, max hold 48 bars, gaps censor trades, no capacity constraint across markets, one trade per market/family/cost, costs are round-trip proportional assumptions not historical spreads.',results:{}};
for(const [f,p] of files){
 const bars=gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
 let e20,e50,atr,prev,run=0,window=[],sumV=0,states=new Map(),gaps=0;
 const stats={};for(const family of families)for(const cost of costs)for(const period of ['development','holdout'])stats[family+'|'+cost+'|'+period]={n:0,wins:0,sumR:0,gains:0,losses:0,censored:0};
 for(const b of bars){
 const [t,o,h,l,c,v]=b;
 if(!b.every(Number.isFinite)||l<=0||h<Math.max(o,c)||l>Math.min(o,c)||v<0||t%step)throw Error('Invalid '+f);
 if(prev&&t<=prev[0])throw Error('Nonmonotonic '+f);
 const period=t<split?'development':'holdout';
 if(!prev||t-prev[0]!==step||prev[0]<split&&t>=split){if(prev&&t-prev[0]!==step)gaps++;for(const [k,s] of states)if(s.pos)stats[k+'|'+s.pos.period].censored++;states.clear();e20=e50=c;atr=h-l;run=0;window=[];sumV=0;prev=b;continue;}
 for(const family of families)for(const cost of costs){
 const k=family+'|'+cost,s=states.get(k)??{};states.set(k,s);
 if(s.pending&&!s.pos){const a=s.pending;s.pos={entry:o,stop:o-a,target:o+2*a,atr:a,period,age:0};s.pending=null;if(s.pos.stop<=0)s.pos=null;}
 if(s.pos){const q=s.pos;q.age++;const exit=o<=q.stop?o:l<=q.stop?q.stop:h>=q.target?q.target:q.age>=48?c:null;
 if(exit!==null){const net=(exit-q.entry)/q.entry-cost,r=net/(q.atr/q.entry+cost),z=stats[k+'|'+q.period];z.n++;z.wins+=Number(r>0);z.sumR+=r;z.gains+=Math.max(0,r);z.losses+=Math.max(0,-r);s.pos=null;}}
 }
 const old20=e20,old50=e50;
 const tr=Math.max(h-l,Math.abs(h-prev[4]),Math.abs(l-prev[4]));atr=(13*atr+tr)/14;e20+=(c-e20)*2/21;e50+=(c-e50)*2/51;
 const avg=window.length?sumV/window.length:0,vr=avg>0?v/avg:0,high=window.length?Math.max(...window.map(x=>x[2])):Infinity;
 if(run>=100&&atr>0&&t+step<end&&!(t<split&&t+step>=split)){
 const tests={pullback:e20>e50&&prev[4]<=old20&&c>e20&&vr>=1.25&&vr<=2.35&&(c-e20)/atr<=0.7,breakout:c>high&&vr>=1.3,momentum:e20>e50&&c>prev[4]&&vr>=1.2&&(c-e20)/atr<=1.5,'mean-reversion':prev[4]<old20-atr&&c>prev[4]&&c<e20,'trend-following':old20<=old50&&e20>e50};
 for(const family of families)for(const cost of costs){const s=states.get(family+'|'+cost);if(!s.pos&&tests[family]&&atr/c>=cost)s.pending=atr;}
 }
 window.push(b);sumV+=v;if(window.length>20)sumV-=window.shift()[5];run++;prev=b;
 }
 for(const [k,s] of states)if(s.pos)stats[k+'|'+s.pos.period].censored++;
 report.markets.push({market:f.replace('.jsonl.gz',''),bars:bars.length,gaps,stats});
}
for(const m of report.markets)for(const [k,s] of Object.entries(m.stats)){const z=report.results[k]??={n:0,wins:0,sumR:0,gains:0,losses:0,censored:0};for(const field of Object.keys(s))z[field]+=s[field];}
for(const z of Object.values(report.results)){z.meanR=z.n?z.sumR/z.n:null;z.profitFactor=z.losses?z.gains/z.losses:null;}
fs.writeFileSync('backtest-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({markets:report.markets.length,results:report.results},null,2));
