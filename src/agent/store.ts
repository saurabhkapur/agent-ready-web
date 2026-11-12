// The agent store: one place that holds where the UI is and what it shows.
// Touch handlers and (from stage 3) the voice tool executor call the same
// actions, so both input paths behave identically.

import { create } from "zustand";
import { getItem } from "../data/menu";
import type { ViewContext } from "./describe";
import type { Filters } from "./filters";
import { BACK_ID, CART_ID, HOME_ID, getPath } from "./paths";

export interface CartLine {
  itemId: string;
  qty: number;
}

/** Dishes awaiting on-screen confirmation. Further requests join the same sheet. */
export interface PendingAdd {
  lines: CartLine[];
  source: "touch" | "voice";
}

export type NavigationSource = "touch" | "voice";

interface AgentState {
  activeNodeId: string;
  /** Previous nodes, most recent last. */
  history: string[];
  /** Bumps on every navigation, including re-navigation to the active node. */
  navSeq: number;
  /** "scroll" means the guest scrolled there by hand: the view follows, nothing scrolls. */
  lastNavSource: NavigationSource | "scroll";
  filters: Filters;
  /** Menu item ids (not path ids) currently highlighted. */
  highlighted: string[];
  /** Bumps when highlights are set, so the first one scrolls into view. */
  highlightSeq: number;
  cart: CartLine[];
  /** An add-to-cart awaiting on-screen confirmation. Nothing is added until confirmed. */
  pendingAdd: PendingAdd | null;

  navigate: (pathId: string, source?: NavigationSource) => void;
  goBack: (source?: NavigationSource) => void;
  /** The guest scrolled to this node by hand. Updates the view (and the model's context) without scrolling or touching history. */
  syncFromScroll: (pathId: string) => void;
  setFilters: (filters: Filters) => void;
  patchFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  setHighlighted: (itemIds: string[]) => void;
  /** Put dishes up for confirmation, joining any sheet already open (same dish: quantities add up). */
  requestAdd: (lines: CartLine[], source: PendingAdd["source"]) => void;
  /** Change one line on the open sheet; 0 removes it, and removing the last line closes the sheet. */
  setPendingQty: (itemId: string, qty: number) => void;
  confirmAdd: () => void;
  cancelAdd: () => void;
  setCartQty: (itemId: string, qty: number) => void;
}

const MAX_HISTORY = 50;

export const useAgentStore = create<AgentState>()((set, get) => ({
  activeNodeId: HOME_ID,
  history: [],
  navSeq: 0,
  lastNavSource: "touch",
  filters: {},
  highlighted: [],
  highlightSeq: 0,
  cart: [],
  pendingAdd: null,

  navigate: (pathId, source = "touch") => {
    const node = getPath(pathId);
    if (!node) {
      console.warn(`[agent] navigate: unknown path ${pathId}`);
      return;
    }
    if (node.id === BACK_ID) return get().goBack(source);

    const { activeNodeId, history, navSeq } = get();
    if (node.id === activeNodeId) {
      // Re-run the scroll/flash so the user sees the response.
      set({ navSeq: navSeq + 1, lastNavSource: source });
      return;
    }
    set({
      activeNodeId: node.id,
      history: [...history, activeNodeId].slice(-MAX_HISTORY),
      navSeq: navSeq + 1,
      lastNavSource: source,
    });
  },

  goBack: (source = "touch") => {
    const { history, navSeq } = get();
    const prev = history.at(-1) ?? HOME_ID;
    set({
      activeNodeId: prev,
      history: history.slice(0, -1),
      navSeq: navSeq + 1,
      lastNavSource: source,
    });
  },

  syncFromScroll: (pathId) => {
    if (!getPath(pathId) || pathId === get().activeNodeId) return;
    set({ activeNodeId: pathId, lastNavSource: "scroll" });
  },

  setFilters: (filters) => set({ filters }),
  patchFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  clearFilters: () => set({ filters: {}, highlighted: [] }),

  setHighlighted: (itemIds) =>
    set({ highlighted: itemIds.filter((id) => getItem(id)), highlightSeq: get().highlightSeq + 1 }),

  requestAdd: (lines, source) => {
    const valid = lines.filter((l) => getItem(l.itemId));
    if (!valid.length) return;
    const pending = get().pendingAdd;
    set({ pendingAdd: { lines: mergeLines(pending?.lines ?? [], valid), source: pending?.source === "voice" ? "voice" : source } });
  },
  setPendingQty: (itemId, qty) => {
    const p = get().pendingAdd;
    if (!p) return;
    const lines = qty <= 0 ? p.lines.filter((l) => l.itemId !== itemId) : p.lines.map((l) => (l.itemId === itemId ? { ...l, qty: clampQty(qty) } : l));
    set({ pendingAdd: lines.length ? { ...p, lines } : null });
  },
  confirmAdd: () => {
    const { pendingAdd, cart } = get();
    if (!pendingAdd) return;
    set({ cart: mergeLines(cart, pendingAdd.lines), pendingAdd: null });
  },
  cancelAdd: () => set({ pendingAdd: null }),

  setCartQty: (itemId, qty) => {
    const cart = get().cart;
    set({
      cart: qty <= 0 ? cart.filter((l) => l.itemId !== itemId) : cart.map((l) => (l.itemId === itemId ? { ...l, qty: clampQty(qty) } : l)),
    });
  },
}));

/** Add `extra` into `base`: same dish sums quantities, new dishes go on the end. */
function mergeLines(base: CartLine[], extra: CartLine[]): CartLine[] {
  const out = base.map((l) => ({ ...l }));
  for (const e of extra) {
    const hit = out.find((l) => l.itemId === e.itemId);
    if (hit) hit.qty = clampQty(hit.qty + e.qty);
    else out.push({ itemId: e.itemId, qty: clampQty(e.qty) });
  }
  return out;
}

function clampQty(n: number): number {
  return Math.max(1, Math.min(20, Math.round(n) || 1));
}

export function cartCount(cart: CartLine[]): number {
  return cart.reduce((n, l) => n + l.qty, 0);
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + (getItem(l.itemId)?.price ?? 0) * l.qty, 0);
}

/** The model-facing snapshot of this state. */
export function viewContextOf(s: AgentState): ViewContext {
  return {
    activeNodeId: s.activeNodeId,
    backTo: s.history.at(-1),
    filters: s.filters,
    highlighted: s.highlighted,
    cart: s.cart,
    pendingAdd: s.pendingAdd && s.pendingAdd.lines.map((l) => ({ ...l })),
  };
}

export type { AgentState };

export const isCartOpen = (s: Pick<AgentState, "activeNodeId">) => s.activeNodeId === CART_ID;
