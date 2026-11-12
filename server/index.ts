// Minimal token service. The Azure API key stays here; the browser only ever
// receives a short-lived ephemeral token from client_secrets.

import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSessionConfig } from "../src/agent/session";

try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"));
} catch {
  // No .env file: rely on the real environment.
}

const env = process.env;
const RESOURCE = env.AZURE_RESOURCE ?? "";
const DEPLOYMENT = env.AZURE_REALTIME_DEPLOYMENT ?? "";
const API_KEY = env.AZURE_OPENAI_API_KEY ?? "";
const VOICE = env.REALTIME_VOICE || "marin";
const TRANSCRIPTION_MODEL = env.REALTIME_TRANSCRIPTION_MODEL || "gpt-live-transcribe";
const TRANSCRIPTION_LANGUAGE = env.REALTIME_TRANSCRIPTION_LANGUAGE ?? "en";
const SILENCE_MS = Number(env.REALTIME_SILENCE_MS) || 400;
const VAD = env.REALTIME_VAD === "server" ? "server" : "semantic";
const NOISE_REDUCTION = (["far_field", "near_field", "none"] as const).find((v) => v === env.REALTIME_NOISE_REDUCTION) ?? "far_field";
const PORT = Number(env.PORT) || 3001;
// Override only for local testing against a mock; defaults to the resource endpoint.
const BASE_URL = (env.AZURE_ENDPOINT || `https://${RESOURCE}.openai.azure.com`).replace(/\/$/, "");

const CLIENT_SECRETS_URL = `${BASE_URL}/openai/v1/realtime/client_secrets`;
const CALLS_URL = `${BASE_URL}/openai/v1/realtime/calls`;

const app = express();
app.disable("x-powered-by");

function missingConfig(): string[] {
  const missing: string[] = [];
  if (!RESOURCE && !env.AZURE_ENDPOINT) missing.push("AZURE_RESOURCE");
  if (!DEPLOYMENT) missing.push("AZURE_REALTIME_DEPLOYMENT");
  if (!API_KEY) missing.push("AZURE_OPENAI_API_KEY");
  return missing;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: missingConfig().length === 0, missing: missingConfig(), deployment: DEPLOYMENT, voice: VOICE });
});

app.get("/api/token", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const missing = missingConfig();
  if (missing.length) {
    res.status(500).json({ error: `Server is missing configuration: ${missing.join(", ")}. See .env.example.` });
    return;
  }

  const session = buildSessionConfig({
    model: DEPLOYMENT,
    voice: VOICE,
    transcriptionModel: TRANSCRIPTION_MODEL,
    transcriptionLanguage: TRANSCRIPTION_LANGUAGE,
    silenceMs: SILENCE_MS,
    vad: VAD,
    noiseReduction: NOISE_REDUCTION,
  });

  const started = Date.now();
  try {
    const upstream = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { "api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      console.error(`[token] client_secrets ${upstream.status}: ${text}`);
      res.status(502).json({ error: `Azure client_secrets returned ${upstream.status}`, detail: safeJson(text) });
      return;
    }
    const data = JSON.parse(text) as { value?: string; expires_at?: number };
    if (!data.value) {
      console.error(`[token] client_secrets response had no "value": ${text}`);
      res.status(502).json({ error: "Azure client_secrets response had no token" });
      return;
    }
    console.log(`[token] issued ephemeral token in ${Date.now() - started} ms`);
    // Only the ephemeral token (plus the non-secret calls URL) goes to the browser.
    res.json({ token: data.value, expiresAt: data.expires_at, callsUrl: CALLS_URL });
  } catch (err) {
    console.error("[token] request failed:", err);
    res.status(502).json({ error: `Could not reach Azure: ${(err as Error).message}` });
  }
});

// Production: serve the built frontend from the same origin.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`[server] token service on http://localhost:${PORT}`);
  const missing = missingConfig();
  if (missing.length) console.warn(`[server] missing config: ${missing.join(", ")} (voice will not connect)`);
  else console.log(`[server] realtime deployment "${DEPLOYMENT}" at ${BASE_URL}, voice "${VOICE}"`);
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}
