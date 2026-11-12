// Record the voice feature end to end, with sound.
//   npx tsx bench/voice-demo.ts      → bench/results/voice-demo/voice-demo.mp4
//
// The guest's lines are synthesized with macOS `say` and played into a fake
// microphone inside the page, so the realtime model hears them over WebRTC
// exactly as it would a real mic. Each line waits for the host's state (listening,
// speaking) the way a person would; one line deliberately cuts in while the host
// is talking to show barge-in. Guest and host audio are recorded together in the
// page and muxed onto the screen recording with ffmpeg.
// Needs macOS (`say`), ffmpeg, and the `.env` used by `npm run dev`.

import { chromium, type Page } from "playwright";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("bench/results/voice-demo");
const APP = "http://localhost:5173/?debug";
const W = 1440, H = 900;
const VOICE = process.env.DEMO_GUEST_VOICE ?? "Samantha";

const LINES = {
  desserts: "Show me the desserts.",
  gulab: "Tell me about the gulab jamun.",
  bargeIn: "Actually, I want a main course. Something vegetarian and not spicy, under four hundred rupees.",
  add: "Great, add two Penne Alfredo.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function synth(text: string): string {
  const f = path.join(OUT, `say-${Math.abs(hash(text))}.wav`);
  execFileSync("say", ["-v", VOICE, "-r", "175", "-o", f, "--data-format=LEI16@48000", text]);
  return readFileSync(f).toString("base64");
}
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

async function ensureDev(): Promise<ChildProcess | null> {
  const up = () => fetch("http://localhost:5173/api/health").then((r) => r.ok).catch(() => false);
  if (await up()) return null;
  const child = spawn("npm", ["run", "dev"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await up()) return child;
  }
  throw new Error("npm run dev did not come up on :5173");
}

// Injected before the app loads. getUserMedia returns a WebAudio stream we can
// speak into; a recorder captures that guest audio plus the host's remote track.
const FAKE_MIC = `(() => {
  let ctx, mic, mix, rec; const chunks = [];
  window.__demo = { startedAt: 0 };
  const setup = () => {
    if (ctx) return;
    ctx = new AudioContext({ sampleRate: 48000 });
    mic = ctx.createMediaStreamDestination();
    mix = ctx.createMediaStreamDestination();
    // A faint noise floor, like a real mic. Pure digital silence lets WebRTC stop
    // sending packets, and then the server never hears the guest stop talking.
    const noise = ctx.createBuffer(1, 48000 * 2, 48000);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.003;
    const ns = ctx.createBufferSource();
    ns.buffer = noise; ns.loop = true; ns.connect(mic); ns.start();
    rec = new MediaRecorder(mix.stream, { mimeType: "audio/webm;codecs=opus" });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.start(250);
    window.__demo.startedAt = Date.now();
  };
  navigator.mediaDevices.getUserMedia = async () => { setup(); return mic.stream; };
  const Base = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Base {
    constructor(...a) {
      super(...a);
      this.addEventListener("track", (e) => {
        if (e.track.kind !== "audio") return;
        setup();
        ctx.createMediaStreamSource(new MediaStream([e.track])).connect(mix);
      });
    }
  };
  window.__say = async (b64) => {
    setup();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(mic); src.connect(mix);
    await new Promise((r) => { src.onended = r; src.start(); });
  };
  window.__stop = () => new Promise((res) => {
    rec.onstop = async () => {
      const b = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      res(btoa(s));
    };
    rec.stop();
  });
})();`;

/** The dock button's visible state: "Listening", "Hearing you…", "Host speaking", "Connecting…". */
const dockState = (page: Page) => page.locator('button[aria-label="Stop voice"], button[aria-label="Start voice"]').innerText().catch(() => "");
async function waitFor(page: Page, re: RegExp, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (re.test(await dockState(page))) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for dock state ${re} (last: ${await dockState(page)})`);
}
const say = (page: Page, b64: string) => page.evaluate((b) => (window as any).__say(b), b64);

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const audio = Object.fromEntries(Object.entries(LINES).map(([k, v]) => [k, synth(v)])) as Record<keyof typeof LINES, string>;
  const dev = await ensureDev();
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await ctx.addInitScript(FAKE_MIC);
  const page = await ctx.newPage();
  const videoStart = Date.now();
  try {
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start voice" }).click();
    await waitFor(page, /listening/i, 45_000);
    const trimStart = Date.now() - 1500 - videoStart; // skip the connecting spinner
    await sleep(1500);

    await say(page, audio.desserts);
    await waitFor(page, /speaking/i);
    await waitFor(page, /listening/i);
    await sleep(1200);

    await say(page, audio.gulab);
    await waitFor(page, /speaking/i);
    await sleep(3000); // cut in mid-answer
    await say(page, audio.bargeIn);
    await waitFor(page, /speaking/i);
    await waitFor(page, /listening/i);
    await sleep(1200);

    await say(page, audio.add);
    await waitFor(page, /speaking/i);
    await waitFor(page, /listening/i);
    await sleep(2500);

    const startedAt = await page.evaluate(() => (window as any).__demo.startedAt as number);
    writeFileSync(path.join(OUT, "audio.webm"), Buffer.from((await page.evaluate("window.__stop()")) as string, "base64"));
    await ctx.close();
    const video = path.join(OUT, readdirSync(OUT).find((f) => f.endsWith(".webm") && f !== "audio.webm")!);
    // Audio t=0 is startedAt; video t=0 is videoStart. Align, then cut the intro.
    const offset = (startedAt - videoStart) / 1000;
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-i", video, "-itsoffset", String(offset), "-i", path.join(OUT, "audio.webm"),
      "-ss", String(trimStart / 1000),
      "-map", "0:v", "-map", "1:a", "-vf", "scale=1280:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", path.join(OUT, "voice-demo.mp4"),
    ]);
    console.log(`→ ${path.join(OUT, "voice-demo.mp4")}`);
  } finally {
    await browser.close();
    if (dev?.pid) process.kill(-dev.pid);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
