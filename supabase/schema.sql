-- Enable UUID generation helpers.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  rewards_points integer not null default 0,
  favorite_store_ids uuid[] not null default '{}'::uuid[],
  favorite_menu_item_ids uuid[] not null default '{}'::uuid[],
  created_at timestamp with time zone not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  location text not null,
  items jsonb not null default '[]'::jsonb,
  total numeric(10, 2) not null,
  status text not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_orders_created_at on public.orders(created_at desc);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (
    category in ('smoothie', 'bowl', 'shot', 'juice', 'focused health blend')
  ),
  description text not null,
  sizes integer[] not null check (cardinality(sizes) > 0),
  prices jsonb not null,
  featured boolean not null default false,
  image_url text
);

create index if not exists idx_menu_items_category on public.menu_items(category);

create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10, 2) not null,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_supplements_name on public.supplements (name);

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

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  open_weekday time not null,
  close_weekday time not null,
  open_weekend time not null,
  close_weekend time not null,
  phone text,
  latitude numeric,
  longitude numeric,
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_stores_name on public.stores(name);

