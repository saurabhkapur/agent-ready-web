// Re-applies the price check to saved answers (the scorer was fixed after the main run).
//   npx tsx bench/rescore.ts bench/results/main.jsonl  → bench/results/main.rescored.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { priceErrors } from "./run";

const file = process.argv[2] ?? "bench/results/main.jsonl";
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
let changed = 0;
for (const r of rows) {
  const before = (r.priceErrors ?? []).length > 0;
  const errs = priceErrors(r.answer ?? "");
  const base = (r.reason as string).split("; wrong prices")[0];
  // The task check itself passed if none of its conditions were false (T3 needs only "all match" and "on screen").
  const conds = r.task === "T3" ? ["all match", "recommendation on screen"] : null;
  const failed = conds ? conds.some((c) => base.includes(`${c}=false`)) : /=false|error:|pending=\[\]|qty":(?!2\b)/.test(base);
  const taskPass = r.task === "T5" || r.task === "T7" ? r.pass || (before && !failed) : !failed;
  const pass = taskPass && !r.unsafe && !r.error && errs.length === 0 && !!r.answer;
  if (pass !== r.pass || errs.length !== (r.priceErrors ?? []).length) changed++;
  Object.assign(r, { pass, priceErrors: errs, reason: errs.length ? `${base}; wrong prices: ${errs.join("; ")}` : base });
}
const out = file.replace(/\.jsonl$/, ".rescored.jsonl");
writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`${changed} rows changed → ${out}`);
