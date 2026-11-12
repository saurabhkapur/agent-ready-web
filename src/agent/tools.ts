// Action executor: validates a tool call from the model against paths.ts and
// the menu data, applies it to the agent store, and returns a short factual
// result for the model to speak from. Invalid calls change nothing and return
// an ERROR string the model can recover from.

import { ALLERGENS, ALL_TAGS, CATEGORIES, MENU, getItem, type Allergen } from "../data/menu";
import { describeCart, describeNode, priceTag } from "./describe";
import { describeFilters, hasActiveFilters, matchesFilters, type Filters } from "./filters";
import { categoryPathId, isPathId, itemIdOf } from "./paths";
import { navigateEnum, type ToolName } from "./session";
import { useAgentStore, viewContextOf } from "./store";

export interface ToolResult {
  ok: boolean;
  output: string;
}

class ToolError extends Error {}

const ok = (output: string): ToolResult => ({ ok: true, output });
const fail = (msg: string): ToolResult => ({ ok: false, output: `ERROR: ${msg}` });

const state = () => useAgentStore.getState();
const nameList = (ids: string[]) => ids.map((id) => getItem(id)?.name ?? id).join(", ");

export function executeTool(name: string, rawArgs: string): ToolResult {
  let args: Record<string, unknown>;
  try {
    const parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    args = parsed;
  } catch {
    return fail(`arguments for ${name} were not a JSON object.`);
  }

  try {
    switch (name as ToolName) {
      case "navigate":
        return navigate(args);
      case "highlight":
        return highlight(args);
      case "filter":
        return filter(args);
      case "clearFilters":
        state().clearFilters();
        return ok(`Filters and highlights cleared. All ${MENU.length} dishes visible.`);
      case "goBack":
        return goBack();
      case "addToCart":
        return addToCart(args);
      default:
        return fail(`unknown tool "${name}".`);
    }
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message);
    console.error(`[tools] ${name} threw`, e);
    return fail(`${name} failed unexpectedly.`);
  }
}

function navigate(args: Record<string, unknown>): ToolResult {
  const pathId = args.pathId;
  if (typeof pathId !== "string") throw new ToolError("navigate needs a string pathId.");
  if (!isPathId(pathId)) {
    throw new ToolError(`"${pathId}" is not on this menu. Tell the guest it isn't available and suggest the closest dish.`);
  }
  const current = state().activeNodeId;
  if (pathId !== current && !navigateEnum(current).includes(pathId)) {
    const itemId = itemIdOf(pathId);
    const via = itemId ? categoryPathId(getItem(itemId)!.category) : undefined;
    throw new ToolError(
      `${pathId} is not reachable from ${current}.` + (via ? ` Navigate to ${via} first, then to ${pathId}.` : ""),
    );
  }
  if (pathId === "back") return goBack();
  state().navigate(pathId, "voice");
  return ok(describeNode(viewContextOf(state())));
}

function goBack(): ToolResult {
  const before = state();
  if (before.history.length === 0) {
    if (before.activeNodeId !== "home") state().navigate("home", "voice");
    return ok(`Already at the start. ${describeNode(viewContextOf(state()))}`);
  }
  state().goBack("voice");
  return ok(`Went back. ${describeNode(viewContextOf(state()))}`);
}

function highlight(args: Record<string, unknown>): ToolResult {
  const ids = args.itemIds;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
    throw new ToolError("highlight needs itemIds: an array of menu item ids.");
  }
  const unknown = ids.filter((id) => !getItem(id));
  if (unknown.length) throw new ToolError(`not on the menu: ${unknown.join(", ")}. Nothing was highlighted.`);
  const unique = [...new Set(ids as string[])].slice(0, 6);
  state().setHighlighted(unique);
  if (!unique.length) return ok("Highlights cleared.");
  const filters = state().filters;
  const hidden = unique.filter((id) => !matchesFilters(getItem(id)!, filters));
  return ok(
    `Highlighted ${nameList(unique)}.` + (hidden.length ? ` Note: ${nameList(hidden)} hidden by the active filters.` : ""),
  );
}

