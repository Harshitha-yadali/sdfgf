alter table public.menu_items
add column if not exists is_non_veg boolean not null default false;

comment on column public.menu_items.is_non_veg is 'Whether the item should display a non-veg badge in customer-facing menus.';
