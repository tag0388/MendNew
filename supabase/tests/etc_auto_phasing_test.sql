-- ============================================================================
-- apply_etc_auto_phasing
--
-- The forecast-window rule used to live in src/lib/phasing.ts with its own
-- test file. It is SQL now, so its tests are here.
--
-- Run:  psql "$DATABASE_URL" -f supabase/tests/etc_auto_phasing_test.sql
-- Every line prints PASS or FAIL; nothing is left behind.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

create temporary table results (label text, expected text, actual text) on commit drop;

do $$
declare
  p uuid; cc uuid; cal uuid; d uuid;
  win_start date; cur_end date; range_end date;
  wd_range int; wd_month int;
begin
  select project_id into p from reporting_periods where kind = 'cost' group by project_id limit 1;
  if p is null then
    insert into results values ('SETUP', 'a project with cost periods', 'none found');
    return;
  end if;
  select id into cc from cost_codes where project_id = p limit 1;

  insert into calendars (project_id, name, weekends, holidays)
  values (p, 'ZZ-PHASING-TEST', '{0,6}', '{}') returning id into cal;

  select min(start_date) into win_start
    from reporting_periods
   where project_id = p and kind = 'cost'
     and sort_order > coalesce((select sort_order from reporting_periods
                                 where project_id = p and kind = 'cost' and is_current), -1);
  select end_date into cur_end from reporting_periods
   where project_id = p and kind = 'cost' and is_current;
  range_end := win_start + 27;

  select count(*) into wd_range from generate_series(win_start, range_end, interval '1 day') g(dd)
   where extract(dow from dd) not in (0, 6);
  select count(*) into wd_month from generate_series(
           date_trunc('month', win_start)::date,
           (date_trunc('month', win_start) + interval '1 month - 1 day')::date,
           interval '1 day') g(dd)
   where extract(dow from dd) not in (0, 6);

  -- ------------------------------------------------------------- Total ----
  insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                           phasing_method, phasing_unit, phasing_qty,
                           phasing_start_date, phasing_end_date)
  values (p, cc, cal, 'ZZ1', 0, 1, 'Auto-Phase', 'Total', 1000, win_start, range_end)
  returning id into d;
  perform apply_etc_auto_phasing(p, array[d]);
  insert into results values ('Total spreads the whole quantity', '1000.0000',
    (select qty::text from etc_details where id = d));
  delete from etc_details where id = d;

  -- ------------------------------------------------------------- Daily ----
  insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                           phasing_method, phasing_unit, phasing_qty,
                           phasing_start_date, phasing_end_date)
  values (p, cc, cal, 'ZZ2', 0, 1, 'Auto-Phase', 'Daily', 10, win_start, range_end)
  returning id into d;
  perform apply_etc_auto_phasing(p, array[d]);
  insert into results values ('Daily is the rate on every working day',
    (10 * wd_range)::numeric(18,4)::text,
    (select qty::text from etc_details where id = d));
  delete from etc_details where id = d;

  -- ----------------------------------------------------------- Monthly ----
  -- The divisor is the working days of the WHOLE month, so a range covering
  -- part of it carries a pro-rata share, not the full monthly quantity.
  insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                           phasing_method, phasing_unit, phasing_qty,
                           phasing_start_date, phasing_end_date)
  values (p, cc, cal, 'ZZ3', 0, 1, 'Auto-Phase', 'Monthly', 100, win_start, range_end)
  returning id into d;
  perform apply_etc_auto_phasing(p, array[d]);
  insert into results values ('Monthly is pro-rata over the whole month',
    round(100.0 * wd_range / wd_month, 4)::text,
    (select qty::text from etc_details where id = d));
  delete from etc_details where id = d;

  -- ------------------------------------ the forecast window: past dates ----
  -- A range ending on or before the current period carries nothing: phasing
  -- is a forecast, and a closed or current period is stated by its actuals.
  if cur_end is not null then
    insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                             phasing_method, phasing_unit, phasing_qty,
                             phasing_start_date, phasing_end_date)
    values (p, cc, cal, 'ZZ4', 0, 1, 'Auto-Phase', 'Total', 500, cur_end - 20, cur_end)
    returning id into d;
    insert into results
    select 'a range ending in the current period is refused', 'false',
           phased::text from apply_etc_auto_phasing(p, array[d]);
    insert into results values ('...and nothing is written to it', '0.0000',
      (select qty::text from etc_details where id = d));
    delete from etc_details where id = d;
  end if;

  -- ---------------------------------- the forecast window: clamped start ----
  -- A range starting before the window is clamped to it, not dropped, and the
  -- whole quantity still lands inside the window.
  if cur_end is not null then
    insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                             phasing_method, phasing_unit, phasing_qty,
                             phasing_start_date, phasing_end_date)
    values (p, cc, cal, 'ZZ5', 0, 1, 'Auto-Phase', 'Total', 300, cur_end - 20, range_end)
    returning id into d;
    perform apply_etc_auto_phasing(p, array[d]);
    insert into results values ('a range starting in the past is clamped, not dropped',
      '300.0000', (select qty::text from etc_details where id = d));
    insert into results values ('...and nothing lands on or before the current period',
      '0',
      (select count(*)::text
         from etc_details e, jsonb_each_text(e.period_values) v
         join reporting_periods rp on rp.id::text = v.key
        where e.id = d
          and rp.sort_order <= coalesce((select sort_order from reporting_periods
                                          where project_id = p and kind = 'cost' and is_current), -1)));
    delete from etc_details where id = d;
  end if;

  -- ------------------------------------------------- missing settings ----
  insert into etc_details (project_id, cost_code_id, calendar_id, item, qty, rate,
                           phasing_method, phasing_unit, phasing_qty,
                           phasing_start_date, phasing_end_date)
  values (p, cc, cal, 'ZZ6', 0, 1, 'Auto-Phase', 'Total', 0, win_start, range_end)
  returning id into d;
  insert into results
  select 'a row with no Phasing Qty says so', 'no Phasing Qty', reason
    from apply_etc_auto_phasing(p, array[d]);
  delete from etc_details where id = d;

  delete from calendars where id = cal;
end $$;

select case when expected = actual then 'PASS' else 'FAIL' end as status,
       label, expected, actual
  from results
 order by (expected = actual), label;

rollback;
