// Demo menu. This file is the single source of truth for dishes: the UI renders
// from it, paths.ts derives navigation nodes from it, and (from stage 3) the
// model receives it as compact JSON and tool enums are built from it.

export type CategoryId = "starters" | "mains" | "desserts" | "drinks";

export type Allergen = "dairy" | "gluten" | "nuts" | "egg" | "fish" | "soy";

export const ALLERGENS: readonly Allergen[] = ["dairy", "gluten", "nuts", "egg", "fish", "soy"];

export interface Category {
  id: CategoryId;
  name: string;
  description: string;
}

export interface MenuItem {
  id: string;
  category: CategoryId;
  name: string;
  /** Price in Indian rupees. */
  price: number;
  veg: boolean;
  /** 0 = not spicy, 3 = very spicy. */
  spiceLevel: 0 | 1 | 2 | 3;
  allergens: Allergen[];
  tags: string[];
  description: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: "starters", name: "Starters", description: "Small plates from the tandoor, the street and the bistro." },
  { id: "mains", name: "Mains", description: "Curries, grills and pastas to share or keep to yourself." },
  { id: "desserts", name: "Desserts", description: "Indian classics and continental favourites." },
  { id: "drinks", name: "Drinks", description: "Chai, lassi, coolers and coffee." },
];

