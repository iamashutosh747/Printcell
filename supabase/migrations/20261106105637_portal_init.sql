-- Print Cell portal: one login per person, linked to their existing app accounts.
create table public.portal_users (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text not null unique check (username ~ '^[a-z0-9._-]{2,32}$'),
  full_name      text not null check (length(trim(full_name)) > 0),
  is_admin       boolean not null default false,
  active         boolean not null default true,
  password_set   boolean not null default false,
  csrc_user_id   uuid unique references public.csrc_app_users(id) on delete set null,
  task_user_id   uuid unique references public.task_list_profiles(id) on delete set null,
  dpr_role       text check (dpr_role in ('full', 'pdc', 'agent')),
  dpr_agent_name text,
  dpr_can_export boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint portal_users_agent_needs_name
    check (dpr_role is distinct from 'agent' or nullif(trim(dpr_agent_name), '') is not null)
);
comment on table public.portal_users is
  'Portal (printcell.ashutosh-sharma.com) logins. Each row links one person to their CSRC account, Tasks account and DPR role. Written only by the portal-admin edge function.';

create table public.portal_activity (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.portal_users(id) on delete set null,
  username   text,
  event      text not null check (event in ('sign_in', 'open_csrc', 'open_tasks', 'open_dpr')),
  at         timestamptz not null default now(),
  user_agent text
);
create index portal_activity_at_idx on public.portal_activity (at desc);
create index portal_activity_user_idx on public.portal_activity (user_id, at desc);
comment on table public.portal_activity is 'Portal sign-ins and portal opens, newest first. Readable by portal admins.';

create trigger trg_portal_users_updated_at before update on public.portal_users
  for each row execute function public.set_updated_at();

create or replace function public.portal_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.portal_users where id = auth.uid() and active and is_admin);
$$;

alter table public.portal_users enable row level security;
alter table public.portal_activity enable row level security;

create policy "portal users read self, admins read all" on public.portal_users
  for select to authenticated using (id = auth.uid() or public.portal_is_admin());
create policy "portal admins read activity" on public.portal_activity
  for select to authenticated using (public.portal_is_admin());

revoke all on public.portal_users, public.portal_activity from anon;
revoke insert, update, delete on public.portal_users, public.portal_activity from authenticated;

-- Called by the portal page right after a successful sign-in.
create or replace function public.portal_log_sign_in(p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.portal_activity (user_id, username, event, user_agent)
  select id, username, 'sign_in', left(p_user_agent, 300)
  from public.portal_users where id = auth.uid() and active;
end $$;
revoke all on function public.portal_log_sign_in(text) from public, anon;
grant execute on function public.portal_log_sign_in(text) to authenticated;
revoke all on function public.portal_is_admin() from public, anon;
grant execute on function public.portal_is_admin() to authenticated;

-- DPR: accept a portal login (no access code, signed-in portal user) alongside access codes.
create or replace function dpr_private.auth(p_code text)
returns table(role text, agent_name text)
language sql security definer set search_path = public, extensions as $$
  (select a.role, a.agent_name
     from dpr_private.access_codes a
    where p_code is not null
      and a.code_hash = extensions.crypt(upper(trim(p_code)), a.code_hash)
    order by (a.role = 'full') desc, (a.role = 'pdc') desc
    limit 1)
  union all
  (select u.dpr_role, nullif(trim(u.dpr_agent_name), '')
     from public.portal_users u
    where p_code is null and u.id = auth.uid() and u.active and u.dpr_role is not null
    limit 1)
$$;

create or replace function dpr_private.can_export(p_code text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select bool_or(a.can_export) from dpr_private.access_codes a
                    where p_code is not null and a.code_hash = extensions.crypt(upper(trim(p_code)), a.code_hash)), false)
      or coalesce((select u.dpr_can_export from public.portal_users u
                    where p_code is null and u.id = auth.uid() and u.active and u.dpr_role is not null), false)
$$;
