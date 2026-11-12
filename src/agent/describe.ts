// Short, factual descriptions of screens and dishes. Tool results and the
// "current screen" context sent to the model are built from these, so the
// model always speaks from what is actually on screen.

import { CATEGORIES, MENU, formatPrice, getCategory, getItem, itemsInCategory, type MenuItem } from "../data/menu";
import { describeFilters, hasActiveFilters, matchesFilters, type Filters } from "./filters";
import { CART_ID, HOME_ID, categoryIdOf, getPath, itemIdOf } from "./paths";

export interface ViewContext {
  activeNodeId: string;
  /** Where "back" goes, if anywhere. */
  backTo?: string;
  filters: Filters;
  highlighted: string[];
  cart: { itemId: string; qty: number }[];
  pendingAdd: { itemId: string; qty: number }[] | null;
}

export const DEFAULT_VIEW: ViewContext = {
  activeNodeId: HOME_ID,
  filters: {},
  highlighted: [],
  cart: [],
  pendingAdd: null,
};

const SPICE = ["not spicy", "mild", "medium", "hot"];

export const priceTag = (i: MenuItem) => `${i.name} (${formatPrice(i.price)})`;

export function describeItem(i: MenuItem): string {
  return (
    `${i.name}: ${formatPrice(i.price)}, ${i.veg ? "vegetarian" : "non-vegetarian"}, ` +
    `spice ${i.spiceLevel}/3 (${SPICE[i.spiceLevel]}), ` +
    `allergens: ${i.allergens.length ? i.allergens.join(", ") : "none listed"}, ` +
    `tags: ${i.tags.join(", ")}. ${i.description}`
  );
}

/** Items the guest can currently see for the active node. */
export function visibleItems(ctx: Pick<ViewContext, "activeNodeId" | "filters" | "cart">): MenuItem[] {
  const itemId = itemIdOf(ctx.activeNodeId);
  if (itemId) return [getItem(itemId)!].filter(Boolean);
  const catId = categoryIdOf(ctx.activeNodeId);
  if (catId) return itemsInCategory(catId as MenuItem["category"]).filter((i) => matchesFilters(i, ctx.filters));
  if (ctx.activeNodeId === CART_ID) return ctx.cart.map((l) => getItem(l.itemId)!).filter(Boolean);
  return MENU.filter((i) => matchesFilters(i, ctx.filters));
}

export function describeCart(cart: ViewContext["cart"]): string {
  if (!cart.length) return "The order is empty.";
  const lines = cart.map((l) => {
    const i = getItem(l.itemId)!;
    return `${l.qty} × ${i.name} (${formatPrice(i.price * l.qty)})`;
  });
  const total = cart.reduce((s, l) => s + (getItem(l.itemId)?.price ?? 0) * l.qty, 0);
  return `${lines.join(", ")}. Total ${formatPrice(total)}.`;
}

/** What the guest sees right now, phrased as a tool result. */
export function describeNode(ctx: ViewContext): string {
  const id = ctx.activeNodeId;
  const filterNote = hasActiveFilters(ctx.filters) ? ` Filters active: ${describeFilters(ctx.filters).join(", ")}.` : "";

  const itemId = itemIdOf(id);
  if (itemId) {
    const item = getItem(itemId)!;
    const hidden = !matchesFilters(item, ctx.filters) ? " (Note: this dish does not match the active filters.)" : "";
    return `Showing ${describeItem(item)}${hidden}`;
  }

  const catId = categoryIdOf(id);
  if (catId) {
    const cat = getCategory(catId)!;
    const all = itemsInCategory(cat.id);
    const vis = visibleItems(ctx);
    const count = vis.length === all.length ? `${vis.length} dishes visible` : `${vis.length} of ${all.length} dishes visible`;
    const list = vis.length ? `: ${vis.map(priceTag).join(", ")}.` : ".";
    return `Navigated to ${cat.name}, ${count}${list}${filterNote}`;
  }

  if (id === CART_ID) return `Showing the order. ${describeCart(ctx.cart)}`;

  const vis = visibleItems(ctx);
  return `Showing the full menu (${CATEGORIES.map((c) => c.name).join(", ")}), ${vis.length} of ${MENU.length} dishes visible.${filterNote}`;
}

/** The "current screen" block appended to the model's instructions. */
export function describeViewForModel(ctx: ViewContext): string {
  const node = getPath(ctx.activeNodeId);
  const vis = visibleItems(ctx);
  const lines = [
    `Screen: ${ctx.activeNodeId} (${node?.label ?? "unknown"})`,
    `Back goes to: ${ctx.backTo ?? "nothing (already at the start)"}`,
    `Visible dishes: ${vis.length ? vis.map((i) => i.id).join(", ") : "none"}`,
    `Active filters: ${hasActiveFilters(ctx.filters) ? describeFilters(ctx.filters).join(", ") : "none"}`,
    `Highlighted dishes: ${ctx.highlighted.length ? ctx.highlighted.join(", ") : "none"}`,
    `Order (confirmed by guest): ${describeCart(ctx.cart)}`,
    `Awaiting on-screen confirmation (NOT in the order yet): ${
      ctx.pendingAdd?.length ? ctx.pendingAdd.map((l) => `${l.qty} × ${getItem(l.itemId)?.name}`).join(", ") : "nothing"
    }`,
  ];
  return lines.join("\n");
}
