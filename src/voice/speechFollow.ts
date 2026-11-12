// Speech-following: while the host talks through several dishes, the screen
// moves to each one as it is *spoken*, not when its text arrives.
//
// The realtime model can't call tools mid-sentence, so this runs on the
// client from the assistant's streaming transcript. Transcript text arrives
// ahead of the audio, so each dish mention is timed from when the guest
// started hearing this response, at an estimated speaking rate.

import { MENU } from "../data/menu";

/** Roughly how fast the host voice speaks, in transcript characters per second. */
export const CHARS_PER_SECOND = 14;
/** Start moving a little before the name is said, so the card is there when it lands. */
const LEAD_MS = 350;
/** If no "audio started" signal arrives (back-to-back responses), assume playback began this soon after the text. */
const HEARD_FALLBACK_MS = 600;

const normalize = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** Ways a dish name shows up in the spoken transcript. */
const ALIASES: { itemId: string; alias: string }[] = MENU.flatMap((item) => {
  const names = new Set([item.name, item.name.split(",")[0]]);
  if (item.name === "Chicken 65") names.add("Chicken sixty five");
  if (item.name === "Lamb Rogan Josh") names.add("Rogan Josh");
  if (item.name === "Wild Mushroom Risotto") names.add("Mushroom Risotto");
  if (item.name === "Chocolate Lava Cake") names.add("Lava Cake");
  return [...names].map((n) => ({ itemId: item.id, alias: normalize(n) }));
})
  // Longest first, so "Chocolate Lava Cake" wins over "Lava Cake" at the same spot.
  .sort((a, b) => b.alias.length - a.alias.length);

export interface Mention {
  itemId: string;
  /** Character offset of the mention in the transcript. */
  at: number;
}

/** Dish mentions in order of appearance (overlapping shorter aliases dropped). */
export function findMentions(text: string): Mention[] {
  const norm = normalize(text);
  const found: { itemId: string; start: number; end: number }[] = [];
  for (const { itemId, alias } of ALIASES) {
    let from = 0;
    for (let i = norm.indexOf(alias, from); i !== -1; i = norm.indexOf(alias, from)) {
      from = i + 1;
      // Aliases are space-padded for word boundaries; the padding isn't part of the name.
      const start = i + 1;
      const end = i + alias.length - 1;
      if (!found.some((f) => start < f.end && end > f.start)) found.push({ itemId, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start).map((f) => ({ itemId: f.itemId, at: f.start }));
}

export interface FollowerDeps {
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  /** Bring this dish into view and mark it as the one being talked about. */
  focus(itemId: string): void;
}

/**
 * One instance per voice session. Feed it transcript text per assistant item
 * and the moment audio is first heard for each response.
 */
export class SpeechFollower {
  private items = new Map<string, { text: string; scanned: number }>();
  /** Characters of transcript already spoken in earlier items of this response. */
  private baseChars = 0;
  private heardAt: number | null = null;
  private pending: Mention[] = [];
  private timers: unknown[] = [];
  private last: string | null = null;

  constructor(private readonly deps: FollowerDeps) {}

  /** A new response started: forget the previous one's timing. */
  onResponseCreated() {
    this.cancelAll();
    this.items.clear();
    this.baseChars = 0;
    this.heardAt = null;
    this.last = null;
  }

  /** The guest started hearing this response's audio. */
  onAudioHeard() {
    if (this.heardAt !== null) return;
    this.heardAt = this.deps.now();
    const queued = this.pending;
    this.pending = [];
    queued.forEach((m) => this.schedule(m));
  }

  /** Full transcript so far for an assistant audio item. */
  onTranscript(itemId: string, text: string) {
    let entry = this.items.get(itemId);
    if (!entry) {
      // A later item in the same response starts after everything before it.
      for (const e of this.items.values()) this.baseChars += e.text.length;
      entry = { text: "", scanned: 0 };
      this.items.set(itemId, entry);
    }
    entry.text = text;
    // Rescan the whole item each delta: a name split across deltas only
    // matches once complete, and `scanned` keeps each mention to one schedule.
    for (const m of findMentions(text).filter((x) => x.at >= entry.scanned)) {
      entry.scanned = m.at + 1;
      const abs = { itemId: m.itemId, at: this.baseChars + m.at };
      if (this.heardAt !== null) {
        this.schedule(abs);
        continue;
      }
      if (!this.pending.length) this.timers.push(this.deps.schedule(() => this.onAudioHeard(), HEARD_FALLBACK_MS));
      this.pending.push(abs);
    }
  }

  /** Barge-in or session end: drop everything not yet shown. */
  cancelAll() {
    this.timers.forEach((t) => this.deps.cancel(t));
    this.timers = [];
    this.pending = [];
  }

  private schedule(m: Mention) {
    const due = this.heardAt! + (m.at / CHARS_PER_SECOND) * 1000 - LEAD_MS;
    const delay = Math.max(0, due - this.deps.now());
    this.timers.push(
      this.deps.schedule(() => {
        if (m.itemId === this.last) return;
        this.last = m.itemId;
        this.deps.focus(m.itemId);
      }, delay),
    );
  }
}
