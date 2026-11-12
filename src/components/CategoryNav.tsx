import { useEffect } from "react";
import { CATEGORIES } from "../data/menu";
import { categoryPathId, itemIdOf, HOME_ID } from "../agent/paths";
import { getItem } from "../data/menu";
import { useAgentStore } from "../agent/store";
import { useAgentComponent } from "../agent/useAgentComponent";

/** Sticky category chips. They carry path metadata but don't own scroll focus. */
export function CategoryNav() {
  return (
    <nav className="category-nav" aria-label="Menu categories">
      <Chip pathId={HOME_ID} label="All" />
      {CATEGORIES.map((c) => (
        <Chip key={c.id} pathId={categoryPathId(c.id)} label={c.name} />
      ))}
    </nav>
  );
}

function Chip({ pathId, label }: { pathId: string; label: string }) {
  const { activate, agentProps } = useAgentComponent<HTMLButtonElement>(pathId, { focus: false });
  // A chip is "current" when its category or one of its items is active.
  const current = useAgentStore((s) => {
    const itemId = itemIdOf(s.activeNodeId);
    const owner = itemId ? categoryPathId(getItem(itemId)?.category ?? "") : s.activeNodeId;
    return owner === pathId;
  });

  useEffect(() => {
    if (current) agentProps.ref.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current, agentProps.ref]);

  return (
    <button {...agentProps} className={`chip${current ? " is-current" : ""}`} aria-current={current} onClick={() => activate()}>
      {label}
    </button>
  );
}
