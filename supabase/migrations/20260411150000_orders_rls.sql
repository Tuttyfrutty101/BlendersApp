-- Allow authenticated users to read and create their own orders (matches auth.users.id = public.users.id).

alter table public.orders enable row level security;

drop policy if exists "Users can read own orders" on public.orders;
drop policy if exists "Users can insert own orders" on public.orders;

create policy "Users can read own orders"
  on public.orders
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert own orders"
  on public.orders
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
