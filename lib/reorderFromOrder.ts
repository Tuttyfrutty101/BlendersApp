import { supabase } from '@/supabase';
import type { CartItem } from '@/types/cart';
import type { OrderItemJson } from '@/types/order';

type SupplementRow = { id: string; name: string; price: number };

type AlterationRow = {
  id: string;
  name: string;
  price: number;
  type: 'add' | 'substitute' | 'remove' | 'request';
};

type MenuRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  image_url?: string | null;
  sizes: unknown;
  prices: unknown;
  alterations: unknown;
};

function normalizePrices(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n)) {
      out[k] = n;
    }
  }
  return out;
}

function normalizeAlterations(value: unknown): AlterationRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AlterationRow[] = [];
  value.forEach((entry, index) => {
    if (entry == null || typeof entry !== 'object') return;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const typeRaw = typeof row.type === 'string' ? row.type.trim().toLowerCase() : '';
    const p = typeof row.price === 'number' ? row.price : Number(row.price);
    if (!name) return;
    if (typeRaw !== 'add' && typeRaw !== 'substitute' && typeRaw !== 'remove' && typeRaw !== 'request') return;
    if (!Number.isFinite(p)) return;
    out.push({
      id: `${typeRaw}-${name.toLowerCase()}-${index}`,
      name,
      type: typeRaw as AlterationRow['type'],
      price: p,
    });
  });
  return out;
}

function normalizeSizes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => (typeof s === 'number' ? s : Number(s)))
    .filter((n) => Number.isFinite(n));
}

function priceForOz(prices: Record<string, number>, oz: number): number {
  return prices[String(oz)] ?? 0;
}

function formatAlterationLineForCart(alt: { name: string; price: number }): string {
  if (alt.price < 0) {
    return `${alt.name} -$${Math.abs(alt.price).toFixed(2)}`;
  }
  if (alt.price === 0) {
    return `${alt.name} (Free)`;
  }
  return `${alt.name} (+$${alt.price.toFixed(2)})`;
}

/** Parse cart strings like "Spinach" or "Spinach x2". */
function parseSupplementCartString(s: string): { name: string; qty: number } {
  const trimmed = s.trim();
  const lastX = trimmed.toLowerCase().lastIndexOf(' x');
  if (lastX !== -1) {
    const qtyStr = trimmed.slice(lastX + 2).trim();
    const q = Number(qtyStr);
    if (Number.isFinite(q) && q > 0) {
      return { name: trimmed.slice(0, lastX).trim(), qty: q };
    }
  }
  return { name: trimmed, qty: 1 };
}

function supplementCost(
  selections: Record<string, number>,
  orderIds: string[],
  supplementsDb: SupplementRow[],
): number {
  const byId = new Map(supplementsDb.map((s) => [s.id, s]));
  const entries = orderIds
    .map((id) => ({
      id,
      quantity: selections[id] ?? 0,
      price: byId.get(id)?.price ?? 0,
    }))
    .filter((e) => e.quantity > 0);
  const freeId = orderIds.find((id) => (selections[id] ?? 0) > 0) ?? entries[0]?.id ?? null;
  return entries.reduce((sum, sup) => {
    const freeUnits = sup.id === freeId ? 1 : 0;
    const paidUnits = Math.max(0, sup.quantity - freeUnits);
    return sum + paidUnits * sup.price;
  }, 0);
}

function matchAlterationLineToIds(lines: string[], menuAlts: AlterationRow[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const found =
      menuAlts.find((a) => line.includes(a.name)) ??
      menuAlts.find((a) => stripped.startsWith(a.name) || stripped.includes(a.name));
    if (found) ids.push(found.id);
  }
  return ids;
}

function normalizeMenuRow(row: MenuRow) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    imageUrl: typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url : null,
    sizes: normalizeSizes(row.sizes),
    prices: normalizePrices(row.prices),
    alterations: normalizeAlterations(row.alterations),
  };
}

/**
 * Rebuild cart lines from stored order JSON using current menu + supplement prices.
 */
