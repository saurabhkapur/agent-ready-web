// Summarize a benchmark run.
//   npx tsx bench/summarize.ts bench/results/main.jsonl
// Prices (USD per 1M tokens) default to Azure Global Standard gpt-5.4; override with
// PRICE_INPUT / PRICE_CACHED / PRICE_OUTPUT.

import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "bench/results/main.jsonl";
const P_IN = Number(process.env.PRICE_INPUT ?? 2.5);
const P_CACHED = Number(process.env.PRICE_CACHED ?? 0.25);
const P_OUT = Number(process.env.PRICE_OUTPUT ?? 15);

interface Row {
  approach: string;
  task: string;
  pass: boolean;
  unsafe: boolean;
  calls: number;
  input: number;
  cached: number;
  output: number;
  wallMs: number;
  modelMs: number;
  hitCap: boolean;
  priceErrors?: string[];
  reason: string;
  error?: string;
}

const rows: Row[] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const costNoCache = (r: Row) => (r.input * P_IN + r.output * P_OUT) / 1e6;
const cost = (r: Row) => ((r.input - r.cached) * P_IN + r.cached * P_CACHED + r.output * P_OUT) / 1e6;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => `${Math.round((100 * n) / (d || 1))}%`;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

const NAMES: Record<string, string> = { a: "A. Semantic layer", a2: "A2. Semantic layer, fixed tool list", b: "B. Accessibility tree", c: "C. Computer use" };
const approaches = [...new Set(rows.map((r) => r.approach))].sort();
const tasks = [...new Set(rows.map((r) => r.task))].sort();

function stats(rs: Row[]) {
  return {
    n: rs.length,
    pass: rs.filter((r) => r.pass).length,
    unsafe: rs.filter((r) => r.unsafe).length,
    wrongPrice: rs.filter((r) => (r.priceErrors ?? []).length).length,
    capped: rs.filter((r) => r.hitCap).length,
    errors: rs.filter((r) => r.error).length,
    input: mean(rs.map((r) => r.input)),
    uncached: mean(rs.map((r) => r.input - r.cached)),
    output: mean(rs.map((r) => r.output)),
    calls: mean(rs.map((r) => r.calls)),
    wallMed: median(rs.map((r) => r.wallMs)),
    costMean: mean(rs.map(cost)),
    costNoCacheMean: mean(rs.map(costNoCache)),
    costTotal: rs.map(cost).reduce((a, b) => a + b, 0),
  };
}

const out: string[] = [];
out.push(`# Benchmark summary: ${file}`, "", `${rows.length} runs. Prices per 1M tokens: input $${P_IN}, cached $${P_CACHED}, output $${P_OUT}.`, "");
out.push("## By approach (means per task run unless noted)", "");
out.push("| Approach | Pass | Input tokens | Uncached input | Output tokens | Model calls | Median time (s) | Cost per 1,000 tasks ($) | Same, no caching ($) | Unsafe | Wrong prices | Hit step cap |");
out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
const base = stats(rows.filter((r) => r.approach === "a"));
for (const a of approaches) {
  const s = stats(rows.filter((r) => r.approach === a));
  out.push(
    `| ${NAMES[a] ?? a} | ${s.pass}/${s.n} (${pct(s.pass, s.n)}) | ${fmt(s.input)} | ${fmt(s.uncached)} | ${fmt(s.output)} | ${fmt(s.calls, 1)} | ${fmt(s.wallMed / 1000, 1)} | ${fmt(s.costMean * 1000, 2)} | ${fmt(s.costNoCacheMean * 1000, 2)} | ${s.unsafe} | ${s.wrongPrice} | ${s.capped} |`,
  );
}
out.push("");
for (const a of approaches.filter((x) => x !== "a")) {
  const s = stats(rows.filter((r) => r.approach === a));
  out.push(`- ${NAMES[a]} vs A: ${fmt(s.input / base.input, 1)}× input tokens, ${fmt(s.costMean / base.costMean, 1)}× cost (${fmt(s.costNoCacheMean / base.costNoCacheMean, 1)}× without caching), ${fmt(s.wallMed / base.wallMed, 1)}× median time.`);
}

out.push("", "## By task", "");
out.push("| Task | Approach | Pass | Mean input tokens | Mean calls | Median time (s) | Mean cost ($) |");
out.push("| --- | --- | --- | --- | --- | --- | --- |");
const csv = ["task,approach,pass_rate,mean_input_tokens,mean_uncached_input,mean_output_tokens,mean_calls,median_seconds,mean_cost_usd,mean_cost_no_cache_usd"];
for (const t of tasks)
  for (const a of approaches) {
    const s = stats(rows.filter((r) => r.task === t && r.approach === a));
    out.push(`| ${t} | ${a.toUpperCase()} | ${s.pass}/${s.n} | ${fmt(s.input)} | ${fmt(s.calls, 1)} | ${fmt(s.wallMed / 1000, 1)} | ${fmt(s.costMean, 4)} |`);
    csv.push([t, a, (s.pass / s.n).toFixed(2), s.input.toFixed(0), s.uncached.toFixed(0), s.output.toFixed(0), s.calls.toFixed(1), (s.wallMed / 1000).toFixed(2), s.costMean.toFixed(5), s.costNoCacheMean.toFixed(5)].join(","));
  }

out.push("", "## Failures", "");
for (const r of rows.filter((r) => !r.pass)) out.push(`- ${r.approach.toUpperCase()} ${r.task}: ${r.reason}${r.unsafe ? " (UNSAFE: cart changed)" : ""}`);

const md = out.join("\n");
writeFileSync(file.replace(/\.jsonl$/, ".summary.md"), md + "\n");
writeFileSync(file.replace(/\.jsonl$/, ".by-task.csv"), csv.join("\n") + "\n");
console.log(md);
