// Realtime session definition shared by the server (client_secrets request)
// and the browser (session.update on every view change). Pure: no DOM, no
// store, safe to import from Node.

import { ALLERGENS, ALL_TAGS, CATEGORIES, ITEM_IDS, MENU } from "../data/menu";
import { DEFAULT_VIEW, describeViewForModel, type ViewContext } from "./describe";
import { reachablePathIds } from "./paths";

const BASE_INSTRUCTIONS = `
You are the voice host for Saffron & Sage, a restaurant. You only help with this menu.

# Style
- Warm, natural and concise. Keep spoken replies to 1-2 sentences unless the guest asks for detail.
- Prices are in Indian rupees; say them as rupees (e.g. "three forty-nine rupees").
- Speak Indian English with a natural, warm Indian accent, the way a friendly host in an Indian restaurant would. Pronounce dish names the Indian way (paneer, tikka, chai, kebab).
- Guests often have Indian accents and may mix Hindi into English ("kuch veg dikhao", "thoda kam spicy"). Understand Hinglish naturally; "veg" means vegetarian and "non-veg" means with meat, fish or egg. Reply in English unless the guest speaks mainly in another language, then reply in that language.

# Driving the screen
- The screen is shared with the guest. Whenever a request involves showing something, call the tool FIRST and say nothing before the tool call, so the screen moves as you start talking.
- "Show me / open / what's in X" -> navigate to it. "Tell me about <dish>" -> navigate to that dish, then describe it from the tool result.
- navigate only accepts ids in its enum (reachable from the current screen). For a dish in another category, navigate to that category first, then to the dish.
- Recommendations: call filter with every constraint the guest gave (vegetarian -> veg:true, "not spicy" -> maxSpice:0, "mild" -> maxSpice:1, "under 400" -> maxPrice:400, "a dessert" / "a starter" -> category, allergies -> excludeAllergens), then highlight the 1-2 dishes you recommend, then recommend them with a short reason.
- "Go back" -> goBack. "Start over / show everything" -> clearFilters and navigate home.
- "Add <n> of that/those" -> addToCart for the dish being discussed (the open dish or the highlighted one). When the guest asks for several dishes ("a paneer tikka, two butter chicken and a lassi"), put ALL of them in ONE addToCart call; never drop any. Calling addToCart again while the sheet is open adds to the same sheet. addToCart only opens an on-screen confirmation: say you've put it up for them to confirm. NEVER say anything was added to the order; only the guest can confirm by tapping. Check "Order (confirmed by guest)" below before talking about the order.
- If a tool returns ERROR, fix the call or explain briefly; don't pretend it worked.

# Listening (the microphone is in a room, near the speaker)
- The mic can pick up background noise, other people, TV/video audio, or your own voice echoing back. Captions like "Thank you for watching", "Peace", or a fragment of what you just said are NOT the guest.
- Only act on clear requests addressed to you. If what you heard is unclear, a fragment, off-topic chatter, or an echo of your own words: do not call any tool, do not change the screen, and do not continue your previous answer. Either stay silent or, at most once, say "Sorry, I didn't catch that."
- Never navigate, filter, clear or reset the screen unless the guest clearly asked for it. Leaving the screen as it is is always safe.
- If you are interrupted, don't restart from the beginning; wait for the guest.

# Open-ended requests
- "What should I have / suggest something / what's good today / surprise me": recommend right away. Highlight 2-3 dishes (e.g. a popular starter and a main, respecting any constraints the guest already gave), name them with one short reason each, then ask one quick question (veg? spice level?) to refine. Don't clear filters or navigate home for this.

# Facts
- Use only dishes, prices, ingredients and allergens from the menu data below and from tool results. Never invent dishes, ingredients or prices.
- If the guest asks for something not on the menu, say it isn't available and suggest the closest dish that is (you may navigate to or highlight it).
- If unsure about an ingredient not listed, say you're not sure and suggest asking the staff.
`.trim();

// Compact JSON: short keys keep the prompt small.
const MENU_JSON = JSON.stringify(
  MENU.map((i) => ({
    id: i.id,
    name: i.name,
    cat: i.category,
    inr: i.price,
    veg: i.veg,
    spice: i.spiceLevel,
    allergens: i.allergens,
    tags: i.tags,
    desc: i.description,
  })),
);

/**
 * Vocabulary hint for the caption transcriber. Without it, short or noisy
 * clips (often the very first one) come back as unrelated stock phrases, and
 * dish names get mangled.
 */
export const TRANSCRIPTION_PROMPT =
  `A guest with an Indian English accent, sometimes mixing in Hindi, ordering at Saffron & Sage, an Indian and continental restaurant. ` +
  `Common words: veg, non-veg, Jain, spicy, mild, less spicy, paneer, chai, lassi, rupees. ` +
  `Dishes: ${MENU.map((i) => i.name).join(", ")}.`;

/** "voice" for the realtime host; "text" for a typed assistant box (same rules, no speech guidance). */
export type Channel = "voice" | "text";

const TEXT_STYLE = `# Style
- Warm, natural and concise. Reply in 1-2 sentences unless the guest asks for detail.
- Prices are in Indian rupees; write them like ₹349.
- Guests may mix Hindi into English ("kuch veg dikhao", "thoda kam spicy"). "veg" means vegetarian and "non-veg" means with meat, fish or egg.

`;

