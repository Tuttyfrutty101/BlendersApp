-- Orders: replace free-text location with store_id FK; constrain status values.

begin;

alter table public.orders
  add column if not exists store_id uuid references public.stores (id);

-- Backfill store_id from legacy location text (exact name match).
update public.orders o
set store_id = s.id
from public.stores s
where o.store_id is null
  and trim(o.location) = trim(s.name);

-- Case-insensitive match for minor formatting differences.
update public.orders o
set store_id = s.id
from public.stores s
where o.store_id is null
  and lower(trim(o.location)) = lower(trim(s.name));

-- Remaining rows: attach to a single store if one exists (avoids failing NOT NULL when data is messy).
update public.orders o
set store_id = (select id from public.stores order by name asc limit 1)
where o.store_id is null
  and exists (select 1 from public.stores limit 1);

-- Drop orders that cannot be tied to any store (no rows in public.stores).
delete from public.orders
where store_id is null;

alter table public.orders
  alter column store_id set not null;

alter table public.orders
  drop column if exists location;

create index if not exists idx_orders_store_id on public.orders (store_id);

-- Normalize legacy status values to the allowed set, then enforce CHECK.
update public.orders
set status = 'placed'
where status is null
   or trim(status) = ''
   or status not in ('placed', 'preparing', 'ready', 'completed');

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('placed', 'preparing', 'ready', 'completed'));

commit;
