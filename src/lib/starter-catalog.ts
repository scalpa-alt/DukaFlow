import { supabase } from "@/integrations/supabase/client";
import { makeInternalBarcode } from "@/lib/shop";

// Sample Kenyan shop items (name, category, sample price KSh). Owners edit prices after loading.
export const STARTER_ITEMS: [string, string, number][] = [
  ["Maize flour (Unga) 2kg", "Staples", 190], ["Wheat flour 2kg", "Staples", 200], ["White sugar 1kg", "Staples", 190],
  ["Rice (Pishori) 1kg", "Staples", 260], ["Cooking oil 1L", "Staples", 330], ["Salt 500g", "Staples", 40],
  ["Tea leaves 250g", "Staples", 120], ["Ground coffee 250g", "Staples", 450], ["Beans 1kg", "Staples", 200],
  ["Spaghetti 500g", "Staples", 120], ["Fresh milk 500ml", "Dairy & Bakery", 70], ["Long-life milk 1L", "Dairy & Bakery", 130],
  ["Bread (white, 400g)", "Dairy & Bakery", 65], ["Eggs (tray of 30)", "Dairy & Bakery", 480], ["Butter 250g", "Dairy & Bakery", 350],
  ["Soda 500ml", "Beverages", 60], ["Bottled water 500ml", "Beverages", 40], ["Juice 1L", "Beverages", 180],
  ["Bar soap 800g", "Household", 230], ["Laundry detergent 1kg", "Household", 260], ["Toilet paper (4 rolls)", "Household", 150],
  ["Matchbox", "Household", 10], ["Charcoal 2kg", "Household", 100], ["Paraffin 1L", "Household", 200],
  ["Toothpaste 100ml", "Personal Care", 150], ["Body lotion 400ml", "Personal Care", 400], ["Sanitary pads (8s)", "Personal Care", 100],
  ["Roll-on deodorant", "Personal Care", 250], ["Exercise book 96pg", "Stationery", 50], ["Ballpoint pen (blue)", "Stationery", 20],
  ["Airtime scratch card KES 100", "Mobile", 100], ["Phone charger (USB)", "Electronics", 600], ["AA batteries (2 pack)", "Electronics", 120],
];

/** Adds starter items the shop doesn't already have (matched by name). Stock starts at 0. */
export async function loadStarterCatalog(existingNames: string[]): Promise<number> {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const rows = STARTER_ITEMS.filter(([n]) => !have.has(n.toLowerCase())).map(([name, category, price]) => ({
    name, category, price, quantity: 0, barcode: makeInternalBarcode(), barcode_internal: true,
  }));
  if (!rows.length) return 0;
  const { error } = await supabase.from("products").insert(rows);
  if (error) throw error;
  return rows.length;
}
