-- ============================================================================
-- ETC auto-phasing, computed in the database.
--
-- This was the largest calculation left in the browser, and there were two
-- copies of it -- the cost code's ETC Details tab and the Bulk ETC Details
-- screen. Each walked the calendar one day at a time in JavaScript, testing
-- every date against the row's working calendar and accumulating into period,
-- week and day buckets. A project carries ETC detail lines in the millions
-- (see ARCHITECTURE.md); phasing them a day at a time in a browser tab is not
-- something that gets slower at that size, it is something that stops.
--
-- The rules are unchanged:
--
--   dates      a row linked to a schedule activity takes that activity's
--              current dates, read fresh, so re-phasing follows the programme
--   window     forecasting starts in the period AFTER the current one; a
--              range ending before that window carries nothing
--   calendar   weekends and holidays come from the row's calendar; a row with
--              no calendar counts every day, which is reported, not hidden
--   Total      the quantity spread across the working days in the range
--   Daily      that quantity on every working day
--   Weekly     that quantity spread over the working days of each week
--   Monthly    that quantity spread over the working days of each month
--   Profile    with no dates, the shape already stored, rescaled
--
-- The period totals, the week buckets ("<periodId>_w<n>") and the day buckets
-- ("<periodId>_d<DDMM>") are all produced here, because the grid reads all
-- three.
--
-- Returns one row per ETC detail considered, saying whether it was phased and
-- if not, why -- the browser version dropped rows silently for four different
-- reasons, so a Calculate that did nothing looked like one with nothing to do.
--
-- Plain PostgreSQL: generate_series over dates, window functions, jsonb.
-- ============================================================================

