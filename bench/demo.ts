// Record a side-by-side style demo video: the same typed request handled by the
// semantic layer (A) and by computer use (C), with a live token/cost HUD.
//   npx tsx bench/demo.ts            → bench/results/demo/demo.webm
//   npx tsx bench/demo.ts --task T3
// The HUD is hidden from C's screenshots and from the accessibility tree, so the
// model sees exactly what it sees in the benchmark.

import { chromium, type Page } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { AGENTS, ensureApp, H, Meter, prepare, TASKS, W, type Approach } from "./run";

const P_IN = 2.5, P_CACHED = 0.25, P_OUT = 15; // USD per 1M tokens, Azure Global Standard gpt-5.4
const OUT_DIR = path.resolve("bench/results/demo");
const taskId = process.argv.includes("--task") ? process.argv[process.argv.indexOf("--task") + 1] : "T7";
const task = TASKS.find((t) => t.id === taskId)!;

const LABEL: Partial<Record<Approach, [string, string]>> = {
  a: ["Semantic layer", "The site describes its screen and exposes typed tools"],
  c: ["Computer use", "The model sees screenshots and clicks pixels"],
};

const cost = (m: Meter) => ((m.input - m.cached) * P_IN + m.cached * P_CACHED + m.output * P_OUT) / 1e6;

async function card(page: Page, title: string, sub: string, ms: number) {
  await page.evaluate(
    ([t, s]) => {
      const el = document.createElement("div");
      el.setAttribute("data-demo-hud", "");
      el.setAttribute("aria-hidden", "true");
      el.id = "demo-card";
      el.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#141210;color:#f5efe6;font:600 56px/1.2 system-ui,sans-serif;text-align:center;gap:20px;padding:80px";
      el.innerHTML = `<div>${t}</div><div style="font:400 28px/1.4 system-ui,sans-serif;color:#cbbfae;max-width:1000px">${s}</div>`;
      document.body.appendChild(el);
    },
    [title, sub],
  );
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getElementById("demo-card")?.remove());
}

async function hud(page: Page, approach: Approach, prompt: string) {
  await page.evaluate(
    ([name, prompt]) => {
      const el = document.createElement("div");
      el.setAttribute("data-demo-hud", "");
      el.setAttribute("aria-hidden", "true");
      el.id = "demo-hud";
      el.style.cssText =
        "position:fixed;left:20px;bottom:20px;z-index:99998;width:400px;pointer-events:none;background:rgba(20,18,16,.92);color:#f5efe6;border-radius:14px;padding:16px 18px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)";
      el.innerHTML = `<div style="font-weight:700;font-size:16px;margin-bottom:8px">${name}</div>
        <div style="background:#fff;color:#222;border-radius:8px;padding:8px 10px;margin-bottom:10px">⌨️ ${prompt}</div>
        <div id="demo-stats" style="font-variant-numeric:tabular-nums"></div>
        <div id="demo-act" style="margin-top:6px;color:#cbbfae;font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>`;
      document.body.appendChild(el);
    },
    [`${LABEL[approach]![0]}`, prompt],
  );
}

async function updateHud(page: Page, m: Meter, t0: number, done = false) {
  const secs = ((performance.now() - t0 - m.backoffMs) / 1000).toFixed(1);
  const stats = `Model calls <b>${m.calls}</b> · Input tokens <b>${m.input.toLocaleString("en-US")}</b><br>Time <b>${secs} s</b> · Cost <b>$${cost(m).toFixed(4)}</b>${done ? " ✓" : ""}`;
  const act = m.actions.length ? `last action: ${m.actions[m.actions.length - 1]}` : "thinking…";
  await page
    .evaluate(
      ([s, a]) => {
        const st = document.getElementById("demo-stats");
        const ac = document.getElementById("demo-act");
        if (st) st.innerHTML = s;
        if (ac) ac.textContent = a;
      },
      [stats, act],
    )
    .catch(() => {});
}

async function segment(page: Page, approach: Approach) {
  const [title, sub] = LABEL[approach]!;
  await prepare(page, task);
  await card(page, title, sub, 2500);
  await hud(page, approach, task.prompt);
  const meter = new Meter();
  const t0 = performance.now();
  const timer = setInterval(() => void updateHud(page, meter, t0), 200);
  let answer = "";
  try {
    ({ answer } = await AGENTS[approach](page, task, meter));
  } finally {
    clearInterval(timer);
  }
  await updateHud(page, meter, t0, true);
  await page.evaluate((a) => {
    const el = document.getElementById("demo-act");
    if (el) { el.style.whiteSpace = "normal"; el.style.fontFamily = "system-ui,sans-serif"; el.style.fontSize = "13px"; el.textContent = `Reply: ${a}`; }
  }, answer);
  console.log(`${approach.toUpperCase()}: calls=${meter.calls} input=${meter.input} cost=$${cost(meter).toFixed(4)} actions=${meter.actions.join(" ")}`);
  await page.waitForTimeout(4000);
  return meter;
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const app = await ensureApp();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  try {
    await page.goto("about:blank");
    await page.setContent("<body style='margin:0;background:#141210'></body>");
    await card(page, "One request, two ways to operate a website", `“${task.prompt}”<br>gpt-5.4 on Azure OpenAI, same model and the same page`, 3500);
    const a = await segment(page, "a");
    const c = await segment(page, "c");
    await card(
      page,
      `Semantic layer: ${a.calls} calls, $${cost(a).toFixed(4)}<br>Computer use: ${c.calls} calls, $${cost(c).toFixed(4)}`,
      `This run: ${(c.input / a.input).toFixed(1)}× the input tokens for computer use.<br>Across 70 benchmark runs per approach: 70/70 vs 48/70 passed, $4.47 vs $20.56 per 1,000 tasks.`,
      6000,
    );
  } finally {
    await ctx.close();
    await browser.close();
    app?.kill();
  }
  const webm = readdirSync(OUT_DIR).find((f) => f.endsWith(".webm"))!;
  renameSync(path.join(OUT_DIR, webm), path.join(OUT_DIR, "demo.webm"));
  console.log(`→ ${path.join(OUT_DIR, "demo.webm")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
