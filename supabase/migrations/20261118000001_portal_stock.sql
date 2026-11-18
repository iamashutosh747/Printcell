-- Portal: Stock access (stock.ashutosh-sharma.com, the stock-reorder repo).
-- Each person gets one Stock level, or none:
--   stock = Stock, Reorder and Pipeline pages, view only (no sales or customer figures)
--   view  = every report, view only
--   full  = every report, plus imports, settings and pipeline edits
alter table public.portal_users
  add column if not exists stock_role text check (stock_role in ('stock', 'view', 'full'));

alter table public.portal_activity drop constraint if exists portal_activity_event_check;
alter table public.portal_activity add constraint portal_activity_event_check
  check (event in ('sign_in', 'open_csrc', 'open_tasks', 'open_dpr', 'open_coverage', 'open_stock'));

-- The signed-in person's portal row plus the roles of their linked app accounts (now with Stock).
create or replace function public.portal_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'full_name', u.full_name,
    'is_admin', u.is_admin, 'active', u.active,
    'csrc', case when c.id is not null and c.active then jsonb_build_object('role', c.role) end,
    'tasks', case when t.id is not null and t.active then jsonb_build_object('role', t.role) end,
    'dpr', case when u.dpr_role is not null then jsonb_build_object(
             'role', u.dpr_role, 'agent_name', u.dpr_agent_name, 'can_export', u.dpr_can_export) end,
    'coverage', case when cv.username is not null and cv.active then jsonb_build_object('username', cv.username) end,
    'stock', case when u.stock_role is not null then jsonb_build_object('role', u.stock_role) end)
  from public.portal_users u
  left join public.csrc_app_users c on c.id = u.csrc_user_id
  left join public.task_list_profiles t on t.id = u.task_user_id
  left join public.cov_users cv on cv.username = u.coverage_user
  where u.id = auth.uid()
$$;
revoke all on function public.portal_me() from public, anon;
grant execute on function public.portal_me() to authenticated;
