-- ===============================
-- LAC Dashboard tables + RLS
-- ===============================

-- 1) WEEKLY REPORTS (snapshot)
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  snapshot_json jsonb not null,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

-- 2) DAILY UPDATES
create table if not exists public.daily_updates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  system_key text not null default 'General',
  title text not null,
  details text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

-- Helpful index
create index if not exists daily_updates_date_idx on public.daily_updates (date);

-- Enable RLS
alter table public.weekly_reports enable row level security;
alter table public.daily_updates enable row level security;

-- Policies assume you already have public."User" with auth_uid, role, is_active

-- READ: ADMIN or PRESIDENT can read
create policy "weekly_reports_read_admin_president"
on public.weekly_reports
for select
using (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role in ('ADMIN','PRESIDENT')
  )
);

create policy "daily_updates_read_admin_president"
on public.daily_updates
for select
using (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role in ('ADMIN','PRESIDENT')
  )
);

-- WRITE: ADMIN only (insert/update/delete)
create policy "weekly_reports_write_admin"
on public.weekly_reports
for all
using (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role = 'ADMIN'
  )
)
with check (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role = 'ADMIN'
  )
);

create policy "daily_updates_write_admin"
on public.daily_updates
for all
using (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role = 'ADMIN'
  )
)
with check (
  exists (
    select 1
    from public."User" u
    where u.auth_uid = auth.uid()
      and u.is_active = true
      and u.role = 'ADMIN'
  )
);
