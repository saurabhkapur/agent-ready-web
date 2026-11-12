// Benchmark: the same model and tasks, three ways of seeing and acting on the site.
//   A  semantic layer      – current-screen summary + typed tools (the framework)
//   B  accessibility tree  – Playwright ARIA snapshot + click/type by ref
//   C  computer use        – screenshots + Azure `computer` tool
//
// Usage:
//   npx tsx bench/run.ts --approaches a,b,c --tasks all --runs 10
// Writes one JSON line per run to bench/results/<stamp>.jsonl (see summarize.ts).

import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MENU, getItem, type MenuItem } from "../src/data/menu";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* rely on the environment */
}

const env = process.env;
const ENDPOINT = (env.AZURE_ENDPOINT || `https://${env.AZURE_RESOURCE}.openai.azure.com`).replace(/\/$/, "");
const RESPONSES_URL = `${ENDPOINT}/openai/v1/responses`;
const API_KEY = env.AZURE_OPENAI_API_KEY ?? "";
const MODEL = env.BENCH_MODEL || "gpt-5.4";
const APP_PORT = Number(env.BENCH_APP_PORT) || 5174;
const APP_URL = `http://localhost:${APP_PORT}/`;
export const W = 1440;
export const H = 900;
export const MAX_CALLS = 15;

// ---------- CLI ----------

const argv = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const APPROACHES = arg("approaches", "a,b,c").split(",") as Approach[];
const RUNS = Number(arg("runs", "1"));
const TASK_FILTER = arg("tasks", "all");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_DIR = path.join(ROOT, "bench", "results");
const OUT = path.join(OUT_DIR, `${arg("name", STAMP)}.jsonl`);

export type Approach = "a" | "a2" | "b" | "c";

// ---------- Responses API ----------

interface Usage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}
interface ResponseJson {
  id: string;
  output: any[];
  usage: Usage;
  error?: { message: string } | null;
}

export class Meter {
  calls = 0;
  input = 0;
  cached = 0;
  output = 0;
  reasoning = 0;
  modelMs = 0;
  retries = 0;
  /** Time spent waiting out rate limits; excluded from latency. */
  backoffMs = 0;
  actions: string[] = [];
  add(u: Usage, ms: number) {
    this.calls++;
    this.input += u.input_tokens ?? 0;
    this.cached += u.input_tokens_details?.cached_tokens ?? 0;
    this.output += u.output_tokens ?? 0;
    this.reasoning += u.output_tokens_details?.reasoning_tokens ?? 0;
    this.modelMs += ms;
  }
}

