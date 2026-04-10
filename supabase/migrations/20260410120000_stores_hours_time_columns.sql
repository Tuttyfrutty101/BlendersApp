-- Replace text hour ranges with TIME columns. Existing rows: weekday 7:00–22:00, weekend 8:00–22:00.

begin;

alter table public.stores
  add column open_weekday time,
  add column close_weekday time,
  add column open_weekend time,
  add column close_weekend time;

update public.stores
set
  open_weekday = time '07:00',
  close_weekday = time '22:00',
  open_weekend = time '08:00',
  close_weekend = time '22:00';

alter table public.stores
  alter column open_weekday set not null,
  alter column close_weekday set not null,
  alter column open_weekend set not null,
  alter column close_weekend set not null;

alter table public.stores
  drop column hours_weekday,
  drop column hours_weekend;

commit;
