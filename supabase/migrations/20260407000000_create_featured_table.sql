-- Replace menu_items featured/popular flags with dedicated featured table.
begin;

create table if not exists public.featured (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_featured_menu_item_id on public.featured(menu_item_id);
create index if not exists idx_featured_display_order on public.featured(display_order);

drop index if exists public.idx_menu_items_featured;
drop index if exists public.idx_menu_items_popular;

alter table public.menu_items
  drop column if exists is_featured,
  drop column if exists is_popular;

commit;