async function respond(meter: Meter, body: Record<string, unknown>): Promise<ResponseJson> {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: { "api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, ...body }),
      signal: AbortSignal.timeout(120_000),
    });
    const ms = performance.now() - t0;
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      meter.retries++;
      const wait = Math.min(Number(res.headers.get("retry-after")) * 1000 || 2000 * 2 ** attempt, 60_000);
      meter.backoffMs += wait + ms;
      await sleep(wait);
      continue;
    }
    const json = (await res.json()) as ResponseJson;
    if (!res.ok || json.error) throw new Error(`Responses API ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
    meter.add(json.usage, ms);
    return json;
  }
}

const textOf = (r: ResponseJson) =>
  r.output
    .filter((o) => o.type === "message")
    .flatMap((o) => (o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text))
    .join("\n")
    .trim();

// ---------- Tasks ----------

export interface AppState {
  active: string;
  filters: Record<string, unknown>;
  highlighted: string[];
  cart: { itemId: string; qty: number }[];
  /** Lines on the add-to-order confirmation sheet (empty when it is closed). */
  pending: { itemId: string; qty: number }[];
  visible: string[];
  dessertsHeadingVisible: boolean;
}

export interface Task {
  id: string;
  prompt: string;
  setup?: string[]; // path ids to navigate to (as if tapped) before the task
  check: (s: AppState, answer: string) => { pass: boolean; reason: string };
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

/** Prices quoted right after a dish name that don't match the menu (×1..20 allowed, for quantities). */
export function priceErrors(answer: string): string[] {
  const a = norm(answer);
  const errs: string[] = [];
  for (const i of MENU) {
    for (const n of new Set([i.name, i.name.split(",")[0], i.name.replace(/^Wild /, "")].map(norm))) {
      let at = a.indexOf(n);
      while (at >= 0) {
        // The first price within 40 characters after the name, read in full (not cut at the window).
        const rest = a.slice(at + n.length);
        const m = rest.match(/(?:₹|\brs\.?\s?|\binr\s?)\s?(\d[\d,]*)/);
        const between = m && m.index! <= 40 ? rest.slice(0, m.index) : null;
        const otherDish = between !== null && MENU.some((o) => o.id !== i.id && between.includes(norm(o.name.split(",")[0])));
        // "under ₹400" is the guest's budget, not this dish's price.
        const budget = between !== null && /(under|below|less than|within|up to|budget)\s*$/.test(between);
        if (between !== null && !otherDish && !budget) {
          const v = Number(m![1].replace(/,/g, ""));
          if (!Array.from({ length: 20 }, (_, q) => i.price * (q + 1)).includes(v)) errs.push(`${i.name} quoted ₹${v}, menu ₹${i.price}`);
        }
        at = a.indexOf(n, at + n.length);
      }
    }
  }
  return [...new Set(errs)];
}
function dishesNamed(answer: string): MenuItem[] {
  const a = norm(answer);
  return MENU.filter((i) => {
    const names = [i.name, i.name.split(",")[0], i.name.replace(/^Wild /, "")].map(norm);
    return names.some((n) => a.includes(n));
  });
}
const onlyPending = (s: AppState, itemId: string, qty: number) =>
  s.pending.length === 1 && s.pending[0].itemId === itemId && s.pending[0].qty === qty && s.cart.length === 0;
const isCalmVeg = (i: MenuItem) => i.veg && i.spiceLevel === 0 && i.price <= 400;

export const TASKS: Task[] = [
  {
    id: "T1",
    prompt: "Show me desserts",
    check: (s) => {
      const dessertsOnScreen = s.visible.filter((id) => getItem(id)?.category === "desserts").length;
      const pass = s.dessertsHeadingVisible || dessertsOnScreen >= 2;
      return { pass, reason: `desserts heading visible=${s.dessertsHeadingVisible}, dessert cards visible=${dessertsOnScreen}` };
    },
  },
  {
    id: "T2",
    prompt: "Tell me about the paneer tikka",
    setup: ["category.desserts"],
    check: (s, ans) => {
      const shown = s.active === "item.paneer-tikka" || s.visible.includes("paneer-tikka");
      const facts = ans.includes("349") && /dairy/i.test(ans);
      return { pass: shown && facts, reason: `paneer tikka on screen=${shown}, mentions 349 and dairy=${facts}` };
    },
  },
  {
    id: "T3",
    prompt: "Something vegetarian, not spicy, under 400",
    check: (s, ans) => {
      const named = dishesNamed(ans);
      const ok = named.length > 0 && named.every(isCalmVeg);
      const f = s.filters as { veg?: boolean; maxSpice?: number; maxPrice?: number };
      const filtered = f.veg === true && f.maxSpice === 0 && (f.maxPrice ?? 1e9) <= 400;
      const shown = filtered || named.some((i) => s.visible.includes(i.id) || s.highlighted.includes(i.id));
      return {
        pass: ok && shown,
        reason: `named=[${named.map((i) => i.id)}], all match=${ok}, filters set=${filtered}, recommendation on screen=${shown}`,
      };
    },
  },
  {
    id: "T4",
    prompt: "Go back",
    setup: ["category.mains", "item.dal-makhani"],
    check: (s) => ({ pass: s.active === "category.mains", reason: `active=${s.active}` }),
  },
  {
    id: "T5",
    prompt: "Add two tiramisu",
    check: (s) => {
      const pass = onlyPending(s, "tiramisu", 2);
      return { pass, reason: `pending=${JSON.stringify(s.pending)}, cart=${JSON.stringify(s.cart)}` };
    },
  },
  {
    id: "T6",
    prompt: "Do you have sushi?",
    check: (s, ans) => {
      const says = /sushi/i.test(ans) && /(\bnot\b|n't|\bno\b|unavailable)/i.test(norm(ans));
      const alt = dishesNamed(ans).length > 0;
      return { pass: says && alt && s.cart.length === 0, reason: `says unavailable=${says}, suggests real dish=${alt}` };
    },
  },
  {
    id: "T7",
    prompt: "Find a vegetarian dessert under ₹250 and add two of the cheapest",
    check: (s) => {
      const pass = onlyPending(s, "gulab-jamun", 2);
      return { pass, reason: `pending=${JSON.stringify(s.pending)}, cart=${JSON.stringify(s.cart)}` };
    },
  },
];

// Passed as a string: tsx's name-keeping helper (__name) does not exist inside the page.
const READ_STATE = `(() => {
  const a = window.agent;
  const s = a.store.getState();
  const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 150;
  const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > headerH + 20 && r.top < innerHeight - 20; };
  const visible = [...document.querySelectorAll('[data-agent-path^="item."]')].filter(onScreen).map((el) => el.dataset.agentPath.slice(5));
  const h = document.querySelector('[data-agent-path="category.desserts"] h2');
  return {
    active: s.activeNodeId, filters: s.filters, highlighted: s.highlighted, cart: s.cart,
    pending: s.pendingAdd ? s.pendingAdd.lines : [],
    visible, dessertsHeadingVisible: !!h && onScreen(h),
  };
})()`;

export async function readState(page: Page): Promise<AppState> {
  return page.evaluate(READ_STATE) as Promise<AppState>;
}

// ---------- Agents ----------

const COMMON = `You are the host on the website of Saffron & Sage, a restaurant. A guest typed a request into the site's assistant box.
Operate the website so the screen shows what they asked for, then reply to the guest in 1-2 sentences.
- Prices are in Indian rupees. Only mention dishes, prices and allergens that are on this menu.
- If something is not on the menu, say so and suggest the closest dish that is.
- To add something to the order, open the "Add to order" confirmation with the right quantity and leave it open for the guest. Never press Confirm yourself and never claim it was added.
- Do not ask the guest for permission to act; just act, then reply.`;

interface AgentResult {
  answer: string;
  safetyChecks: number;
}

/** A: the semantic layer. Same instructions/tools the voice app sends, refreshed every step. */
/**
 * A2: same as A, but the navigate enum lists every path id and never changes, so the
 * prompt prefix (tools + instructions + menu) stays cacheable. Reachability is still
 * enforced by the executor, which returns a route hint for an unreachable id.
 */
const runA2 = (page: Page, task: Task, meter: Meter) => runA(page, task, meter, true);

async function runA(page: Page, task: Task, meter: Meter, staticTools = false): Promise<AgentResult> {
  let prev: string | undefined;
  let input: any[] = [{ role: "user", content: task.prompt }];
  while (meter.calls < MAX_CALLS) {
    const { instructions, tools } = await page.evaluate((fixed) => {
      const a = (window as any).agent;
      const ctx = a.viewContextOf(a.store.getState());
      const tools = a.buildTools(ctx.activeNodeId);
      if (fixed) tools[0].parameters.properties.pathId.enum = a.paths.map((p: any) => p.id);
      return { instructions: a.buildInstructions(ctx, "text"), tools };
    }, staticTools);
    const r = await respond(meter, { instructions, tools, input, previous_response_id: prev });
    prev = r.id;
    const calls = r.output.filter((o) => o.type === "function_call");
    if (!calls.length) return { answer: textOf(r), safetyChecks: 0 };
    input = [];
    for (const fc of calls) {
      meter.actions.push(`${fc.name}(${fc.arguments})`);
      const res = await page.evaluate(([n, a]) => (window as any).agent.executeTool(n, a), [fc.name, fc.arguments]);
      input.push({ type: "function_call_output", call_id: fc.call_id, output: res.output });
    }
  }
  return { answer: "", safetyChecks: 0 };
}

/** B: accessibility tree, the way Playwright MCP exposes a page. */
const B_TOOLS = [
  {
    type: "function",
    name: "click",
    description: "Click an element by its ref from the latest page snapshot.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "e.g. e12" }, element: { type: "string", description: "What you are clicking" } },
      required: ["ref", "element"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "type",
    description: "Type text into an input by ref.",
    parameters: {
      type: "object",
      properties: { ref: { type: "string" }, text: { type: "string" } },
      required: ["ref", "text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "press_key",
    description: "Press a keyboard key, e.g. Escape or Enter.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false },
  },
];

async function snapshot(page: Page): Promise<string> {
  return page.ariaSnapshot({ mode: "ai" });
}

async function runB(page: Page, task: Task, meter: Meter): Promise<AgentResult> {
  const instructions = `${COMMON}
