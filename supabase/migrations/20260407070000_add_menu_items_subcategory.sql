alter table public.menu_items
add column if not exists subcategory text;

alter table public.menu_items
drop constraint if exists menu_items_smoothie_subcategory_check;

alter table public.menu_items
add constraint menu_items_smoothie_subcategory_check
check (
  subcategory is null
  or category <> 'smoothie'
  or subcategory in ('juicy', 'creamy', 'powerful', 'tropical', 'secret')
);

create index if not exists idx_menu_items_subcategory on public.menu_items(subcategory);