function filter(args: Record<string, unknown>): ToolResult {
  const allowed = ["category", "veg", "maxPrice", "maxSpice", "excludeAllergens", "tags"];
  const extra = Object.keys(args).filter((k) => !allowed.includes(k));
  if (extra.length) {
    throw new ToolError(
      `unknown filter field(s): ${extra.join(", ")}. Allowed: ${allowed.join(", ")}.`,
    );
  }

  const f: Filters = {};
  if (args.category !== undefined) {
    const c = CATEGORIES.find((x) => x.id === args.category);
    if (!c) throw new ToolError(`unknown category "${String(args.category)}". Known: ${CATEGORIES.map((x) => x.id).join(", ")}.`);
    f.category = c.id;
  }
  if (args.veg !== undefined) {
    if (typeof args.veg !== "boolean") throw new ToolError("veg must be true or false.");
    if (args.veg) f.veg = true;
  }
  if (args.maxPrice !== undefined) {
    if (typeof args.maxPrice !== "number" || !(args.maxPrice > 0)) throw new ToolError("maxPrice must be a positive number of rupees.");
    f.maxPrice = Math.floor(args.maxPrice);
  }
  if (args.maxSpice !== undefined) {
    const s = args.maxSpice;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 3) throw new ToolError("maxSpice must be an integer 0-3.");
    if (s < 3) f.maxSpice = s;
  }
  if (args.excludeAllergens !== undefined) {
    const a = args.excludeAllergens;
    if (!Array.isArray(a)) throw new ToolError("excludeAllergens must be an array.");
    const bad = a.filter((x) => !ALLERGENS.includes(x as Allergen));
    if (bad.length) throw new ToolError(`unknown allergen(s): ${bad.join(", ")}. Known: ${ALLERGENS.join(", ")}.`);
    if (a.length) f.excludeAllergens = [...new Set(a as Allergen[])];
  }
  if (args.tags !== undefined) {
    const t = args.tags;
    if (!Array.isArray(t)) throw new ToolError("tags must be an array.");
    const bad = t.filter((x) => !ALL_TAGS.includes(x as string));
    if (bad.length) throw new ToolError(`unknown tag(s): ${bad.join(", ")}. Known: ${ALL_TAGS.join(", ")}.`);
    if (t.length) f.tags = [...new Set(t as string[])];
  }

  const store = state();
  store.setFilters(f);
  // Drop highlights the new filters would hide.
  const kept = store.highlighted.filter((id) => matchesFilters(getItem(id)!, f));
  if (kept.length !== store.highlighted.length) store.setHighlighted(kept);

  const matches = MENU.filter((i) => matchesFilters(i, f));
  const label = hasActiveFilters(f) ? describeFilters(f).join(", ") : "none";
  if (!matches.length) {
    return ok(`Filters set (${label}). No dishes match; suggest relaxing a constraint.`);
  }
  const list = matches.map((i) => `${priceTag(i)} [${i.category}, spice ${i.spiceLevel}]`).join("; ");
  return ok(`Filters set (${label}). ${matches.length} of ${MENU.length} dishes match: ${list}.`);
}

function addToCart(args: Record<string, unknown>): ToolResult {
  // { items: [{ itemId, qty }, ...] }; a bare { itemId, qty } is accepted too.
  const raw = Array.isArray(args.items) ? args.items : args.itemId !== undefined ? [{ itemId: args.itemId, qty: args.qty }] : null;
  if (!raw?.length) throw new ToolError("addToCart needs items: [{ itemId, qty }, ...] with every dish the guest asked for.");
  if (raw.length > 10) throw new ToolError("at most 10 dishes per addToCart call.");

  // Validate everything first: a bad line changes nothing.
  const lines = raw.map((line: unknown) => {
    const { itemId, qty = 1 } = (line ?? {}) as { itemId?: unknown; qty?: unknown };
    if (typeof itemId !== "string" || !getItem(itemId)) throw new ToolError(`"${String(itemId)}" is not a menu item id. Nothing was put up.`);
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new ToolError(`qty for ${itemId} must be an integer 1-20. Nothing was put up.`);
    return { itemId, qty };
  });

  state().requestAdd(lines, "voice");
  const pending = state().pendingAdd?.lines ?? [];
  const listed = pending.map((l) => `${l.qty} × ${getItem(l.itemId)!.name} (₹${getItem(l.itemId)!.price * l.qty})`).join(", ");
  return ok(
    `Confirmation sheet now shows: ${listed}. NOT added yet: the guest must tap Confirm. ` +
      `Current order: ${describeCart(state().cart)}`,
  );
}