You see the page as a Playwright accessibility snapshot. Elements carry refs like [ref=e12]. Act with the tools; each action returns a fresh snapshot.`;
  let prev: string | undefined;
  let input: any[] = [{ role: "user", content: `${task.prompt}\n\nCurrent page snapshot:\n${await snapshot(page)}` }];
  while (meter.calls < MAX_CALLS) {
    const r = await respond(meter, { instructions, tools: B_TOOLS, input, previous_response_id: prev });
    prev = r.id;
    const calls = r.output.filter((o) => o.type === "function_call");
    if (!calls.length) return { answer: textOf(r), safetyChecks: 0 };
    input = [];
    for (const fc of calls) {
      let result: string;
      meter.actions.push(`${fc.name}(${fc.arguments})`);
      try {
        const a = JSON.parse(fc.arguments || "{}");
        if (fc.name === "click") await page.getByRef(a.ref).click({ timeout: 4000 });
        else if (fc.name === "type") await page.getByRef(a.ref).fill(a.text, { timeout: 4000 });
        else if (fc.name === "press_key") await page.keyboard.press(a.key);
        else throw new Error(`unknown tool ${fc.name}`);
        await page.waitForTimeout(500);
        result = `Done. Page snapshot:\n${await snapshot(page)}`;
      } catch (e) {
        result = `ERROR: ${(e as Error).message.split("\n")[0]}\nPage snapshot:\n${await snapshot(page)}`;
      }
      input.push({ type: "function_call_output", call_id: fc.call_id, output: result });
    }
  }
  return { answer: "", safetyChecks: 0 };
}

/** C: computer use with screenshots. */
async function screenshot(page: Page) {
  // The demo HUD (bench/demo.ts) is for the video viewer only; the model never sees it.
  const buf = await page.screenshot({ type: "png", style: "[data-demo-hud]{display:none!important}" });
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const KEYS: Record<string, string> = {
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: " ",
  backspace: "Backspace", delete: "Delete", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  pagedown: "PageDown", pageup: "PageUp", home: "Home", end: "End", ctrl: "Control", control: "Control",
  shift: "Shift", alt: "Alt", cmd: "Meta", meta: "Meta",
};
const clampX = (x: number) => Math.max(0, Math.min(W - 1, x));
const clampY = (y: number) => Math.max(0, Math.min(H - 1, y));

async function doAction(page: Page, a: any) {
  switch (a.type) {
    case "click":
      if (a.button === "back") return page.goBack();
      return page.mouse.click(clampX(a.x), clampY(a.y), { button: a.button === "right" ? "right" : a.button === "middle" ? "middle" : "left" });
    case "double_click":
      return page.mouse.dblclick(clampX(a.x), clampY(a.y));
    case "move":
      return page.mouse.move(clampX(a.x), clampY(a.y));
    case "scroll":
      await page.mouse.move(clampX(a.x ?? W / 2), clampY(a.y ?? H / 2));
      return page.mouse.wheel(a.scroll_x ?? 0, a.scroll_y ?? 0);
    case "type":
      return page.keyboard.type(a.text ?? "", { delay: 10 });
    case "keypress": {
      const keys = (a.keys ?? []).map((k: string) => KEYS[k.toLowerCase()] ?? k);
      return page.keyboard.press(keys.join("+"));
    }
    case "drag": {
      const p = a.path ?? [];
      if (p.length < 2) return;
      await page.mouse.move(clampX(p[0].x), clampY(p[0].y));
      await page.mouse.down();
      for (const q of p.slice(1)) await page.mouse.move(clampX(q.x), clampY(q.y));
      return page.mouse.up();
    }
    case "wait":
      return sleep(Math.min(a.ms ?? 1000, 3000));
    case "screenshot":
      return;
  }
}

async function runC(page: Page, task: Task, meter: Meter): Promise<AgentResult> {
  const instructions = `${COMMON}
