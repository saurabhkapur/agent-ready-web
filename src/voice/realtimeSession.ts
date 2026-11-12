// Realtime protocol handling, independent of the transport. The WebRTC layer
// (webrtc.ts) feeds server events in and provides `send`; tests do the same
// with a fake.
//
// Responsibilities:
// - execute function calls as soon as their arguments are complete, return
//   function_call_output, and send response.create once the response is done
// - keep the model's view in sync via session.update whenever the UI changes
// - captions, barge-in, speaking state and latency metrics

import { buildSessionUpdate, navigateEnum } from "../agent/session";
import { useAgentStore, viewContextOf } from "../agent/store";
import { executeTool } from "../agent/tools";
import { SpeechFollower } from "./speechFollow";
import { voice } from "./voiceStore";

export type ServerEvent = { type: string; [k: string]: any };
export type ClientEvent = { type: string; [k: string]: unknown };

export interface SessionHooks {
  /** Silence local playback (barge-in confirmed by the server) or restore it. */
  setOutputMuted?(muted: boolean): void;
  /** Turn playback down while the server decides whether a sound is really the guest. */
  setOutputDucked?(ducked: boolean): void;
  /** The host has just started talking about this dish: bring it into view. */
  focusSpokenItem?(itemId: string | null): void;
  now?(): number;
}

const LOG_EVENTS = import.meta.env?.DEV && import.meta.env?.MODE !== "test";
/** Stop chaining tool-only responses after this many rounds without the guest speaking. */
const MAX_TOOL_ROUNDS = 5;

interface PendingCall {
  callId: string;
  name: string;
  args: string;
}

export class RealtimeSession {
  private handledCalls = new Set<string>();
  private responsesWithCalls = new Set<string>();
  private callNames = new Map<string, string>(); // call_id or item_id -> tool name
  private lastSessionJson = "";
  private updateQueued = false;
  private unsubscribe: (() => void) | null = null;
  private turn: { id: number; tool: boolean; audio: boolean; stoppedAt: number } | null = null;
  private turnSeq = 0;
  private toolRounds = 0;
  private muted = false;
  private ducked = false;
  private assistantSpeaking = false;
  private readonly now: () => number;
  private readonly follower: SpeechFollower;

  constructor(
    private readonly transportSend: (evt: ClientEvent) => void,
    private readonly hooks: SessionHooks = {},
  ) {
    this.now = hooks.now ?? (() => performance.now());
    this.follower = new SpeechFollower({
      now: this.now,
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      focus: (id) => hooks.focusSpokenItem?.(id),
    });
  }

  /** Call once the data channel is open. */
  start() {
    this.pushSessionUpdate();
    this.unsubscribe = useAgentStore.subscribe(() => this.scheduleSessionUpdate());
  }

