import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "../src/agent/store";
import { executeTool } from "../src/agent/tools";
import { buildSessionConfig, buildTools, navigateEnum } from "../src/agent/session";
import { MENU } from "../src/data/menu";

const initial = useAgentStore.getState();
beforeEach(() => useAgentStore.setState(initial, true));
const s = () => useAgentStore.getState();
const call = (name: string, args: unknown) => executeTool(name, JSON.stringify(args));

describe("menu data", () => {
  it("has 20 items across 4 categories with unique ids", () => {
    expect(MENU).toHaveLength(20);
    expect(new Set(MENU.map((i) => i.id)).size).toBe(20);
    expect(new Set(MENU.map((i) => i.category)).size).toBe(4);
  });
});

describe("navigate", () => {
  it("1. show me desserts: moves and reports visible count", () => {
    const r = call("navigate", { pathId: "category.desserts" });
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/^Navigated to Desserts, 4 dishes visible: Gulab Jamun \(₹199\)/);
    expect(s().activeNodeId).toBe("category.desserts");
    expect(s().lastNavSource).toBe("voice");
  });

  it("2. paneer tikka from home: opens with accurate facts", () => {
    const r = call("navigate", { pathId: "item.paneer-tikka" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Paneer Tikka: ₹349, vegetarian, spice 2/3 (medium), allergens: dairy");
  });

  it("rejects an item not reachable from the current node and names the route", () => {
    call("navigate", { pathId: "category.desserts" });
    const r = call("navigate", { pathId: "item.paneer-tikka" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("Navigate to category.starters first");
    expect(s().activeNodeId).toBe("category.desserts");
  });

  it("7. rejects dishes not on the menu", () => {
    const r = call("navigate", { pathId: "item.sushi" });
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not on this menu/);
  });

  it("rejects malformed arguments", () => {
    expect(executeTool("navigate", "{oops").ok).toBe(false);
    expect(call("navigate", {}).ok).toBe(false);
    expect(call("teleport", {}).ok).toBe(false);
  });
});

describe("goBack", () => {
  it("4. returns to the previous node", () => {
    call("navigate", { pathId: "category.mains" });
    call("navigate", { pathId: "item.dal-makhani" });
    const r = call("goBack", {});
    expect(r.ok).toBe(true);
    expect(s().activeNodeId).toBe("category.mains");
    expect(r.output).toMatch(/^Went back\. Navigated to Mains/);
    expect(call("navigate", { pathId: "back" }).ok).toBe(true);
    expect(s().activeNodeId).toBe("home");
  });
});

describe("filter + highlight", () => {
  it("3. veg, not spicy, under 400", () => {
    const r = call("filter", { veg: true, maxSpice: 0, maxPrice: 400 });
    expect(r.ok).toBe(true);
    expect(s().filters).toEqual({ veg: true, maxSpice: 0, maxPrice: 400 });
    expect(r.output).toContain("Tomato Bruschetta (₹299)");
    expect(r.output).toContain("Penne Alfredo (₹389)");
    expect(r.output).not.toContain("Paneer Tikka");
    expect(r.output).not.toContain("Mushroom Risotto"); // ₹449
    const h = call("highlight", { itemIds: ["penne-alfredo", "tomato-bruschetta"] });
    expect(h.ok).toBe(true);
    expect(s().highlighted).toEqual(["penne-alfredo", "tomato-bruschetta"]);
  });

  it("validates fields", () => {
    expect(call("filter", { colour: "red" }).output).toMatch(/unknown filter field/);
    expect(call("filter", { category: "soups" }).ok).toBe(false);
    expect(call("filter", { maxSpice: 7 }).ok).toBe(false);
    expect(call("filter", { excludeAllergens: ["peanut"] }).ok).toBe(false);
    expect(call("highlight", { itemIds: ["pizza"] }).ok).toBe(false);
    expect(s().filters).toEqual({});
  });

  it("filters by category", () => {
    const r = call("filter", { category: "desserts", veg: true, maxPrice: 250 });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Gulab Jamun (₹199)");
    expect(r.output).toContain("Rasmalai (₹229)");
    expect(r.output).toMatch(/2 of 20 dishes match/);
  });

  it("clearFilters clears filters and highlights", () => {
    call("filter", { veg: true });
    call("highlight", { itemIds: ["rasmalai"] });
    call("clearFilters", {});
    expect(s().filters).toEqual({});
    expect(s().highlighted).toEqual([]);
  });
});

describe("addToCart", () => {
  it("5. only opens a confirmation; nothing is added until confirmed", () => {
    const r = call("addToCart", { items: [{ itemId: "tiramisu", qty: 2 }] });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("NOT added yet");
    expect(s().cart).toEqual([]);
    expect(s().pendingAdd).toEqual({ lines: [{ itemId: "tiramisu", qty: 2 }], source: "voice" });
    s().confirmAdd();
    expect(s().cart).toEqual([{ itemId: "tiramisu", qty: 2 }]);
  });

  it("puts several dishes on one sheet and confirms them all", () => {
    const r = call("addToCart", {
      items: [
        { itemId: "paneer-tikka", qty: 1 },
        { itemId: "butter-chicken", qty: 2 },
        { itemId: "mango-lassi", qty: 1 },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("2 × Butter Chicken");
    expect(s().pendingAdd!.lines).toHaveLength(3);
    s().confirmAdd();
    expect(s().cart).toEqual([
      { itemId: "paneer-tikka", qty: 1 },
      { itemId: "butter-chicken", qty: 2 },
      { itemId: "mango-lassi", qty: 1 },
    ]);
  });

  it("separate calls join the open sheet instead of replacing it", () => {
    call("addToCart", { items: [{ itemId: "paneer-tikka", qty: 1 }] });
    call("addToCart", { itemId: "masala-chai", qty: 2 }); // legacy single-dish shape
    call("addToCart", { items: [{ itemId: "paneer-tikka", qty: 1 }] });
    expect(s().pendingAdd!.lines).toEqual([
      { itemId: "paneer-tikka", qty: 2 },
      { itemId: "masala-chai", qty: 2 },
    ]);
    s().setPendingQty("masala-chai", 0); // removed from the sheet
    expect(s().pendingAdd!.lines).toEqual([{ itemId: "paneer-tikka", qty: 2 }]);
    s().setPendingQty("paneer-tikka", 0);
    expect(s().pendingAdd).toBeNull();
  });

  it("validates qty and item, all or nothing", () => {
    expect(call("addToCart", { items: [{ itemId: "tiramisu", qty: 0 }] }).ok).toBe(false);
    expect(call("addToCart", { items: [{ itemId: "tiramisu", qty: 1 }, { itemId: "naan", qty: 1 }] }).ok).toBe(false);
    expect(call("addToCart", { items: [] }).ok).toBe(false);
    expect(s().pendingAdd).toBeNull();
  });
});

describe("session config", () => {
  it("navigate enum is reachable-from-current plus globals", () => {
    const home = navigateEnum("home");
    expect(home).toContain("item.paneer-tikka");
    const desserts = navigateEnum("category.desserts");
    expect(desserts).toContain("item.tiramisu");
    expect(desserts).not.toContain("item.paneer-tikka");
    expect(desserts).toEqual(expect.arrayContaining(["home", "back", "cart", "category.starters"]));
    const nav = buildTools("category.desserts").find((t) => t.name === "navigate")!;
    expect((nav.parameters as any).properties.pathId.enum).toEqual(desserts);
  });

  it("GA session shape", () => {
    const cfg = buildSessionConfig({ model: "dep", voice: "marin", transcriptionModel: "whisper-1" });
    expect(cfg.type).toBe("realtime");
    expect(cfg.audio.output.voice).toBe("marin");
    expect(cfg.audio.input.turn_detection).toMatchObject({ type: "semantic_vad", interrupt_response: true, create_response: true });
    expect(cfg.audio.input.noise_reduction).toEqual({ type: "far_field" });
    expect(cfg.audio.input.transcription).toMatchObject({ model: "whisper-1", language: "en" });
    expect(cfg.audio.input.transcription.prompt).toContain("Hara Bhara Kebab");
    const server = buildSessionConfig({ model: "dep", voice: "marin", transcriptionModel: "whisper-1", vad: "server", silenceMs: 500 });
    expect(server.audio.input.turn_detection).toMatchObject({ type: "server_vad", silence_duration_ms: 500, interrupt_response: true });
    expect(cfg.instructions).toContain('"id":"paneer-tikka"');
    expect(cfg.tools.map((t) => t.name)).toEqual(["navigate", "highlight", "filter", "clearFilters", "goBack", "addToCart"]);
  });
});