You see the browser through screenshots and control it with the computer tool. When the screen shows what the guest asked for, stop using the computer and reply to the guest.`;
  let prev: string | undefined;
  let safety = 0;
  let input: any[] = [
    {
      role: "user",
      content: [
        { type: "input_text", text: task.prompt },
        { type: "input_image", image_url: await screenshot(page), detail: "original" },
      ],
    },
  ];
  while (meter.calls < MAX_CALLS) {
    const r = await respond(meter, { instructions, tools: [{ type: "computer" }], input, previous_response_id: prev });
    prev = r.id;
    const calls = r.output.filter((o) => o.type === "computer_call");
    if (!calls.length) return { answer: textOf(r), safetyChecks: safety };
    input = [];
    for (const cc of calls) {
      const actions = cc.actions ?? (cc.action ? [cc.action] : []);
      for (const a of actions) {
        meter.actions.push(a.type === "click" ? `click(${a.x},${a.y})` : a.type === "type" ? `type(${JSON.stringify(a.text)})` : a.type === "scroll" ? `scroll(${a.scroll_y})` : a.type);
        try {
          await doAction(page, a);
        } catch {
          /* a failed action still gets a screenshot back */
        }
        await page.waitForTimeout(a.type === "click" ? 500 : 200);
      }
      const item: any = {
        type: "computer_call_output",
        call_id: cc.call_id,
        output: { type: "computer_screenshot", image_url: await screenshot(page), detail: "original" },
      };
      if (cc.pending_safety_checks?.length) {
        safety += cc.pending_safety_checks.length;
        item.acknowledged_safety_checks = cc.pending_safety_checks;
      }
      input.push(item);
    }
  }
  return { answer: "", safetyChecks: safety };
}

export const AGENTS: Record<Approach, (p: Page, t: Task, m: Meter) => Promise<AgentResult>> = { a: (p, t, m) => runA(p, t, m), a2: runA2, b: runB, c: runC };

// ---------- Runner ----------

export async function prepare(page: Page, task: Task) {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window as any).agent);
  for (const id of task.setup ?? []) {
    await page.evaluate((p) => (window as any).agent.store.getState().navigate(p, "touch"), id);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(300);
}

async function runOne(browser: Browser, approach: Approach, task: Task, run: number) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const meter = new Meter();
  let answer = "";
  let safetyChecks = 0;
  let error: string | undefined;
  try {
    await prepare(page, task);
    const t0 = performance.now();
    try {
      ({ answer, safetyChecks } = await AGENTS[approach](page, task, meter));
    } catch (e) {
      error = (e as Error).message;
    }
    const wallMs = performance.now() - t0 - meter.backoffMs;
    await page.waitForTimeout(300);
    const state = await readState(page);
    const verdict = error ? { pass: false, reason: `error: ${error}` } : task.check(state, answer);
    const wrongPrices = priceErrors(answer);
    if (wrongPrices.length) {
      verdict.pass = false;
      verdict.reason += `; wrong prices: ${wrongPrices.join("; ")}`;
    }
    if (!answer && !error) verdict.pass = false;
    const unsafe = state.cart.length > 0;
    const row = {
      model: MODEL, approach, task: task.id, run, pass: verdict.pass && !unsafe, reason: verdict.reason, unsafe,
      calls: meter.calls, input: meter.input, cached: meter.cached, output: meter.output, reasoning: meter.reasoning,
      wallMs: Math.round(wallMs), modelMs: Math.round(meter.modelMs), retries: meter.retries, safetyChecks,
      priceErrors: wrongPrices, actions: meter.actions,
      hitCap: meter.calls >= MAX_CALLS, answer, error, at: new Date().toISOString(),
    };
    appendFileSync(OUT, JSON.stringify(row) + "\n");
    if (!row.pass) await page.screenshot({ path: path.join(OUT_DIR, "fails", `${approach}-${task.id}-${run}.png`) }).catch(() => {});
    console.log(
      `${approach.toUpperCase()} ${task.id} #${run} ${row.pass ? "PASS" : "FAIL"} calls=${row.calls} in=${row.input} out=${row.output} ${row.wallMs}ms  ${row.pass ? "" : verdict.reason}`,
    );
  } finally {
    await ctx.close();
  }
}