  stop() {
    this.follower.cancelAll();
    this.hooks.focusSpokenItem?.(null);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  send(evt: ClientEvent) {
    if (LOG_EVENTS) console.debug("[realtime →]", evt.type, evt);
    voice.logEvent("out", evt.type);
    this.transportSend(evt);
  }

  // ---- session.update -------------------------------------------------------

  private scheduleSessionUpdate() {
    if (this.updateQueued) return;
    this.updateQueued = true;
    // Coalesce several store changes from one tool call into one update.
    queueMicrotask(() => {
      this.updateQueued = false;
      this.pushSessionUpdate();
    });
  }

  /** Send instructions + tools for the current view, if they changed. */
  pushSessionUpdate() {
    const ctx = viewContextOf(useAgentStore.getState());
    const update = buildSessionUpdate(ctx);
    const json = JSON.stringify(update);
    if (json === this.lastSessionJson) return;
    this.lastSessionJson = json;
    this.send(update);
    voice.set((s) => ({
      sentNavigateEnum: navigateEnum(ctx.activeNodeId),
      sentForNode: ctx.activeNodeId,
      sessionUpdates: s.sessionUpdates + 1,
    }));
  }

  // ---- server events --------------------------------------------------------

  handleServerEvent(evt: ServerEvent) {
    if (LOG_EVENTS) console.debug("[realtime ←]", evt.type, evt);
    voice.logEvent("in", evt.type);

    switch (evt.type) {
      case "input_audio_buffer.speech_started":
        voice.set({ userSpeaking: true });
        this.toolRounds = 0;
        // Possible barge-in. It may just be the host's own voice echoing back,
        // so only duck now; mute once the server confirms by cancelling.
        if (this.assistantSpeaking) this.setDucked(true);
        break;

      case "input_audio_buffer.speech_stopped":
        voice.set({ userSpeaking: false });
        this.hooks.focusSpokenItem?.(null); // the guest has the floor now
        if (!this.muted) this.setDucked(false);
        this.turn = { id: ++this.turnSeq, tool: false, audio: false, stoppedAt: this.now() };
        voice.startTurn(this.turn.id, this.turn.stoppedAt);
        break;

      case "input_audio_buffer.committed":
        if (evt.item_id) voice.caption(evt.item_id, "user", "", { final: false });
        break;

      case "conversation.item.input_audio_transcription.delta":
        voice.caption(evt.item_id, "user", evt.delta ?? "", { append: true });
        break;

      case "conversation.item.input_audio_transcription.completed":
        voice.caption(evt.item_id, "user", (evt.transcript ?? "").trim(), { final: true });
        break;

      case "conversation.item.input_audio_transcription.failed":
        voice.caption(evt.item_id, "user", "(couldn't transcribe)", { final: true });
        break;

      case "response.created":
        this.follower.onResponseCreated();
        this.setMuted(false);
        this.setDucked(false);
        break;

      case "response.output_item.added":
        if (evt.item?.type === "function_call") {
          this.callNames.set(evt.item.call_id, evt.item.name);
          this.callNames.set(evt.item.id, evt.item.name);
        }
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": // preview event name
        voice.caption(evt.item_id, "assistant", evt.delta ?? "", { append: true });
        this.follower.onTranscript(evt.item_id, voice.get().captions.find((c) => c.id === evt.item_id)?.text ?? "");
        break;

      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        if (typeof evt.transcript === "string") {
          voice.caption(evt.item_id, "assistant", evt.transcript, { final: true });
          this.follower.onTranscript(evt.item_id, evt.transcript);
        }
        break;

      case "response.function_call_arguments.done": {
        const name = evt.name ?? this.callNames.get(evt.call_id) ?? this.callNames.get(evt.item_id);
        if (evt.response_id) this.responsesWithCalls.add(evt.response_id);
        if (name) this.runCall({ callId: evt.call_id, name, args: evt.arguments ?? "" });
        break;
      }

      case "response.done":
        this.onResponseDone(evt.response ?? {});
        break;

      case "output_audio_buffer.started":
        this.follower.onAudioHeard();
        this.setAssistantSpeaking(true);
        break;

      case "output_audio_buffer.cleared": // the server cut playback for a barge-in
        if (this.ducked) this.setMuted(true);
        this.setAssistantSpeaking(false);
        break;

      case "output_audio_buffer.stopped":
        this.setAssistantSpeaking(false);
        break;

      case "error": {
        const msg = evt.error?.message ?? "Unknown realtime error";
        console.warn("[realtime] error event:", evt.error);
        voice.set({ error: msg });
        break;
      }
    }
  }

  private onResponseDone(response: any) {
    const output: any[] = Array.isArray(response.output) ? response.output : [];
    let hadCalls = this.responsesWithCalls.delete(response.id);

    // Fallback: function calls we never saw arguments.done for.
    for (const item of output) {
      if (item?.type !== "function_call") continue;
      hadCalls = true;
      this.runCall({ callId: item.call_id, name: item.name, args: item.arguments ?? "" });
    }

    if (response.status === "cancelled") {
      this.follower.cancelAll();
      if (this.ducked) this.setMuted(true); // barge-in confirmed: drop what's still in flight
      this.setAssistantSpeaking(false);
      for (const item of output) {
        if (item?.type === "message" && item.id) {
          const c = voice.get().captions.find((x) => x.id === item.id);
          if (c && !c.text.endsWith("…")) voice.caption(item.id, "assistant", `${c.text}…`, { final: true });
        }
      }
    }
    if (response.status === "failed") {
      const msg = response.status_details?.error?.message ?? "Response failed";
      voice.set({ error: msg });
    }

    // Tool outputs are in the conversation; ask the model to continue (speak
    // from the results). Skip if the guest barged in: VAD starts a new response.
    if (hadCalls && response.status !== "cancelled") {
      if (++this.toolRounds > MAX_TOOL_ROUNDS) {
        console.warn("[realtime] too many consecutive tool rounds; waiting for the guest");
        return;
      }
      this.send({ type: "response.create" });
    }
  }

  private runCall({ callId, name, args }: PendingCall) {
    if (!callId || this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);

    const t0 = this.now();
    const result = executeTool(name, args);
    const ms = this.now() - t0;

    if (this.turn && !this.turn.tool) {
      this.turn.tool = true;
      voice.patchTurn(this.turn.id, { firstToolMs: Math.round(t0 - this.turn.stoppedAt), firstToolName: name });
    }
    voice.logTool({ id: callId, at: Date.now(), name, args, ok: result.ok, output: result.output, ms });

    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: result.output },
    });
  }

  // ---- playback state -------------------------------------------------------

  /** From output_audio_buffer events or the transport's audio-level meter. */
  setAssistantSpeaking(speaking: boolean) {
    if (speaking && this.muted) return;
    if (speaking) this.follower.onAudioHeard();
    if (speaking && this.turn && !this.turn.audio) {
      this.turn.audio = true;
      voice.patchTurn(this.turn.id, { firstAudioMs: Math.round(this.now() - this.turn.stoppedAt) });
    }
    if (speaking === this.assistantSpeaking) return;
    this.assistantSpeaking = speaking;
    const status = voice.get().status;
    if (status === "listening" || status === "speaking") voice.setStatus(speaking ? "speaking" : "listening");
  }

  private setDucked(ducked: boolean) {
    if (ducked === this.ducked) return;
    this.ducked = ducked;
    this.hooks.setOutputDucked?.(ducked);
  }

  private setMuted(muted: boolean) {
    if (muted === this.muted) return;
    this.muted = muted;
    this.hooks.setOutputMuted?.(muted);
  }
}
