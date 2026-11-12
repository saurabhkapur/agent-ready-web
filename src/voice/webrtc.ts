// WebRTC transport to the Azure realtime endpoint (GA protocol):
//   1. GET /api/token  -> ephemeral token + calls URL (API key stays on the server)
//   2. RTCPeerConnection with the mic track and a "realtime-channel" data channel
//   3. POST the SDP offer to /openai/v1/realtime/calls with Bearer <token>; set the answer
//   4. model audio plays through an autoplay <audio> element; events flow over the data channel

import { RealtimeSession, type ServerEvent } from "./realtimeSession";
import { voice } from "./voiceStore";

const DATA_CHANNEL = "realtime-channel";
/** RMS level above which remote audio counts as "assistant speaking". */
const SPEAKING_LEVEL = 0.015;
const QUIET_MS = 600;

interface TokenResponse {
  token: string;
  callsUrl: string;
  expiresAt?: number;
}

class VoiceConnection {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private meterTimer: number | null = null;
  private session: RealtimeSession | null = null;
  private stopping = false;
  readonly audio: HTMLAudioElement;

  constructor() {
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    this.audio.id = "assistant-audio";
    this.audio.setAttribute("playsinline", "");
    document.body.appendChild(this.audio);
  }

  get active() {
    return this.pc !== null;
  }

  async start() {
    if (this.pc) return;
    this.stopping = false;
    voice.setStatus("connecting", null);
    // A new conversation: don't show the last session's lines as if just said.
    voice.set({ captions: [] });
    // Created inside the click handler so autoplay/AudioContext are allowed.
    this.audioCtx = new AudioContext();
    void this.audio.play().catch(() => {});

    try {
      const [mic, token] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }),
        fetchToken(),
      ]);
      this.mic = mic;
      if (this.stopping) return this.cleanup();

      const pc = new RTCPeerConnection();
      this.pc = pc;

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        this.audio.srcObject = stream;
        this.startMeter(stream);
      };
      pc.onconnectionstatechange = () => {
        if (import.meta.env.DEV) console.debug("[webrtc] connection", pc.connectionState);
        if (pc.connectionState === "failed") this.stop("Connection to the voice service failed.");
      };

      for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

      const dc = pc.createDataChannel(DATA_CHANNEL);
      this.dc = dc;
      const session = new RealtimeSession((evt) => {
        if (dc.readyState === "open") dc.send(JSON.stringify(evt));
      }, {
        setOutputMuted: (m) => (this.audio.muted = m),
        setOutputDucked: (d) => (this.audio.volume = d ? 0.25 : 1),
        focusSpokenItem: (id) => voice.focusSpoken(id),
      });
      this.session = session;

      dc.onopen = () => {
        voice.setStatus("listening");
        session.start(); // pushes session.update with the current view
      };
      dc.onmessage = (e) => {
        try {
          session.handleServerEvent(JSON.parse(e.data) as ServerEvent);
        } catch (err) {
          console.error("[webrtc] bad server event", err, e.data);
        }
      };
      dc.onclose = () => {
        if (!this.stopping) this.stop("The voice session ended.");
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(token.callsUrl, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/sdp" },
      });
      if (!res.ok) throw new Error(`Realtime calls endpoint returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const answer = await res.text();
      if (this.stopping || !this.pc) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err) {
      const msg = describeError(err);
      console.error("[webrtc] start failed:", err);
      this.cleanup();
      voice.setStatus("error", msg);
    }
  }

  stop(error?: string) {
    this.stopping = true;
    this.cleanup();
    voice.set({ userSpeaking: false });
    voice.setStatus(error ? "error" : "idle", error ?? null);
  }

  private cleanup() {
    this.session?.stop();
    this.session = null;
    if (this.meterTimer !== null) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.dc?.close();
    this.dc = null;
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.pc = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.audio.srcObject = null;
    this.audio.muted = false;
    this.audio.volume = 1;
  }

  /** Measures the model's audio so "speaking" and first-audio latency reflect what the guest hears. */
  private startMeter(stream: MediaStream) {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let lastLoud = 0;
    let speaking = false;
    this.meterTimer = window.setInterval(() => {
      if (this.audio.muted) {
        speaking = false; // barge-in: whatever is still arriving isn't heard
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > SPEAKING_LEVEL) {
        lastLoud = now;
        if (!speaking) {
          speaking = true;
          this.session?.setAssistantSpeaking(true);
        }
      } else if (speaking && now - lastLoud > QUIET_MS) {
        speaking = false;
        this.session?.setAssistantSpeaking(false);
      }
    }, 20);
  }
}

async function fetchToken(): Promise<TokenResponse> {
  const res = await fetch("/api/token");
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.error ?? `Token service returned ${res.status}`);
  return body as TokenResponse;
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    return "Microphone access was blocked. Allow it in the browser to talk to the host.";
  }
  if (err instanceof DOMException && err.name === "NotFoundError") return "No microphone found.";
  if (err instanceof TypeError) return "Couldn't reach the voice service. Is the server running?";
  return (err as Error)?.message ?? String(err);
}

let connection: VoiceConnection | null = null;

export const voiceController = {
  toggle() {
    connection ??= new VoiceConnection();
    if (connection.active || voiceIsBusy()) connection.stop();
    else void connection.start();
  },
  stop() {
    connection?.stop();
  },
};

const voiceIsBusy = () => {
  const s = voice.get().status;
  return s === "connecting" || s === "listening" || s === "speaking";
};
