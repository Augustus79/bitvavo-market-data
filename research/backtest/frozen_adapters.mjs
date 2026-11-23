// Exact adapters for FULL historical snapshots, not reconstructed compact journals.
// Imports libraries only; never import Worker, collectors or generate-* entrypoints.
import { analyze } from '../../analysis-engine.js';
import { newState, processPaperState, STRICT_POLICY } from '../../paper-trader.js';
import { newAdaptiveState, processAdaptiveShadow } from '../../adaptive-shadow-lib.js';
import { EXIT_SHADOW_POLICIES } from '../../exit-shadow-lib.js';
import { ADAPTIVE_POLICY } from '../../adaptive-shadow-lib.js';
import fs from 'node:fs';
export { EXIT_SHADOW_POLICIES, ADAPTIVE_POLICY };
export function replayFullSnapshots(snapshots) {
  let strict=newState(STRICT_POLICY), adaptive=newAdaptiveState();
  const strictTrades=[], adaptiveTrades=[];
  let previous=-Infinity;
  for(const snapshot of snapshots) {
    const now=Date.parse(snapshot.collectedAt);
    if(!Number.isFinite(now)||now<=previous)throw new Error('Snapshots must be strictly chronological');
    previous=now;
    const signals=analyze(snapshot,new Date(now));
    const s=processPaperState(strict,signals,snapshot,STRICT_POLICY);strict=s.state;
    const a=processAdaptiveShadow(adaptive,strict.openPositions,signals,snapshot);adaptive=a.state;
    strictTrades.push(...s.closedTrades);adaptiveTrades.push(...a.closedTrades);
  }
  return {strict,adaptive,strictTrades,adaptiveTrades};
}
if(process.argv[1]?.endsWith('frozen_adapters.mjs')) {
  const snapshot=JSON.parse(fs.readFileSync(new URL('../../snapshot.json',import.meta.url),'utf8'));
  console.log(JSON.stringify({mode:'single-snapshot-smoke-only',...replayFullSnapshots([snapshot])}));
}
