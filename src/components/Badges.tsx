const SPICE_LABELS = ["Not spicy", "Mild", "Medium", "Hot"];

export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span className={`veg-mark ${veg ? "veg" : "nonveg"}`} role="img" aria-label={veg ? "Vegetarian" : "Non-vegetarian"}>
      <span />
    </span>
  );
}

export function SpiceMeter({ level, withLabel }: { level: number; withLabel?: boolean }) {
  return (
    <span className="spice" aria-label={`Spice: ${SPICE_LABELS[level]}`}>
      <span aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= level ? "chili on" : "chili"} />
        ))}
      </span>
      {withLabel && <span className="spice-label">{SPICE_LABELS[level]}</span>}
    </span>
  );
}
