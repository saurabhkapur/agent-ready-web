import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "../src/agent/store";
import { RealtimeSession, type ClientEvent } from "../src/voice/realtimeSession";
import { useVoiceStore } from "../src/voice/voiceStore";

const initialAgent = useAgentStore.getState();
const initialVoice = useVoiceStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

let sent: ClientEvent[];
let clock: number;
let muted: boolean[];
let ducked: boolean[];
let session: RealtimeSession;

beforeEach(() => {
  useAgentStore.setState(initialAgent, true);
  useVoiceStore.setState({ ...initialVoice, status: "listening" }, true);
  sent = [];
  muted = [];
  ducked = [];
  clock = 1000;
  session = new RealtimeSession((e) => sent.push(e), { now: () => clock, setOutputMuted: (m) => muted.push(m), setOutputDucked: (d) => ducked.push(d) });
  session.start();
});

const types = () => sent.map((e) => e.type);
const fnCall = (callId: string, name: string, args: object, responseId = "resp_1") => {
  session.handleServerEvent({ type: "response.output_item.added", response_id: responseId, item: { id: `item_${callId}`, type: "function_call", call_id: callId, name } });
  session.handleServerEvent({ type: "response.function_call_arguments.done", response_id: responseId, item_id: `item_${callId}`, call_id: callId, arguments: JSON.stringify(args) });
};

describe("RealtimeSession", () => {
  it("sends session.update on start with the current enum", () => {
    expect(types()).toEqual(["session.update"]);
    const upd = sent[0] as any;
    expect(upd.session.type).toBe("realtime");
    expect(upd.session.instructions).toContain("Screen: home");
    expect(useVoiceStore.getState().sentForNode).toBe("home");
  });

  it("executes a tool call immediately, returns output, then response.create after response.done", async () => {
    session.handleServerEvent({ type: "input_audio_buffer.speech_started" });
    session.handleServerEvent({ type: "input_audio_buffer.speech_stopped" });
    clock += 350;
    fnCall("call_1", "navigate", { pathId: "category.desserts" });
    expect(useAgentStore.getState().activeNodeId).toBe("category.desserts"); // UI moved before response.done
    await flush();
    const out = sent.find((e) => e.type === "conversation.item.create") as any;
    expect(out.item).toMatchObject({ type: "function_call_output", call_id: "call_1" });
    expect(out.item.output).toMatch(/Navigated to Desserts/);
    // stage 4: refreshed session sent with the desserts enum
    const upd = sent.filter((e) => e.type === "session.update").at(-1) as any;
    expect(upd.session.instructions).toContain("Screen: category.desserts");
    const navTool = upd.session.tools.find((t: any) => t.name === "navigate");
    expect(navTool.parameters.properties.pathId.enum).toContain("item.tiramisu");
    expect(types()).not.toContain("response.create");

    // The fallback path in response.done must not re-execute the same call.
    session.handleServerEvent({
      type: "response.done",
      response: { id: "resp_1", status: "completed", output: [{ type: "function_call", call_id: "call_1", name: "navigate", arguments: '{"pathId":"category.desserts"}' }] },
    });
    expect(types().filter((t) => t === "conversation.item.create")).toHaveLength(1);
    expect(types().at(-1)).toBe("response.create");

    const turn = useVoiceStore.getState().turns.at(-1)!;
    expect(turn.firstToolMs).toBe(350);
    expect(turn.firstToolName).toBe("navigate");
    clock += 300;
    session.setAssistantSpeaking(true);
    expect(useVoiceStore.getState().turns.at(-1)!.firstAudioMs).toBe(650);
    expect(useVoiceStore.getState().status).toBe("speaking");
  });

  it("handles calls only present in response.done", () => {
    session.handleServerEvent({
      type: "response.done",
      response: { id: "r2", status: "completed", output: [{ type: "function_call", call_id: "c2", name: "goBack", arguments: "{}" }] },
    });
    expect(types().slice(-2)).toEqual(["conversation.item.create", "response.create"]);
  });

  it("returns an error output for invalid calls", () => {
    fnCall("c3", "navigate", { pathId: "item.sushi" });
    const out = sent.find((e) => e.type === "conversation.item.create") as any;
    expect(out.item.output).toMatch(/^ERROR:/);
    expect(useVoiceStore.getState().tools.at(-1)!.ok).toBe(false);
  });

  it("6. barge-in ducks, mutes once the server cancels, and skips response.create", () => {
    session.setAssistantSpeaking(true);
    session.handleServerEvent({ type: "input_audio_buffer.speech_started" });
    expect(ducked).toEqual([true]);
    expect(muted).toEqual([]);
    fnCall("c4", "highlight", { itemIds: ["rasmalai"] }, "r4");
    session.handleServerEvent({ type: "response.done", response: { id: "r4", status: "cancelled", output: [] } });
    expect(muted).toEqual([true]);
    expect(useVoiceStore.getState().status).toBe("listening");
    expect(types()).not.toContain("response.create");
    session.handleServerEvent({ type: "response.created", response: { id: "r5" } });
    expect(muted).toEqual([true, false]);
    expect(ducked).toEqual([true, false]);
  });

  it("an echo that the server ignores only ducks, then restores volume", () => {
    session.setAssistantSpeaking(true);
    session.handleServerEvent({ type: "input_audio_buffer.speech_started" });
    session.handleServerEvent({ type: "input_audio_buffer.speech_stopped" });
    expect(ducked).toEqual([true, false]);
    expect(muted).toEqual([]);
    expect(useVoiceStore.getState().status).toBe("speaking");
  });

  it("builds captions for both sides", () => {
    session.handleServerEvent({ type: "input_audio_buffer.committed", item_id: "u1" });
    session.handleServerEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: "u1", delta: "show me " });
    session.handleServerEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "Show me desserts." });
    session.handleServerEvent({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Here are " });
    session.handleServerEvent({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "our desserts." });
    const caps = useVoiceStore.getState().captions;
    expect(caps.map((c) => [c.role, c.text])).toEqual([
      ["user", "Show me desserts."],
      ["assistant", "Here are our desserts."],
    ]);
  });

  it("does not resend an identical session.update", async () => {
    useAgentStore.getState().navigate("category.drinks");
    await flush();
    const n = types().filter((t) => t === "session.update").length;
    useAgentStore.getState().navigate("category.drinks"); // re-flash only
    await flush();
    expect(types().filter((t) => t === "session.update").length).toBe(n);
  });
});
