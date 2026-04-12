import type { CartItem } from '@/types/cart';

export type PendingReorder = {
  items: CartItem[];
  /** When set, order tab selects this store and opens checkout. */
  storeId: string | null;
};

let pending: PendingReorder | null = null;

export function enqueueReorderItems(items: CartItem[], storeId?: string | null) {
  pending = {
    items: items.map((line) => ({ ...line, id: line.id })),
    storeId: storeId ?? null,
  };
}

export function consumePendingReorder(): PendingReorder | null {
  const p = pending;
  pending = null;
  return p;
}
