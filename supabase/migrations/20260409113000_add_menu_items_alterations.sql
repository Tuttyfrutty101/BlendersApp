alter table public.menu_items
add column if not exists alterations jsonb default null;

alter table public.menu_items
drop constraint if exists menu_items_alterations_shape_check;

create or replace function public.menu_item_alterations_valid(payload jsonb)
returns boolean
language sql
immutable
as $$
  select
    payload is null
    or (
      jsonb_typeof(payload) = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(payload) as elem
        where not (
          jsonb_typeof(elem) = 'object'
          and elem ? 'name'
          and elem ? 'price'
          and elem ? 'type'
          and jsonb_typeof(elem->'name') = 'string'
          and jsonb_typeof(elem->'price') = 'number'
          and jsonb_typeof(elem->'type') = 'string'
          and elem->>'type' in ('add', 'substitute', 'remove')
        )
      )
    );
$$;

alter table public.menu_items
add constraint menu_items_alterations_shape_check
check (public.menu_item_alterations_valid(alterations));
