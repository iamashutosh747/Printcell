-- Portal home cards: one call returns a summary of every app the signed-in person is linked to.
create or replace function public.portal_home()
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  me     public.portal_users;
  v_today date := (now() at time zone 'Asia/Kathmandu')::date;
  v_task public.task_list_profiles;
  v_csrc public.csrc_app_users;
  v_fy   text;
  v_cov  json;
  v_out  jsonb;
begin
  select * into me from public.portal_users where id = auth.uid() and active;
  if not found then return null; end if;
  v_out := jsonb_build_object('today', v_today);

  -- Tasks: this person's own tasks and their completions in the Tasks app's Today window (45 back, 7 ahead).
  select * into v_task from public.task_list_profiles where id = me.task_user_id and active;
  if found then
    v_out := v_out || jsonb_build_object('tasks', jsonb_build_object(
      'is_admin', v_task.role = 'admin',
      'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'company', t.company,
                  'rule', t.rule, 'start_date', t.start_date, 'active', t.active) order by t.name)
                from public.task_list_tasks t where t.active and v_task.id = any (t.maker_ids)), '[]'::jsonb),
      'completions', coalesce((select jsonb_agg(jsonb_build_object('task_id', c.task_id, 'due_date', c.due_date,
                  'status', c.status, 'admin_note', c.admin_note))
                from public.task_list_completions c join public.task_list_tasks t on t.id = c.task_id
                where v_task.id = any (t.maker_ids) and c.due_date between v_today - 45 and v_today + 7), '[]'::jsonb),
      'to_review', case when v_task.role = 'admin'
                   then (select count(*) from public.task_list_completions where status = 'submitted') end));
  end if;

  -- CSRC: today's calls (managers see all, engineers their own), plus overdue counts.
  select * into v_csrc from public.csrc_app_users where id = me.csrc_user_id and active;
  if found then
    v_out := v_out || jsonb_build_object('csrc', jsonb_build_object(
      'role', v_csrc.role,
      'calls', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'type', s.type, 'status', s.status,
                  'customer', c.name, 'from', s.hours_from, 'to', s.hours_to,
                  'engineers', (select string_agg(e.name, ', ' order by e.name) from public.csrc_service_engineers se
                                join public.csrc_engineers e on e.id = se.engineer_id where se.service_id = s.id))
                  order by s.status desc, s.hours_from nulls last, c.name)
                from public.csrc_services s join public.csrc_customers c on c.id = s.customer_id
                where (s.scheduled_date = v_today or (s.status = 'completed' and s.actual_date = v_today))
                  and (v_csrc.role = 'manager' or exists (select 1 from public.csrc_service_engineers se
                        where se.service_id = s.id and se.engineer_id = v_csrc.engineer_id))), '[]'::jsonb),
      'overdue_calls', (select count(*) from public.csrc_services s
                where s.status = 'scheduled' and s.scheduled_date < v_today
                  and (v_csrc.role = 'manager' or exists (select 1 from public.csrc_service_engineers se
                        where se.service_id = s.id and se.engineer_id = v_csrc.engineer_id))),
      'visits_due', case when v_csrc.role = 'manager'
                   then (select count(*) from public.csrc_customer_schedule where active and next_due_date <= v_today) end));
  end if;

  -- DPR: customers by status (full / agent), and cheques due (full / pdc).
  if me.dpr_role is not null then
    v_out := v_out || jsonb_build_object('dpr', jsonb_build_object(
      'role', me.dpr_role, 'agent', me.dpr_agent_name,
      'report_date', (select max(report_date) from public.dpr_customer_summary),
      'statuses', case when me.dpr_role in ('full', 'agent') then coalesce((
                  select jsonb_agg(jsonb_build_object('status', x.status, 'n', x.n, 'due', x.due))
                  from (select s.status, count(*) n, sum(s.total_due) due
                        from public.dpr_customer_summary s left join public.dpr_customers m on m.cust_code = s.gl_code
                        where me.dpr_role = 'full' or nullif(trim(m.agent_name), '') = me.dpr_agent_name
                        group by s.status) x), '[]'::jsonb) end,
      'cheques', case when me.dpr_role in ('full', 'pdc') then (
                  select jsonb_build_object('overdue', count(*) filter (where p.cheque_date < v_today),
                         'today', count(*) filter (where p.cheque_date = v_today),
                         'tomorrow', count(*) filter (where p.cheque_date = v_today + 1))
                  from public.dpr_pending_cheques p
                  where p.report_date = (select max(report_date) from public.dpr_pending_cheques)) end));
  end if;

  -- Coverage: cost centres sent more toner than their usage explains (Red), plus ones to watch (Amber).
  if me.coverage_user is not null and exists (select 1 from public.cov_users where username = me.coverage_user and active) then
    select code into v_fy from public.cov_fy where v_today between start_date and end_date limit 1;
    if v_fy is not null then
      v_cov := public.cov_dispatch_compare((select value from public.cov_settings where key = 'dashboard_token'), v_fy, null);
      v_out := v_out || jsonb_build_object('coverage', jsonb_build_object(
        'fy', v_fy, 'cutoff', v_cov ->> 'cutoff',
        'rows', coalesce((select jsonb_agg(jsonb_build_object('cost_centre', x ->> 'cost_centre', 'part', x ->> 'part',
                    'issued', (x ->> 'issued')::numeric, 'expected', (x ->> 'expected')::numeric,
                    'excess', (x ->> 'excess')::numeric, 'status', x ->> 'status'))
                  from json_array_elements(v_cov -> 'rows') x where x ->> 'status' in ('RED', 'AMBER')), '[]'::jsonb)));
    end if;
  end if;

  return v_out;
