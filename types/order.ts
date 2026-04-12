/** One line stored in public.orders.items (jsonb). */
export type OrderItemJson = {
  name: string;
  size: number;
  supplements?: string[];
  alterations?: string[];
  special_instructions?: string | null;
  price: number;
  menu_item_id?: string | null;
  image_url?: string | null;
};

export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'completed';

export type OrderRow = {
  id: string;
  user_id: string;
  store_id: string;
  items: OrderItemJson[];
  total: number;
  status: OrderStatus;
  created_at: string;
  stores: { name: string; address: string } | null;
};
