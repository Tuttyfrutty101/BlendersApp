begin;

alter table public.menu_items
  add column if not exists featured boolean not null default false;

create index if not exists idx_menu_items_featured on public.menu_items(featured);

commit;
