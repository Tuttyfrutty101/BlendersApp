-- Replace fixed small/large prices with per-size pricing.
-- Existing rows are migrated to 12 oz / 24 oz using the former price_small / price_large values.

begin;

alter table public.menu_items
  add column if not exists sizes integer[];

alter table public.menu_items
  add column if not exists prices jsonb;

update public.menu_items
set
  sizes = array[12, 24]::integer[],
  prices = jsonb_build_object('12', price_small, '24', price_large)
where sizes is null
  and price_small is not null
  and price_large is not null;

alter table public.menu_items
  alter column sizes set not null;

alter table public.menu_items
  alter column prices set not null;

alter table public.menu_items
  drop column if exists price_small;

alter table public.menu_items
  drop column if exists price_large;

alter table public.menu_items
  add constraint menu_items_sizes_nonempty check (cardinality(sizes) > 0);

commit;
