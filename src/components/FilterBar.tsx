import { useState } from "react";
import { ALLERGENS, MENU, type Allergen } from "../data/menu";
import { describeFilters, hasActiveFilters, matchesFilters } from "../agent/filters";
import { useAgentStore } from "../agent/store";

const PRICE_STEPS = [200, 300, 400, 500];
const SPICE_STEPS = [
  { value: 0, label: "Not spicy" },
  { value: 1, label: "Mild" },
  { value: 2, label: "Medium" },
];

export function FilterBar() {
  const filters = useAgentStore((s) => s.filters);
  const patch = useAgentStore((s) => s.patchFilters);
  const clear = useAgentStore((s) => s.clearFilters);
  const [open, setOpen] = useState(false);

  const active = hasActiveFilters(filters);
  const matching = MENU.filter((i) => matchesFilters(i, filters)).length;

  const toggleAllergen = (a: Allergen) => {
    const cur = filters.excludeAllergens ?? [];
    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
    patch({ excludeAllergens: next.length ? next : undefined });
  };

  return (
    <div className="filter-bar">
      <div className="filter-summary">
        <button className="chip chip-outline" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Filters{active ? ` · ${matching}/${MENU.length}` : ""}
        </button>
        <button
          className={`chip chip-outline${filters.veg ? " is-on" : ""}`}
          aria-pressed={!!filters.veg}
          onClick={() => patch({ veg: filters.veg ? undefined : true })}
        >
          Veg only
        </button>
        {active && (
          <>
            <span className="filter-text">{describeFilters(filters).join(" · ")}</span>
            <button className="chip chip-clear" onClick={clear}>
              Clear
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="filter-panel">
          <fieldset>
            <legend>Max price</legend>
            <Seg
              options={[{ value: undefined, label: "Any" }, ...PRICE_STEPS.map((p) => ({ value: p, label: `₹${p}` }))]}
              value={filters.maxPrice}
              onChange={(v) => patch({ maxPrice: v })}
            />
          </fieldset>
          <fieldset>
            <legend>Spice</legend>
            <Seg options={[{ value: undefined, label: "Any" }, ...SPICE_STEPS]} value={filters.maxSpice} onChange={(v) => patch({ maxSpice: v })} />
          </fieldset>
          <fieldset>
            <legend>Avoid</legend>
            <div className="seg">
              {ALLERGENS.map((a) => {
                const on = filters.excludeAllergens?.includes(a) ?? false;
                return (
                  <button key={a} className={`seg-btn${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggleAllergen(a)}>
                    {a}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

function Seg({
  options,
  value,
  onChange,
}: {
  options: { value: number | undefined; label: string }[];
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.label} className={`seg-btn${o.value === value ? " is-on" : ""}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
