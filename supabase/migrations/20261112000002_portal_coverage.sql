-- Portal: link each person to their Toner Coverage account (cov_users) and expose it to the coverage site.
alter table public.portal_users
  add column if not exists coverage_user text unique references public.cov_users(username) on delete set null;

-- Allow the new activity event.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.portal_activity'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sign_in%';
  if c is not null then execute format('alter table public.portal_activity drop constraint %I', c); end if;
end $$;
alter table public.portal_activity add constraint portal_activity_event_check
  check (event in ('sign_in', 'open_csrc', 'open_tasks', 'open_dpr', 'open_coverage'));

-- The signed-in person's portal row plus the roles of their linked app accounts.
create or replace function public.portal_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'full_name', u.full_name,
    'is_admin', u.is_admin, 'active', u.active,
    'csrc', case when c.id is not null and c.active then jsonb_build_object('role', c.role) end,
    'tasks', case when t.id is not null and t.active then jsonb_build_object('role', t.role) end,
    'dpr', case when u.dpr_role is not null then jsonb_build_object(
             'role', u.dpr_role, 'agent_name', u.dpr_agent_name, 'can_export', u.dpr_can_export) end,
    'coverage', case when cv.username is not null and cv.active then jsonb_build_object('username', cv.username) end)
  from public.portal_users u
  left join public.csrc_app_users c on c.id = u.csrc_user_id
  left join public.task_list_profiles t on t.id = u.task_user_id
  left join public.cov_users cv on cv.username = u.coverage_user
  where u.id = auth.uid()
$$;

-- Called by the coverage site, with the signed-in person's own token, to learn who they are there.
-- Returns nothing unless the portal login is active and linked to an active coverage account.
create or replace function public.portal_coverage_identity()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('username', cv.username, 'name', coalesce(cv.full_name, cv.username))
  from public.portal_users u
  join public.cov_users cv on cv.username = u.coverage_user
  where u.id = auth.uid() and u.active and cv.active
$$;
revoke all on function public.portal_coverage_identity() from public, anon;
grant execute on function public.portal_coverage_identity() to authenticated;
revoke all on function public.portal_me() from public, anon;
grant execute on function public.portal_me() to authenticated;
