// The navigation graph. Every place the UI can go — and therefore every place
// the voice model can send it — is a PathNode in PATHS. UI components bind to
// a node with useAgentComponent(pathId); the navigate tool's enum (stage 3) is
// computed from reachableFrom for the current node.

import { CATEGORIES, MENU } from "../data/menu";

export type PathAction = "navigate" | "describe" | "back" | "home" | "cart";

export interface PathNode {
  /** Stable id, e.g. "category.desserts" or "item.paneer-tikka". */
  id: string;
  label: string;
  description: string;
  /** Node ids this node can be reached from, or "global" for anywhere. */
  reachableFrom: string[] | "global";
  action: PathAction;
}

export const HOME_ID = "home";
export const CART_ID = "cart";
export const BACK_ID = "back";

export const categoryPathId = (categoryId: string) => `category.${categoryId}`;
export const itemPathId = (itemId: string) => `item.${itemId}`;

function buildPaths(): PathNode[] {
  const nodes: PathNode[] = [
    {
      id: HOME_ID,
      label: "Menu home",
      description: "Top of the menu with every category.",
      reachableFrom: "global",
      action: "home",
    },
    {
      id: BACK_ID,
      label: "Back",
      description: "Return to the previous screen.",
      reachableFrom: "global",
      action: "back",
    },
    {
      id: CART_ID,
      label: "Your order",
      description: "The cart: items the guest has confirmed, with quantities and total.",
      reachableFrom: "global",
      action: "cart",
    },
  ];

  for (const c of CATEGORIES) {
    nodes.push({
      id: categoryPathId(c.id),
      label: c.name,
      description: c.description,
      reachableFrom: "global",
      action: "navigate",
    });
  }

  // An item is reachable from home, from its own category, and from any
  // sibling item in that category. Reaching an item in another category goes
  // through that category first, which keeps the per-turn enum small.
  for (const item of MENU) {
    const siblings = MENU.filter((i) => i.category === item.category && i.id !== item.id).map((i) =>
      itemPathId(i.id),
    );
    nodes.push({
      id: itemPathId(item.id),
      label: item.name,
      description: item.description,
      reachableFrom: [HOME_ID, categoryPathId(item.category), ...siblings],
      action: "describe",
    });
  }

  return nodes;
}

export const PATHS: readonly PathNode[] = buildPaths();

const PATH_BY_ID = new Map(PATHS.map((p) => [p.id, p]));

export function getPath(id: string): PathNode | undefined {
  return PATH_BY_ID.get(id);
}

export function isPathId(id: string): boolean {
  return PATH_BY_ID.has(id);
}

/** Path ids the agent may navigate to from `currentId` (global + explicitly reachable). */
export function reachablePathIds(currentId: string): string[] {
  return PATHS.filter(
    (p) => p.id !== currentId && (p.reachableFrom === "global" || p.reachableFrom.includes(currentId)),
  ).map((p) => p.id);
}

/** The menu item id behind an item node, or undefined for non-item nodes. */
export function itemIdOf(pathId: string): string | undefined {
  return pathId.startsWith("item.") ? pathId.slice("item.".length) : undefined;
}

/** The category id behind a category node, or undefined. */
export function categoryIdOf(pathId: string): string | undefined {
  return pathId.startsWith("category.") ? pathId.slice("category.".length) : undefined;
}

// Fail fast in development if the graph references a node that doesn't exist.
if (import.meta.env?.DEV) {
  for (const p of PATHS) {
    if (p.reachableFrom !== "global") {
      for (const from of p.reachableFrom) {
        if (!PATH_BY_ID.has(from)) throw new Error(`paths.ts: ${p.id} is reachable from unknown node ${from}`);
      }
    }
  }
}
