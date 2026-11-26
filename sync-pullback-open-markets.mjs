import fs from "node:fs";
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const strict=read("paper/state.json"),shadow=read("pullback-shadow/open-markets.json");
const current=read("paper/open-markets.json");
const markets=[...new Set([...strict.openPositions.map(p=>p.market),...strict.pendingEntries.map(p=>p.market),...shadow.markets])];
fs.writeFileSync("paper/open-markets.json",JSON.stringify({...current,markets},null,2)+"\n");
