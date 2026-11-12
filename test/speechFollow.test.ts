import { beforeEach, describe, expect, it } from "vitest";
import { CHARS_PER_SECOND, SpeechFollower, findMentions } from "../src/voice/speechFollow";

let clock: number;
let timers: { at: number; fn: () => void; id: number }[];
let focused: { id: string; at: number }[];
let follower: SpeechFollower;
let nextId = 0;

const advance = (ms: number) => {
  const until = clock + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const t = timers[0];
    if (!t || t.at > until) break;
    timers.shift();
    clock = t.at;
    t.fn();
  }
  clock = until;
};

beforeEach(() => {
  clock = 0;
  timers = [];
  focused = [];
  follower = new SpeechFollower({
    now: () => clock,
    schedule: (fn, ms) => {
      const id = ++nextId;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    cancel: (id) => (timers = timers.filter((t) => t.id !== id)),
    focus: (id) => focused.push({ id, at: clock }),
  });
  follower.onResponseCreated();
});

describe("findMentions", () => {
  it("finds dishes in order, preferring the longest name", () => {
    const text = "Try the Chocolate Lava Cake, or for something Indian, Gulab Jamun. Chicken sixty-five is hot.";
    expect(findMentions(text).map((m) => m.itemId)).toEqual(["chocolate-lava-cake", "gulab-jamun", "chicken-65"]);
  });

  it("ignores partial names", () => {
    expect(findMentions("Paneer Tik")).toEqual([]);
  });
});

describe("SpeechFollower", () => {
  const recommendation = "I'd go with the Paneer Tikka to start, and then the Butter Chicken with some Dal Makhani.";

  it("focuses each dish when it is spoken, not when its text arrives", () => {
    follower.onTranscript("a1", recommendation); // the whole transcript lands at once
    expect(focused).toEqual([]);
    follower.onAudioHeard(); // playback starts at t=0
    advance(20_000);
    expect(focused.map((f) => f.id)).toEqual(["paneer-tikka", "butter-chicken", "dal-makhani"]);
    // Spread out over the sentence at roughly speaking pace.
    const butterAt = recommendation.indexOf("Butter");
    expect(focused[1].at).toBeGreaterThan(((butterAt - 10) / CHARS_PER_SECOND) * 1000 - 500);
    expect(focused[1].at).toBeLessThan(((butterAt + 10) / CHARS_PER_SECOND) * 1000);
  });

  it("handles names split across deltas without double-focusing", () => {
    follower.onAudioHeard();
    let text = "";
    for (const d of ["How about the Mango ", "Las", "si? Or a Masala", " Chai."]) {
      text += d;
      follower.onTranscript("a1", text);
    }
    advance(10_000);
    expect(focused.map((f) => f.id)).toEqual(["mango-lassi", "masala-chai"]);
  });

  it("drops pending focus on barge-in", () => {
    follower.onAudioHeard();
    follower.onTranscript("a1", recommendation);
    advance(500);
    follower.cancelAll();
    advance(20_000);
    expect(focused).toEqual([]); // "Paneer Tikka" hadn't been said yet at 500 ms
  });

  it("falls back to the text arrival time if playback start is never signalled", () => {
    follower.onTranscript("a1", "The Tiramisu is lovely.");
    advance(5_000);
    expect(focused.map((f) => f.id)).toEqual(["tiramisu"]);
  });
});
