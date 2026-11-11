alter table public.dpr_accounting_cvos             rename to dpr_outstanding_bills;
alter table public.dpr_accounting_pdc_due          rename to dpr_pending_cheques;
alter table public.dpr_accounting_customer_summary rename to dpr_customer_summary;
alter table public.dpr_accounting_outstanding      rename to dpr_customer_balances;
alter table public.dpr_customer_master             rename to dpr_customers;
alter table public.dpr_pdc_sent                    rename to dpr_cheques_sent;

comment on table public.dpr_outstanding_bills is 'DPR: unpaid bills per customer, one snapshot per report_date (synced from accounting CVOS report).';
comment on table public.dpr_pending_cheques   is 'DPR: post-dated cheques (PDC) not yet due/cleared, one snapshot per report_date.';
comment on table public.dpr_customer_summary  is 'DPR: per-customer totals and status colour, rebuilt by refresh_accounting_customer_summary().';
comment on table public.dpr_customer_balances is 'DPR: legacy per-customer balances, used only by dpr_report().';
comment on table public.dpr_customers         is 'DPR: customer master list (code, name, agent, credit days/limit).';
comment on table public.dpr_cheques_sent      is 'DPR: cheques marked as sent to bank, by date.';

do $$
declare
  f record;
  d text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('accounting_sync','dpr_data','dpr_export_customers','dpr_pdc_sent_list',
                        'dpr_pdc_set_sent','dpr_report','refresh_accounting_customer_summary')
  loop
    d := pg_get_functiondef(f.oid);
    d := regexp_replace(d, '\mdpr_accounting_cvos\M',             'dpr_outstanding_bills', 'g');
    d := regexp_replace(d, '\mdpr_accounting_pdc_due\M',          'dpr_pending_cheques', 'g');
    d := regexp_replace(d, '\mdpr_accounting_customer_summary\M', 'dpr_customer_summary', 'g');
    d := regexp_replace(d, '\mdpr_accounting_outstanding\M',      'dpr_customer_balances', 'g');
    d := regexp_replace(d, '\mdpr_customer_master\M',             'dpr_customers', 'g');
    d := regexp_replace(d, '\mdpr_pdc_sent\M',                    'dpr_cheques_sent', 'g');
    execute d;
  end loop;
end $$;
