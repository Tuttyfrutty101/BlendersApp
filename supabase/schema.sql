-- Enable UUID generation helpers.
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  rewards_points integer not null default 0,
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
  price_small numeric(10, 2) not null,
  price_large numeric(10, 2) not null,
  is_featured boolean not null default false,
  is_popular boolean not null default false,
  image_url text
);

create index if not exists idx_menu_items_category on public.menu_items(category);
create index if not exists idx_menu_items_featured on public.menu_items(is_featured);
create index if not exists idx_menu_items_popular on public.menu_items(is_popular);

