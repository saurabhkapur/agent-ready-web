// Scrolling for agent navigation. Everything that moves the page goes through
// here so the motion is consistent: offsets account for the sticky header and
// the voice dock, and nothing scrolls when the target is already in view.

const GAP = 12;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

/** The part of the viewport not covered by the sticky header or the voice dock. */
export function viewportBand() {
  const top = cssPx("--header-h");
  const bottom = window.innerHeight - cssPx("--dock-h");
  return { top, bottom: Math.max(bottom, top + 100) };
}

export type RevealMode =
  /** Align the element's top just under the header (sections). */
  | "start"
  /** Only scroll if the element (at its expanded height) isn't fully visible (dishes). */
  | "reveal"
  /** Centre the element in the visible band, unless it's already visible (highlights). */
  | "center";

export function revealElement(el: HTMLElement, mode: RevealMode, expectedHeight = el.offsetHeight) {
  const { top, bottom } = viewportBand();
  const rect = el.getBoundingClientRect();
  const height = Math.max(expectedHeight, rect.height);
  const fits = height <= bottom - top - 2 * GAP;
  const visible = rect.top >= top && rect.top + height <= bottom;

  let delta: number;
  if (mode === "start") {
    delta = rect.top - top - GAP;
  } else if (visible) {
    return;
  } else if (mode === "center" && fits) {
    delta = rect.top + height / 2 - (top + bottom) / 2;
  } else if (fits && rect.top >= top) {
    delta = rect.top + height - bottom + GAP; // nudge up just enough to show the bottom
  } else {
    delta = rect.top - top - GAP;
  }
  if (Math.abs(delta) < 2) return;
  window.scrollTo({ top: window.scrollY + delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

export function flash(el: HTMLElement) {
  el.classList.remove("agent-flash");
  void el.offsetWidth; // restart the CSS animation
  el.classList.add("agent-flash");
}

let lastUserScroll = 0;

/** Call on wheel/touch/keyboard scrolling, so automatic scrolling backs off. */
export function noteUserScroll() {
  lastUserScroll = performance.now();
}

/** True if the guest scrolled by hand recently; automatic follow-along shouldn't fight them. */
export function userScrolledRecently(ms = 2500) {
  return performance.now() - lastUserScroll < ms;
}
