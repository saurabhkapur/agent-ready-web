import { itemsInCategory, type Category } from "../data/menu";
import { matchesFilters } from "../agent/filters";
import { categoryPathId, itemPathId } from "../agent/paths";
import { useAgentStore } from "../agent/store";
import { useAgentComponent } from "../agent/useAgentComponent";
import { ItemCard } from "./ItemCard";

export function MenuSection({ category }: { category: Category }) {
  const { isActive, agentProps } = useAgentComponent<HTMLElement>(categoryPathId(category.id));
  const filters = useAgentStore((s) => s.filters);
  const activeNodeId = useAgentStore((s) => s.activeNodeId);

  const items = itemsInCategory(category.id);
  // Hide non-matching items, but never hide the item the user is looking at.
  const shown = items
    .map((item) => ({ item, matches: matchesFilters(item, filters) }))
    .filter(({ item, matches }) => matches || activeNodeId === itemPathId(item.id));
  const matchCount = shown.filter((s) => s.matches).length;

  return (
    <section {...agentProps} className={`menu-section${isActive ? " is-active" : ""}`}>
      <header className="section-head">
        <h2>{category.name}</h2>
        <span className="count">
          {matchCount === items.length ? `${items.length} dishes` : `${matchCount} of ${items.length}`}
        </span>
      </header>
      <p className="section-desc">{category.description}</p>
      {shown.length === 0 ? (
        <p className="empty">Nothing here matches your filters.</p>
      ) : (
        <div className="item-grid">
          {shown.map(({ item, matches }) => (
            <ItemCard key={item.id} item={item} matchesFilters={matches} />
          ))}
        </div>
      )}
    </section>
  );
}
