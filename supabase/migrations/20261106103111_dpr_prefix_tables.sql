alter table public.accounting_outstanding      rename to dpr_accounting_outstanding;
alter table public.accounting_cvos             rename to dpr_accounting_cvos;
alter table public.accounting_pdc_due          rename to dpr_accounting_pdc_due;
alter table public.accounting_customer_summary rename to dpr_accounting_customer_summary;
alter table public.customer_master             rename to dpr_customer_master;
alter table public.pdc_sent                    rename to dpr_pdc_sent;

-- Function bodies reference tables by name, so rewrite them to the new names.
do $$
declare
  f record;
  d text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('accounting_sync','dpr_data','dpr_export_customers','dpr_pdc_sent_list',
                        'dpr_pdc_set_sent','dpr_report','refresh_accounting_customer_summary')
  loop
    d := pg_get_functiondef(f.oid);
    d := regexp_replace(d, '\maccounting_outstanding\M',      'dpr_accounting_outstanding', 'g');
    d := regexp_replace(d, '\maccounting_cvos\M',             'dpr_accounting_cvos', 'g');
    d := regexp_replace(d, '\maccounting_pdc_due\M',          'dpr_accounting_pdc_due', 'g');
    d := regexp_replace(d, '\maccounting_customer_summary\M', 'dpr_accounting_customer_summary', 'g');
    d := regexp_replace(d, '\mcustomer_master\M',             'dpr_customer_master', 'g');
    d := regexp_replace(d, '\mpdc_sent\M',                    'dpr_pdc_sent', 'g');
    execute d;
  end loop;
end $$;
