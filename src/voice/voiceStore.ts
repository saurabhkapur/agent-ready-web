import { create } from "zustand";

export type VoiceStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface Caption {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface ToolLogEntry {
  id: string;
  at: number;
  name: string;
  args: string;
  ok: boolean;
  output: string;
  ms: number;
}

export interface TurnLatency {
  id: number;
  /** performance.now() when the server reported end of user speech. */
  stoppedAt: number;
  firstToolMs?: number;
  firstToolName?: string;
  firstAudioMs?: number;
}

export interface EventLogEntry {
  at: number;
  dir: "in" | "out";
  type: string;
}

interface VoiceState {
  status: VoiceStatus;
  userSpeaking: boolean;
  error: string | null;
  captions: Caption[];
  tools: ToolLogEntry[];
  turns: TurnLatency[];
  events: EventLogEntry[];
  /** navigate enum in the most recent session config sent to the model. */
  sentNavigateEnum: string[];
  sentForNode: string | null;
  sessionUpdates: number;
  debugOpen: boolean;
  /** The dish the host is talking about right now (follow-along spotlight). */
  spokenItemId: string | null;
  /** Bumps on every focus, so the same dish can be re-shown. */
  spokenSeq: number;
}

export const useVoiceStore = create<VoiceState>()(() => ({
  status: "idle",
  userSpeaking: false,
  error: null,
  captions: [],
  tools: [],
  turns: [],
  events: [],
  sentNavigateEnum: [],
  sentForNode: null,
  sessionUpdates: 0,
  spokenItemId: null,
  spokenSeq: 0,
  debugOpen: typeof location !== "undefined" && new URLSearchParams(location.search).has("debug"),
}));

const MAX_CAPTIONS = 30;
const MAX_TOOLS = 50;
const MAX_TURNS = 20;
const MAX_EVENTS = 200;

export const voice = {
  set: useVoiceStore.setState,
  get: useVoiceStore.getState,

  /** Pass `error` to set or clear it; omit to leave it unchanged. */
  setStatus(status: VoiceStatus, error?: string | null) {
    useVoiceStore.setState(error === undefined ? { status } : { status, error });
  },

  /** Create or update a caption. `append` adds a delta; otherwise replaces the text. */
  caption(id: string, role: Caption["role"], text: string, opts: { append?: boolean; final?: boolean } = {}) {
    useVoiceStore.setState((s) => {
      const existing = s.captions.find((c) => c.id === id);
      if (!existing) {
        return { captions: [...s.captions, { id, role, text, final: !!opts.final }].slice(-MAX_CAPTIONS) };
      }
      const next = { ...existing, text: opts.append ? existing.text + text : text, final: opts.final ?? existing.final };
      return { captions: s.captions.map((c) => (c.id === id ? next : c)) };
    });
  },

  logTool(entry: ToolLogEntry) {
    useVoiceStore.setState((s) => ({ tools: [...s.tools, entry].slice(-MAX_TOOLS) }));
  },

  startTurn(id: number, stoppedAt: number) {
    useVoiceStore.setState((s) => ({ turns: [...s.turns, { id, stoppedAt }].slice(-MAX_TURNS) }));
  },

  patchTurn(id: number, patch: Partial<TurnLatency>) {
    useVoiceStore.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },

  logEvent(dir: EventLogEntry["dir"], type: string) {
    useVoiceStore.setState((s) => ({ events: [...s.events, { at: Date.now(), dir, type }].slice(-MAX_EVENTS) }));
  },

  focusSpoken(itemId: string | null) {
    useVoiceStore.setState((s) => (itemId ? { spokenItemId: itemId, spokenSeq: s.spokenSeq + 1 } : { spokenItemId: null }));
  },

  reset() {
    useVoiceStore.setState({ status: "idle", userSpeaking: false, error: null, spokenItemId: null });
  },
};
