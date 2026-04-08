begin;

create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10, 2) not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_supplements_name on public.supplements (name);

alter table public.supplements enable row level security;

create policy "Supplements are readable by anyone"
  on public.supplements
  for select
  using (true);

commit;