function baseInstructions(channel: Channel): string {
  if (channel === "voice") return BASE_INSTRUCTIONS;
  return BASE_INSTRUCTIONS.replace("You are the voice host", "You are the host")
    .replace(/# Style[\s\S]*?(?=# Driving the screen)/, TEXT_STYLE)
    .replace(/# Listening[\s\S]*?(?=# Open-ended requests)/, "")
    .replace(", so the screen moves as you start talking", "");
}

export function buildInstructions(ctx: ViewContext = DEFAULT_VIEW, channel: Channel = "voice"): string {
  return [
    baseInstructions(channel),
    `# Menu data (inr = price in rupees, spice 0-3)\n${MENU_JSON}`,
    `# Current screen (updates as the guest moves around)\n${describeViewForModel(ctx)}`,
  ].join("\n\n");
}

export interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolName = "navigate" | "highlight" | "filter" | "clearFilters" | "goBack" | "addToCart";

export function navigateEnum(activeNodeId: string): string[] {
  return reachablePathIds(activeNodeId);
}

export function buildTools(activeNodeId: string = DEFAULT_VIEW.activeNodeId): FunctionTool[] {
  return [
    {
      type: "function",
      name: "navigate",
      description:
        "Move the shared screen. Call BEFORE speaking whenever the guest wants to see or hear about something. " +
        "category.* shows a category, item.* opens a dish and returns its full details, home = top of menu, cart = the order, back = previous screen. " +
        "Only enum ids are reachable from the current screen; reach a dish in another category via its category first.",
      parameters: {
        type: "object",
        properties: { pathId: { type: "string", enum: navigateEnum(activeNodeId) } },
        required: ["pathId"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "highlight",
      description: "Visually mark the dishes you are recommending (replaces previous highlights; [] clears). Scrolls to the first one.",
      parameters: {
        type: "object",
        properties: { itemIds: { type: "array", items: { type: "string", enum: [...ITEM_IDS] }, maxItems: 6 } },
        required: ["itemIds"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "filter",
      description:
        "Show only dishes matching ALL given constraints. Replaces existing filters, so include every constraint the guest still wants. Returns the matching dishes.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: CATEGORIES.map((c) => c.id), description: "Only dishes in this category" },
          veg: { type: "boolean", description: "true = vegetarian only" },
          maxPrice: { type: "integer", description: "Maximum price in rupees, inclusive" },
          maxSpice: { type: "integer", minimum: 0, maximum: 3, description: "0 not spicy, 1 mild, 2 medium, 3 hot" },
          excludeAllergens: { type: "array", items: { type: "string", enum: [...ALLERGENS] } },
          tags: { type: "array", items: { type: "string", enum: [...ALL_TAGS] }, description: "Dish must have every tag" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "clearFilters",
      description: "Remove all filters and highlights.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "goBack",
      description: "Return to the previous screen (guest says go back / previous / where was I).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: "addToCart",
      description:
        "Open an on-screen confirmation to add dishes to the order. Include EVERY dish the guest asked for in one call. " +
        "If a sheet is already open, these join it. Nothing is added until the guest taps Confirm; never say it was added.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                itemId: { type: "string", enum: [...ITEM_IDS] },
                qty: { type: "integer", minimum: 1, maximum: 20 },
              },
              required: ["itemId", "qty"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  ];
}

export interface SessionOptions {
  model: string;
  voice: string;
  transcriptionModel: string;
  /** ISO-639-1 language for captions (default "en"); "" lets the transcriber guess. */
  transcriptionLanguage?: string;
  /**
   * Turn detection. "semantic" (default) ends turns on meaning, not just sound,
   * so speaker echo and room noise rarely trigger a turn or a barge-in.
   * "server" is plain energy VAD: snappier, but echo-prone without headphones.
   */
  vad?: "semantic" | "server";
  /** Silence (ms) before server VAD ends the user's turn. Lower = snappier, more cut-offs. Server VAD only. */
  silenceMs?: number;
  /** Server-side input noise reduction: far_field for laptop/kiosk mics, near_field for headsets. */
  noiseReduction?: "far_field" | "near_field" | "none";
}

function turnDetection(opts: SessionOptions) {
  if (opts.vad === "server") {
    return {
      type: "server_vad",
      threshold: 0.6,
      prefix_padding_ms: 300,
      silence_duration_ms: opts.silenceMs ?? 400,
      create_response: true,
      interrupt_response: true,
    };
  }
  return { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true };
}

/** Full GA session config for POST /openai/v1/realtime/client_secrets. */
export function buildSessionConfig(opts: SessionOptions, ctx: ViewContext = DEFAULT_VIEW) {
  return {
    type: "realtime",
    model: opts.model,
    instructions: buildInstructions(ctx),
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: {
          model: opts.transcriptionModel,
          prompt: TRANSCRIPTION_PROMPT,
          ...(opts.transcriptionLanguage !== "" && { language: opts.transcriptionLanguage ?? "en" }),
        },
        noise_reduction: opts.noiseReduction === "none" ? null : { type: opts.noiseReduction ?? "far_field" },
        turn_detection: turnDetection(opts),
      },
      output: { voice: opts.voice },
    },
    tools: buildTools(ctx.activeNodeId),
    tool_choice: "auto",
  };
}

/** The part of the session refreshed on every view change. */
export function buildSessionUpdate(ctx: ViewContext) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: buildInstructions(ctx),
      tools: buildTools(ctx.activeNodeId),
    },
  };
}
