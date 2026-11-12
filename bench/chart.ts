// Draw the four-panel comparison (cost, input tokens, model calls, median time) as an SVG.
//   npx tsx bench/chart.ts [bench/results/main.rescored.jsonl] → docs/media/comparison.svg

import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? "bench/results/main.rescored.jsonl";
const P_IN = 2.5, P_CACHED = 0.25, P_OUT = 15;
interface Row { approach: string; input: number; cached: number; output: number; calls: number; wallMs: number }
const rows: Row[] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const APPROACHES = [
  { id: "a", name: "Semantic layer", fill: "#2a78d6", ink: "#0b0b0b", weight: 600 },
  { id: "b", name: "Accessibility tree", fill: "#c8c7bd", ink: "#52514e", weight: 400 },
  { id: "c", name: "Computer use", fill: "#e2e1dc", ink: "#52514e", weight: 400 },
];
const METRICS = [
  { label: "Cost per 1,000 tasks", get: (rs: Row[]) => 1000 * mean(rs.map((r) => ((r.input - r.cached) * P_IN + r.cached * P_CACHED + r.output * P_OUT) / 1e6)), fmt: (v: number) => `$${v.toFixed(2)}` },
  { label: "Input tokens per task", get: (rs: Row[]) => mean(rs.map((r) => r.input)), fmt: (v: number) => Math.round(v).toLocaleString("en-US") },
  { label: "Model calls per task", get: (rs: Row[]) => mean(rs.map((r) => r.calls)), fmt: (v: number) => v.toFixed(1) },
  { label: "Median time per task", get: (rs: Row[]) => median(rs.map((r) => r.wallMs)) / 1000, fmt: (v: number) => `${v.toFixed(1)} s` },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const vals = METRICS.map((m) => APPROACHES.map((a) => m.get(rows.filter((r) => r.approach === a.id))));
const ratio = (mi: number, ai: number) => vals[mi][ai] / vals[mi][0];

const out: string[] = [];
const text = (x: number, y: number, s: string, o = "") => out.push(`<text x="${x}" y="${y}" ${o}>${esc(s)}</text>`);
text(16, 30, `Computer use costs ${ratio(0, 2).toFixed(1)}× the semantic layer and takes ${ratio(3, 2).toFixed(1)}× as long`, 'font-size="16" font-weight="600" fill="#0b0b0b"');
text(16, 52, `The accessibility tree reads ${ratio(1, 1).toFixed(1)}× the tokens. Per task, ${rows.length / 3} runs each, gpt-5.4 on Azure; lower is better.`, 'fill="#52514e"');
METRICS.forEach((m, mi) => {
  const px = (mi % 2) * 372 + 16, py = 100 + Math.floor(mi / 2) * 130, bx = px + 120, bw = 150;
  const max = Math.max(...vals[mi]);
  text(px, py, m.label, 'font-size="13" font-weight="600" fill="#0b0b0b"');
  out.push(`<line x1="${bx}" x2="${bx}" y1="${py + 10}" y2="${py + 92}" stroke="#b5b4ad"/>`);
  APPROACHES.forEach((a, ai) => {
    const y = py + 14 + ai * 26, v = vals[mi][ai], w = (v / max) * bw;
    text(bx - 8, y + 12, a.name, `text-anchor="end" fill="${a.ink}"`);
    out.push(`<rect x="${bx}" y="${y}" width="${w.toFixed(1)}" height="16" rx="2" fill="${a.fill}"><title>${esc(`${a.name}, ${m.label}: ${m.fmt(v)}`)}</title></rect>`);
    text(bx + w + 6, y + 12, ai ? `${m.fmt(v)} · ${ratio(mi, ai).toFixed(1)}×` : m.fmt(v), `fill="${a.ink}" font-weight="${a.weight}"`);
  });
});
text(16, 352, `Source: ${file}. Prices: Azure Global Standard gpt-5.4, $2.50 input / $0.25 cached / $15 output per 1M tokens.`, 'font-size="11" fill="#7a7974"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 368" width="760" height="368" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="12" role="img" aria-label="Comparison of cost, tokens, calls and time by approach">
<rect width="760" height="368" fill="#ffffff"/>
${out.join("\n")}
</svg>
`;
writeFileSync("docs/media/comparison.svg", svg);
console.log("→ docs/media/comparison.svg");
