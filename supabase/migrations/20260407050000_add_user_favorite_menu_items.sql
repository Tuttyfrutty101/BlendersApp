begin;

alter table public.users
  add column if not exists favorite_menu_item_ids uuid[] not null default '{}'::uuid[];

commit;
