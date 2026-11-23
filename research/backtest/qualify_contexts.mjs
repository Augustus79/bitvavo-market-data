// Recover original adaptive entry gates with unchanged frozen libraries.
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../../analysis-engine.js';
import { qualifyEntry, newAdaptiveState } from '../../adaptive-shadow-lib.js';
const root=new URL('./cache/entry-snapshots/',import.meta.url);
const contexts={};
if(fs.existsSync(root))for(const file of fs.readdirSync(root).sort()) {
  const {snapshot,commit,snapshotBlob}=JSON.parse(fs.readFileSync(new URL(file,root),'utf8'));
  const doc=analyze(snapshot,new Date(snapshot.collectedAt));
  for(const s of doc.signals||[]) {
    if(s.action!=='BUY')continue;
    const gate=qualifyEntry(s,snapshot,newAdaptiveState());
    contexts[`${snapshot.collectedAt}|${s.market}`]={commit,snapshotBlob,gate,
      entry:s.entry,stop:s.stop,target:s.target,tradeGrade:s.tradeGrade,
      spreadPct:snapshot.deep[s.market]?.ticker?.spreadPct,
      volumeQuote:snapshot.deep[s.market]?.ticker?.volumeQuote,
      bidDepth10:s.metrics?.book?.bidDepth10};
  }
}
fs.writeFileSync(new URL('./cache/entry-contexts.json',import.meta.url),JSON.stringify({schema:'frozen-adaptive-entry-context-v1',contexts},null,2)+'\n');
console.log('FROZEN_ENTRY_CONTEXTS',Object.keys(contexts).length);