export const MENU: readonly MenuItem[] = [
  // Starters
  {
    id: "paneer-tikka",
    category: "starters",
    name: "Paneer Tikka",
    price: 349,
    veg: true,
    spiceLevel: 2,
    allergens: ["dairy"],
    tags: ["tandoor", "popular", "high-protein", "gluten-free"],
    description: "Cottage cheese cubes marinated in hung yogurt and spices, chargrilled in the tandoor with peppers and onion.",
  },
  {
    id: "hara-bhara-kebab",
    category: "starters",
    name: "Hara Bhara Kebab",
    price: 279,
    veg: true,
    spiceLevel: 1,
    allergens: [],
    tags: ["vegan", "gluten-free", "light"],
    description: "Spinach, green pea and potato patties, pan-seared and served with mint chutney.",
  },
  {
    id: "chicken-65",
    category: "starters",
    name: "Chicken 65",
    price: 389,
    veg: false,
    spiceLevel: 3,
    allergens: ["egg"],
    tags: ["fried", "south-indian", "popular"],
    description: "Crisp fried chicken tossed with curry leaves, dried red chilli and garlic.",
  },
  {
    id: "dahi-puri",
    category: "starters",
    name: "Dahi Puri",
    price: 229,
    veg: true,
    spiceLevel: 1,
    allergens: ["dairy", "gluten"],
    tags: ["chaat", "street-food", "tangy"],
    description: "Crisp puris filled with potato, sweet yogurt, tamarind and green chutneys, topped with sev.",
  },
  {
    id: "tomato-bruschetta",
    category: "starters",
    name: "Tomato Bruschetta",
    price: 299,
    veg: true,
    spiceLevel: 0,
    allergens: ["gluten"],
    tags: ["continental", "vegan", "light"],
    description: "Toasted sourdough topped with marinated tomato, basil, garlic and extra-virgin olive oil.",
  },
  {
    id: "caesar-salad",
    category: "starters",
    name: "Caesar Salad",
    price: 329,
    veg: false,
    spiceLevel: 0,
    allergens: ["dairy", "gluten", "egg", "fish"],
    tags: ["continental", "salad"],
    description: "Romaine, parmesan and garlic croutons in a classic anchovy Caesar dressing.",
  },

  // Mains
  {
    id: "butter-chicken",
    category: "mains",
    name: "Butter Chicken",
    price: 499,
    veg: false,
    spiceLevel: 1,
    allergens: ["dairy", "nuts"],
    tags: ["signature", "curry", "popular"],
    description: "Tandoori chicken simmered in a silky tomato, butter and cashew gravy. Best with naan.",
  },
  {
    id: "dal-makhani",
    category: "mains",
    name: "Dal Makhani",
    price: 379,
    veg: true,
    spiceLevel: 1,
    allergens: ["dairy"],
    tags: ["curry", "comfort", "gluten-free"],
    description: "Black lentils and kidney beans slow-cooked overnight with butter and cream.",
  },
  {
    id: "lamb-rogan-josh",
    category: "mains",
    name: "Lamb Rogan Josh",
    price: 549,
    veg: false,
    spiceLevel: 2,
    allergens: ["dairy"],
    tags: ["kashmiri", "curry", "gluten-free"],
    description: "Tender lamb braised with Kashmiri chilli, fennel and yogurt.",
  },
  {
    id: "mushroom-risotto",
    category: "mains",
    name: "Wild Mushroom Risotto",
    price: 449,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy"],
    tags: ["continental", "gluten-free", "creamy"],
    description: "Arborio rice with porcini and button mushrooms, parmesan and a touch of truffle oil.",
  },
  {
    id: "grilled-fish",
    category: "mains",
    name: "Grilled Fish, Lemon Butter",
    price: 599,
    veg: false,
    spiceLevel: 0,
    allergens: ["fish", "dairy"],
    tags: ["continental", "gluten-free", "high-protein"],
    description: "Grilled basa fillet with lemon-caper butter, sautéed greens and mash.",
  },
  {
    id: "penne-alfredo",
    category: "mains",
    name: "Penne Alfredo",
    price: 389,
    veg: true,
    spiceLevel: 0,
    allergens: ["gluten", "dairy"],
    tags: ["continental", "pasta", "creamy"],
    description: "Penne in a garlic, cream and parmesan sauce with sautéed mushrooms.",
  },

  // Desserts
  {
    id: "gulab-jamun",
    category: "desserts",
    name: "Gulab Jamun",
    price: 199,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy", "gluten"],
    tags: ["classic", "warm"],
    description: "Two warm milk-solid dumplings soaked in cardamom and rose syrup.",
  },
  {
    id: "rasmalai",
    category: "desserts",
    name: "Rasmalai",
    price: 229,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy", "nuts"],
    tags: ["classic", "chilled", "gluten-free"],
    description: "Soft chenna discs in chilled saffron milk with pistachio.",
  },
  {
    id: "chocolate-lava-cake",
    category: "desserts",
    name: "Chocolate Lava Cake",
    price: 299,
    veg: true,
    spiceLevel: 0,
    allergens: ["gluten", "dairy", "egg"],
    tags: ["continental", "warm", "popular"],
    description: "Dark chocolate cake with a molten centre, served with vanilla ice cream.",
  },
  {
    id: "tiramisu",
    category: "desserts",
    name: "Tiramisu",
    price: 349,
    veg: true,
    spiceLevel: 0,
    allergens: ["gluten", "dairy", "egg"],
    tags: ["continental", "coffee", "chilled"],
    description: "Espresso-soaked savoiardi layered with mascarpone cream and cocoa.",
  },

  // Drinks
  {
    id: "masala-chai",
    category: "drinks",
    name: "Masala Chai",
    price: 99,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy"],
    tags: ["hot", "classic"],
    description: "Assam tea brewed with milk, ginger, cardamom and clove.",
  },
  {
    id: "mango-lassi",
    category: "drinks",
    name: "Mango Lassi",
    price: 179,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy"],
    tags: ["cold", "sweet", "popular"],
    description: "Alphonso mango blended with yogurt and a pinch of cardamom.",
  },
  {
    id: "fresh-lime-soda",
    category: "drinks",
    name: "Fresh Lime Soda",
    price: 129,
    veg: true,
    spiceLevel: 0,
    allergens: [],
    tags: ["cold", "vegan", "refreshing"],
    description: "Fresh lime with soda, served sweet, salted or mixed.",
  },
  {
    id: "cold-coffee",
    category: "drinks",
    name: "Cold Coffee",
    price: 199,
    veg: true,
    spiceLevel: 0,
    allergens: ["dairy"],
    tags: ["cold", "coffee"],
    description: "Chilled coffee blended with milk and a scoop of vanilla ice cream.",
  },
];

const ITEM_BY_ID = new Map(MENU.map((i) => [i.id, i]));
const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const ITEM_IDS: readonly string[] = MENU.map((i) => i.id);
export const ALL_TAGS: readonly string[] = [...new Set(MENU.flatMap((i) => i.tags))].sort();

export function getItem(id: string): MenuItem | undefined {
  return ITEM_BY_ID.get(id);
}

export function getCategory(id: string): Category | undefined {
  return CATEGORY_BY_ID.get(id as CategoryId);
}

export function itemsInCategory(id: CategoryId): MenuItem[] {
  return MENU.filter((i) => i.category === id);
}

export function formatPrice(inr: number): string {
  return `₹${inr.toLocaleString("en-IN")}`;
}
