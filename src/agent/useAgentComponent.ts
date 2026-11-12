// Binds a UI component to a node in the navigation graph.
//
// The component spreads `agentProps` onto its root element. That gives the DOM
// semantic metadata (data-agent-path / -action / -active, aria-description)
// and lets the hook scroll the element into view and flash it whenever the
// agent store navigates to this node — whether the navigation came from a tap
// or a tool call.

import { useCallback, useEffect, useRef } from "react";
import { getPath, type PathNode } from "./paths";
import { flash, revealElement } from "./scroll";
import { useAgentStore, type NavigationSource } from "./store";

export interface AgentComponent<T extends HTMLElement> {
  node: PathNode;
  isActive: boolean;
  /** Navigate the store to this node. */
  activate: (source?: NavigationSource) => void;
  agentProps: {
    ref: React.RefObject<T | null>;
    "data-agent-path": string;
    "data-agent-action": PathNode["action"];
    "data-agent-active": boolean;
    "aria-description": string;
  };
}

export function useAgentComponent<T extends HTMLElement = HTMLElement>(
  pathId: string,
  /** focus: scroll to and flash this element when its node becomes active (default true). */
  opts: { focus?: boolean } = {},
): AgentComponent<T> {
  const node = getPath(pathId);
  if (!node) throw new Error(`useAgentComponent: unknown path "${pathId}" (add it to paths.ts)`);

  const ref = useRef<T>(null);
  const isActive = useAgentStore((s) => s.activeNodeId === pathId);
  const navSeq = useAgentStore((s) => s.navSeq);
  const navigate = useAgentStore((s) => s.navigate);
  const focus = opts.focus ?? true;

  useEffect(() => {
    const el = ref.current;
    if (!focus || !isActive || !el || navSeq === 0) return; // nothing to show on first load
    // The guest scrolled here themselves: the page is already where they want it.
    if (useAgentStore.getState().lastNavSource === "scroll") return;
    // Wait a frame so layout changes from this navigation (e.g. another card
    // collapsing) have landed before we measure the scroll target.
    const raf = requestAnimationFrame(() => {
      if (node.action === "describe") {
        // A dish card animates open; reveal it at its final height.
        const detail = el.querySelector<HTMLElement>("[data-expand-body]");
        revealElement(el, "reveal", el.offsetHeight + (detail?.scrollHeight ?? 0));
      } else {
        revealElement(el, "start");
      }
      flash(el);
    });
    return () => cancelAnimationFrame(raf);
  }, [focus, isActive, navSeq, node.action]);

  const activate = useCallback((source?: NavigationSource) => navigate(pathId, source), [navigate, pathId]);

  return {
    node,
    isActive,
    activate,
    agentProps: {
      ref,
      "data-agent-path": node.id,
      "data-agent-action": node.action,
      "data-agent-active": isActive,
      "aria-description": node.description,
    },
  };
}
