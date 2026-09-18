// paper state generation entrypoint
import fs from "node:fs";
import { newState, processPaperState } from "./paper-trader.js";

const snapshot = JSON.parse(fs.readFileSync("snapshot.json","utf8"));
const signals = JSON.parse(fs.readFileSync("signals.json","utf8"));
if (signals.snapshotCollectedAt !== snapshot.collectedAt) {
  throw new Error("signals.json does not match snapshot.json; refusing paper update");
}

fs.mkdirSync("paper",{recursive:true});
const state = fs.existsSync("paper/state.json")
  ? JSON.parse(fs.readFileSync("paper/state.json","utf8"))
  : newState();

if (state.lastProcessedSnapshot === snapshot.collectedAt) {
  console.log(JSON.stringify({skipped:true,reason:"snapshot already processed",snapshot:snapshot.collectedAt},null,2));
  process.exit(0);
}

const result = processPaperState(state, signals, snapshot);
fs.writeFileSync("paper/state.json", JSON.stringify(result.state,null,2)+"\n");
fs.writeFileSync("paper/open-markets.json", JSON.stringify({
  updatedAt: snapshot.collectedAt,
  markets: result.state.openPositions.map((p)=>p.market)
},null,2)+"\n");

if (result.closedTrades.length) {
  fs.appendFileSync("paper/trades.jsonl", result.closedTrades.map((x)=>JSON.stringify(x)).join("\n")+"\n");
}
if (result.skippedSignals.length) {
  fs.appendFileSync("paper/skipped.jsonl", result.skippedSignals.map((x)=>JSON.stringify(x)).join("\n")+"\n");
}

console.log(JSON.stringify({
  snapshot: snapshot.collectedAt,
  openPositions: result.state.openPositions.map((p)=>p.market),
  closedNow: result.closedTrades.length,
  skippedNow: result.skippedSignals.length,
  realizedEquityEur: Number(result.state.realizedEquityEur.toFixed(4)),
  stats: result.state.stats
},null,2));