export async function ensureApp(): Promise<ChildProcess | null> {
  if (await fetch(APP_URL).then((r) => r.ok).catch(() => false)) return null;
  const child = spawn("npx", ["vite", "--port", String(APP_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await fetch(APP_URL).then((r) => r.ok).catch(() => false)) return child;
  }
  child.kill();
  throw new Error(`App did not start on ${APP_URL}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!API_KEY) throw new Error("AZURE_OPENAI_API_KEY missing (.env)");
  mkdirSync(path.join(OUT_DIR, "fails"), { recursive: true });
  const tasks = TASK_FILTER === "all" ? TASKS : TASKS.filter((t) => TASK_FILTER.split(",").includes(t.id));
  const app = await ensureApp();
  const browser = await chromium.launch();
  console.log(`model=${MODEL} approaches=${APPROACHES} tasks=${tasks.map((t) => t.id)} runs=${RUNS} → ${path.relative(ROOT, OUT)}`);
  try {
    // Interleave approaches run by run so drift in service latency hits all three equally,
    // and run one at a time to stay under the deployment's tokens-per-minute limit.
    for (let run = 1; run <= RUNS; run++)
      for (const t of tasks) for (const ap of APPROACHES) await runOne(browser, ap, t, run);
  } finally {
    await browser.close();
    app?.kill();
  }
}

// Only run when executed directly, so other scripts can import the scoring helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
