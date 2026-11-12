import { getCategory, type Allergen, type CategoryId, type MenuItem } from "../data/menu";

export interface Filters {
  /** Only dishes in this category. */
  category?: CategoryId;
  veg?: boolean;
  maxPrice?: number;
  maxSpice?: number;
  excludeAllergens?: Allergen[];
  /** Item must carry every listed tag. */
  tags?: string[];
}

export function matchesFilters(item: MenuItem, f: Filters): boolean {
  if (f.category && item.category !== f.category) return false;
  if (f.veg && !item.veg) return false;
  if (f.maxPrice !== undefined && item.price > f.maxPrice) return false;
  if (f.maxSpice !== undefined && item.spiceLevel > f.maxSpice) return false;
  if (f.excludeAllergens?.some((a) => item.allergens.includes(a))) return false;
  if (f.tags?.length && !f.tags.every((t) => item.tags.includes(t))) return false;
  return true;
}

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.category !== undefined ||
    f.veg === true ||
    f.maxPrice !== undefined ||
    f.maxSpice !== undefined ||
    (f.excludeAllergens?.length ?? 0) > 0 ||
    (f.tags?.length ?? 0) > 0
  );
}

const SPICE_WORDS = ["not spicy", "mild or less", "medium or less", "any spice"];

export function describeFilters(f: Filters): string[] {
  const parts: string[] = [];
  if (f.category) parts.push(getCategory(f.category)?.name ?? f.category);
  if (f.veg) parts.push("Vegetarian");
  if (f.maxPrice !== undefined) parts.push(`Under ₹${f.maxPrice}`);
  if (f.maxSpice !== undefined) parts.push(SPICE_WORDS[f.maxSpice] ?? `Spice ≤ ${f.maxSpice}`);
  if (f.excludeAllergens?.length) parts.push(`No ${f.excludeAllergens.join(", ")}`);
  if (f.tags?.length) parts.push(f.tags.map((t) => `#${t}`).join(" "));
  return parts;
}