export async function buildCartItemsFromOrderItems(
  rawItems: unknown,
  orderIdForIds: string,
): Promise<CartItem[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return [];
  }
  const lines = rawItems as OrderItemJson[];

  const { data: supplementsDb, error: supErr } = await supabase
    .from('supplements')
    .select('id, name, price')
    .order('name');
  if (supErr || !supplementsDb) {
    console.error('reorder: supplements', supErr);
    return [];
  }
  const supplementsList = supplementsDb as SupplementRow[];

  const menuIds = [
    ...new Set(lines.map((l) => l.menu_item_id).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];
  if (menuIds.length === 0) {
    return [];
  }

  const { data: menuRows, error: menuErr } = await supabase
    .from('menu_items')
    .select('id, name, category, description, image_url, sizes, prices, alterations')
    .in('id', menuIds);
  if (menuErr || !menuRows?.length) {
    console.error('reorder: menu_items', menuErr);
    return [];
  }

  const menuById = new Map(menuRows.map((r) => [r.id, normalizeMenuRow(r as MenuRow)]));

  const needsJuice = lines.some((l) => {
    const m = l.menu_item_id ? menuById.get(l.menu_item_id) : undefined;
    return m?.category === 'juice' && l.name.trim().startsWith('Juice (');
  });

  let juiceNameToId = new Map<string, string>();
  if (needsJuice) {
    const { data: juiceRows } = await supabase
      .from('menu_items')
      .select('id, name')
      .eq('category', 'juice');
    juiceNameToId = new Map(
      (juiceRows ?? []).map((r: { id: string; name: string }) => [r.name.trim().toLowerCase(), r.id]),
    );
  }

  const out: CartItem[] = [];
  let lineIndex = 0;
  for (const line of lines) {
    const mid = line.menu_item_id;
    if (!mid) continue;
    const menuItem = menuById.get(mid);
    if (!menuItem) continue;

    const supplementStrings = Array.isArray(line.supplements) ? line.supplements : [];
    const alterationStrings = Array.isArray(line.alterations) ? line.alterations : [];

    const selections: Record<string, number> = {};
    const orderIds: string[] = [];
    for (const s of supplementStrings) {
      const { name, qty } = parseSupplementCartString(s);
      const sup = supplementsList.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!sup) continue;
      selections[sup.id] = (selections[sup.id] ?? 0) + qty;
      if (!orderIds.includes(sup.id)) orderIds.push(sup.id);
    }

    const base = priceForOz(menuItem.prices, line.size);
    const supCost = supplementCost(selections, orderIds, supplementsList);

    const altIds = matchAlterationLineToIds(alterationStrings, menuItem.alterations);
    const altCost = menuItem.alterations.filter((a) => altIds.includes(a.id)).reduce((s, a) => s + a.price, 0);

    const supplementDisplay = orderIds
      .map((id) => {
        const q = selections[id] ?? 0;
        if (q <= 0) return null;
        const name = supplementsList.find((s) => s.id === id)?.name ?? id;
        return q > 1 ? `${name} x${q}` : name;
      })
      .filter((s): s is string => s != null);

    const alterationDisplay = menuItem.alterations
      .filter((a) => altIds.includes(a.id))
      .map((a) => formatAlterationLineForCart(a));

    let juiceBuildFromMenuCard = false;
    let juiceIngredientIds: string[] | undefined;
    if (menuItem.category === 'juice' && line.name.trim().startsWith('Juice (')) {
      juiceBuildFromMenuCard = true;
      const inner = line.name.match(/^Juice\s*\(([^)]+)\)/)?.[1];
      if (inner) {
        juiceIngredientIds = inner
          .split(',')
          .map((x) => x.trim())
          .map((n) => juiceNameToId.get(n.toLowerCase()))
          .filter((id): id is string => typeof id === 'string');
      }
    }

    const total = Number((base + supCost + altCost).toFixed(2));

    const cartLine: CartItem = {
      id: `reorder-${orderIdForIds}-${lineIndex}-${Date.now()}`,
      name: menuItem.name,
      size: line.size,
      supplements: supplementDisplay,
      alterations: alterationDisplay,
      specialInstructions: line.special_instructions ?? undefined,
      price: total,
      imageUrl: menuItem.imageUrl,
      menuItemId: menuItem.id,
      juiceBuildFromMenuCard,
      supplementSelections: Object.keys(selections).length ? selections : undefined,
      supplementSelectionOrder: orderIds.length ? orderIds : undefined,
      alterationIds: altIds.length ? altIds : undefined,
      juiceIngredientIds,
    };

    if (juiceBuildFromMenuCard && line.name.trim().startsWith('Juice (')) {
      cartLine.name = line.name.trim();
    }

    out.push(cartLine);
    lineIndex += 1;
  }

  return out;
}