end $$;

-- Tick a task from the portal: submit it for approval exactly as the Tasks app does, acting as the
-- person's linked Tasks account so the Tasks app's own guard trigger applies unchanged.
create or replace function public.portal_task_submit(p_task uuid, p_due date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prof uuid; v_claims text; v_row public.task_list_completions;
begin
  select u.task_user_id into v_prof from public.portal_users u
    join public.task_list_profiles t on t.id = u.task_user_id
   where u.id = auth.uid() and u.active and t.active;
  if v_prof is null then raise exception 'You don''t have Tasks access.' using errcode = '42501'; end if;
  if not exists (select 1 from public.task_list_tasks where id = p_task and active and v_prof = any (maker_ids)) then
    raise exception 'This task is assigned to someone else.' using errcode = '42501';
  end if;
  if p_due is null or p_due > (now() at time zone 'Asia/Kathmandu')::date + 7 then
    raise exception 'That date can''t be submitted yet.';
  end if;

  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_prof, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_prof::text, true);
  insert into public.task_list_completions (task_id, due_date, status, submitted_by, submitted_at, maker_note)
  values (p_task, p_due, 'submitted', v_prof, now(), '')
  on conflict (task_id, due_date) do update
    set status = 'submitted', submitted_by = excluded.submitted_by, submitted_at = excluded.submitted_at
  returning * into v_row;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', '', true);
  return jsonb_build_object('task_id', v_row.task_id, 'due_date', v_row.due_date, 'status', v_row.status);
end $$;

-- Untick: withdraw a submission that is still waiting for approval (same rule as the Tasks app).
create or replace function public.portal_task_unsubmit(p_task uuid, p_due date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_prof uuid; v_n integer;
begin
  select u.task_user_id into v_prof from public.portal_users u
    join public.task_list_profiles t on t.id = u.task_user_id
   where u.id = auth.uid() and u.active and t.active;
  if v_prof is null then raise exception 'You don''t have Tasks access.' using errcode = '42501'; end if;
  delete from public.task_list_completions
   where task_id = p_task and due_date = p_due and status = 'submitted' and submitted_by = v_prof;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke all on function public.portal_home() from public, anon;
revoke all on function public.portal_task_submit(uuid, date) from public, anon;
revoke all on function public.portal_task_unsubmit(uuid, date) from public, anon;
grant execute on function public.portal_home() to authenticated;
grant execute on function public.portal_task_submit(uuid, date) to authenticated;
grant execute on function public.portal_task_unsubmit(uuid, date) to authenticated;
