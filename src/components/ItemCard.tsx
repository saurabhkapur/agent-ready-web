import { useEffect } from "react";
import { formatPrice, type MenuItem } from "../data/menu";
import { itemPathId } from "../agent/paths";
import { useAgentStore } from "../agent/store";
import { useAgentComponent } from "../agent/useAgentComponent";
import { flash, revealElement, userScrolledRecently } from "../agent/scroll";
import { useVoiceStore } from "../voice/voiceStore";
import { SpiceMeter, VegMark } from "./Badges";

export function ItemCard({ item, matchesFilters }: { item: MenuItem; matchesFilters: boolean }) {
  const { isActive, activate, agentProps } = useAgentComponent<HTMLElement>(itemPathId(item.id));
  const highlighted = useAgentStore((s) => s.highlighted.includes(item.id));
  const requestAdd = useAgentStore((s) => s.requestAdd);
  const navigate = useAgentStore((s) => s.navigate);

  const isFirstHighlight = useAgentStore((s) => s.highlighted[0] === item.id);
  const highlightSeq = useAgentStore((s) => s.highlightSeq);

  // When the agent highlights dishes, bring the first one into view.
  useEffect(() => {
    const el = agentProps.ref.current;
    if (!isFirstHighlight || !el || highlightSeq === 0) return;
    const raf = requestAnimationFrame(() => {
      revealElement(el, "center");
      flash(el);
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightSeq, isFirstHighlight, agentProps.ref]);

  // Follow along: the host just started talking about this dish.
  const spoken = useVoiceStore((s) => s.spokenItemId === item.id);
  const spokenSeq = useVoiceStore((s) => s.spokenSeq);
  useEffect(() => {
    const el = agentProps.ref.current;
    if (!spoken || !el) return;
    const s = useAgentStore.getState();
    // Don't scroll behind the order drawer or confirm sheet, or against the guest's own scrolling.
    if (s.activeNodeId === "cart" || s.pendingAdd || userScrolledRecently()) return;
    revealElement(el, "center");
  }, [spoken, spokenSeq, agentProps.ref]);

  const toggle = () => (isActive ? navigate(`category.${item.category}`) : activate());

  return (
    <article
      {...agentProps}
      className={["item-card", isActive && "is-active", highlighted && "is-highlighted", spoken && "is-spoken"].filter(Boolean).join(" ")}
    >
      <button className="item-head" onClick={toggle} aria-expanded={isActive}>
        <VegMark veg={item.veg} />
        <span className="item-name">{item.name}</span>
        <span className="item-price">{formatPrice(item.price)}</span>
      </button>

      <p className="item-desc">{item.description}</p>

      <div className="item-meta">
        <SpiceMeter level={item.spiceLevel} />
        {highlighted && <span className="badge-recommended">★ Recommended</span>}
        {!isActive && item.tags.includes("popular") && <span className="badge-soft">Popular</span>}
      </div>

      {/* Always rendered so it can animate open; inert while collapsed. */}
      <div className="item-expand" inert={!isActive}>
        <div className="item-detail" data-expand-body>
          {!matchesFilters && <p className="note">Doesn’t match your current filters.</p>}
          <dl>
            <div>
              <dt>Spice</dt>
              <dd>
                <SpiceMeter level={item.spiceLevel} withLabel />
              </dd>
            </div>
            <div>
              <dt>Allergens</dt>
              <dd>{item.allergens.length ? item.allergens.join(", ") : "None listed"}</dd>
            </div>
          </dl>
          <ul className="tags">
            {item.tags.map((t) => (
              <li key={t}>#{t}</li>
            ))}
          </ul>
          <button className="btn btn-primary btn-block" onClick={() => requestAdd([{ itemId: item.id, qty: 1 }], "touch")}>
            Add to order · {formatPrice(item.price)}
          </button>
        </div>
      </div>
    </article>
  );
}
