-- Already applied to the Scnts_Database project. Run only if you rebuild the database.
create table if not exists public.payment_accounts (
  method text primary key check (method in ('gcash','maribank','gotyme')),
  label text not null,
  account_name text not null default '',
  account_number text not null default '',
  qr_url text,
  instructions text,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.payment_accounts enable row level security;
insert into public.payment_accounts (method,label) values ('gcash','GCash'),('maribank','MariBank'),('gotyme','GoTyme') on conflict do nothing;

alter table public.orders
  add column if not exists payment_method text check (payment_method in ('gcash','maribank','gotyme')),
  add column if not exists payment_reference text,
  add column if not exists payment_status text not null default 'unpaid' check (payment_status in ('unpaid','submitted','confirmed','rejected')),
  add column if not exists paid_at timestamptz;
alter table public.sales add column if not exists payment_reference text;