create or replace function apply_etc_auto_phasing(
  p_project_id uuid,
  p_detail_ids uuid[] default null,      -- null = every Auto-Phase row in the project
  p_week_ending_day integer default 0    -- 0 = Sunday
)
returns table (detail_id uuid, phased boolean, reason text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with
  -- The periods a forecast may land in: everything after the current one.
  dist_periods as (
    select p.id, p.start_date, p.end_date,
           row_number() over (order by p.sort_order) as seq
      from reporting_periods p
     where p.project_id = p_project_id
       and p.kind = 'cost'
       and p.sort_order > coalesce(
             (select c.sort_order from reporting_periods c
               where c.project_id = p_project_id and c.kind = 'cost' and c.is_current),
             -1)
  ),
  window_start as (select min(start_date) as d from dist_periods),
  -- Each row's effective dates: a schedule link wins over the row's own.
  target as (
    select e.id,
           e.phasing_unit,
           e.phasing_qty,
           e.period_values,
           e.calendar_id,
           coalesce(s.current_start_date, e.phasing_start_date) as raw_start,
           coalesce(s.current_end_date,   e.phasing_end_date)   as raw_end,
           (e.activity_id is not null and s.id is null)         as broken_link,
           e.activity_id
      from etc_details e
      left join schedule_items s
        on e.activity_id is not null
       and s.project_id = e.project_id
       and s.activity_id = e.activity_id
     where e.project_id = p_project_id
       and e.phasing_method = 'Auto-Phase'
       and (p_detail_ids is null or e.id = any (p_detail_ids))
  ),
  -- Why a row cannot be phased, in the order the browser tested it.
  classified as (
    select t.*,
           (select d from window_start) as win_start,
           case
             when coalesce(t.phasing_qty, 0) = 0 then 'no Phasing Qty'
             when t.phasing_unit is null         then 'no Phasing Unit'
             when t.broken_link then 'activity ' || coalesce(t.activity_id, '?') || ' is not in the schedule'
             when t.phasing_unit = 'Profile' and (t.raw_start is null or t.raw_end is null) then 'profile'
             when t.raw_start is null or t.raw_end is null then 'no start or end date'
             when t.raw_end < (select d from window_start) then
               'the date range ends before the next open reporting period'
             when (select count(*) from dist_periods) = 0 then 'there are no future reporting periods'
             else null
           end as reason
      from target t
  ),
  -- Every day of an EXTENDED span around each row's window: whole calendar
  -- months, plus a week either side. The extension matters because a Weekly
  -- or Monthly rate is "this much per week / per month" -- the divisor is the
  -- working days of the WHOLE week or month, not just the part the range
  -- happens to cover. A range over the last 20 working days of a 22-working-
  -- day month therefore carries 20/22 of the monthly quantity, not all of it.
  spans as (
    select c.id, c.phasing_unit, c.phasing_qty, c.calendar_id,
           greatest(c.raw_start, c.win_start) as range_start,
           c.raw_end as range_end
      from classified c
     where c.reason is null
       and c.phasing_unit <> 'Profile'
  ),
  ext_days as (
    select sp.id, sp.phasing_unit, sp.phasing_qty,
           d::date as day,
           (d::date between sp.range_start and sp.range_end) as in_range
      from spans sp
      cross join lateral generate_series(
             (date_trunc('month', sp.range_start) - interval '7 days')::date,
             (date_trunc('month', sp.range_end) + interval '1 month 6 days')::date,
             interval '1 day') as g(d)
      left join calendars cal on cal.id = sp.calendar_id
     -- No calendar means no weekends and no holidays are known, so every day
     -- counts. Reported to the caller rather than silently inflating.
     where cal.id is null
        or (not (extract(dow from d)::int = any (coalesce(cal.weekends, '{}'::int[])))
            and not (d::date = any (coalesce(cal.holidays, '{}'::date[]))))
  ),
  -- The divisors, counted over the whole week and whole month.
  counted as (
    select e.*,
           count(*) filter (where e.in_range) over (partition by e.id) as days_in_range,
           count(*) over (partition by e.id, date_trunc('month', e.day)) as days_in_month,
           count(*) over (
             partition by e.id,
             (e.day + ((p_week_ending_day - extract(dow from e.day)::int + 7) % 7))
           ) as days_in_week,
           (e.day + ((p_week_ending_day - extract(dow from e.day)::int + 7) % 7)) as week_end
      from ext_days e
  ),
  -- Only the in-range working days that land in a forecastable period carry
  -- anything; the rest were there to make the divisors right.
  placed as (
    select c.id, c.day, c.phasing_unit, c.phasing_qty,
           c.days_in_range, c.days_in_month, c.days_in_week, c.week_end,
           p.id as period_id, p.start_date as period_start
      from counted c
      join dist_periods p
        on c.day between p.start_date and p.end_date
     where c.in_range
  ),
  -- What each working day carries.
  per_day as (
    select pl.*,
           case pl.phasing_unit
             when 'Total'   then pl.phasing_qty / nullif(pl.days_in_range, 0)
             when 'Daily'   then pl.phasing_qty
             when 'Weekly'  then pl.phasing_qty / nullif(pl.days_in_week, 0)
             when 'Monthly' then pl.phasing_qty / nullif(pl.days_in_month, 0)
             else 0
           end as day_qty
      from placed pl
  ),
  -- Week number within the period. The weeks are counted from the period's
  -- own start, not from the first week the phasing happens to touch, so a
  -- range starting mid-period lands in w3 rather than w1.
  weeks as (
    select pd.*,
           ((pd.week_end
             - (pd.period_start + ((p_week_ending_day - extract(dow from pd.period_start)::int + 7) % 7))
            ) / 7) + 1 as week_no
      from per_day pd
  ),
  -- The three bucket shapes the grid reads.
  period_buckets as (
    select id, period_id::text as key, round(sum(day_qty), 4) as value
      from per_day group by id, period_id
  ),
  week_buckets as (
    select id, period_id::text || '_w' || week_no::text as key,
           round(sum(day_qty), 4) as value
      from weeks group by id, period_id, week_no
  ),
  day_buckets as (
    select id,
           period_id::text || '_d' || to_char(day, 'DDMM') as key,
           round(sum(day_qty), 4) as value
      from per_day group by id, period_id, day
  ),
  -- Profile keeps the shape already stored, rescaled to the phasing quantity.
  profile_rows as (
    select c.id, c.phasing_qty, p.id as period_id,
           coalesce((
             select sum(coalesce(v.value::numeric, 0))
               from jsonb_each_text(c.period_values) v
              where v.key = p.id::text or v.key like p.id::text || '\_%'
           ), 0) as weight
      from classified c
      cross join dist_periods p
     where c.reason = 'profile'
  ),
  profile_buckets as (
    select pr.id, pr.period_id::text as key,
           round(
             case when sum(pr.weight) over (partition by pr.id) = 0
                  then pr.phasing_qty / nullif(count(*) over (partition by pr.id), 0)
                  else pr.phasing_qty * pr.weight / sum(pr.weight) over (partition by pr.id)
             end, 4) as value
      from profile_rows pr
  ),
  all_buckets as (
    select * from period_buckets
    union all select * from week_buckets
    union all select * from day_buckets
    union all select * from profile_buckets
  ),
  built as (
    select b.id, jsonb_object_agg(b.key, b.value) as new_values,
           sum(b.value) filter (
             where b.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           ) as period_total
      from all_buckets b
     group by b.id
  ),
  -- Past and current periods keep whatever they already hold; only the
  -- forecast window is rewritten.
  kept as (
    select c.id,
           coalesce((
             select jsonb_object_agg(v.key, v.value::numeric)
               from jsonb_each_text(c.period_values) v
              where not exists (
                select 1 from dist_periods dp
                 where v.key = dp.id::text or v.key like dp.id::text || '\_%')
           ), '{}'::jsonb) as retained
      from classified c
  ),
  written as (
    update etc_details e
       set period_values = k.retained || b.new_values,
           qty = round(coalesce(b.period_total, 0), 4),
           updated_at = now()
      from built b
      join kept k on k.id = b.id
     where e.id = b.id
    returning e.id
  )
  select c.id,
         (w.id is not null) as phased,
         case when w.id is not null then null
              when c.reason = 'profile' then 'nothing stored to build a profile from'
              else coalesce(c.reason, 'no working days in the date range (check the calendar)')
         end as reason
    from classified c
    left join written w on w.id = c.id;
end;
$$;

revoke all on function apply_etc_auto_phasing(uuid, uuid[], integer) from public, anon;
grant execute on function apply_etc_auto_phasing(uuid, uuid[], integer) to authenticated;
