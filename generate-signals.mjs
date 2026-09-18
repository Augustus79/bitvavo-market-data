// deterministic signal generation entrypoint
import fs from "node:fs";
import { analyze } from "./analysis-engine.js";

const snapshot = JSON.parse(fs.readFileSync("snapshot.json", "utf8"));
const result = analyze(snapshot, new Date());
fs.writeFileSync("signals.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  engineVersion: result.engineVersion,
  snapshotCollectedAt: result.snapshotCollectedAt,
  snapshotFresh: result.snapshotFresh,
  actionable: result.actionable.map((x) => x.market)
}, null, 2));
