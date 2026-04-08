begin;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  hours_weekday text not null,
  hours_weekend text not null,
  phone text,
  latitude numeric,
  longitude numeric,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_stores_name on public.stores(name);

commit;
