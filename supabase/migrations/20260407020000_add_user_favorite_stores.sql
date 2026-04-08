begin;

alter table public.users
  add column if not exists favorite_store_ids uuid[] not null default '{}'::uuid[];

commit;
