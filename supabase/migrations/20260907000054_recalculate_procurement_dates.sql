-- ============================================================================
-- The procurement schedule, computed in the database.
--
-- Each package's steps form a chain: the planned dates are worked backward
-- from the last step, and the forecast dates forward from the first, both
-- counting in working days from the package's calendar. The browser did this
-- per package, in a loop, on load and on every edit -- and "Recalculate all"
-- did it for every package in the project at once.
--
-- The chain means a step cannot be computed without the one before it, so
-- this is not a single set-based statement. It is one statement PER STEP
-- instead: a project has a handful of procurement steps and may have very many
-- packages, so looping over the steps and updating every package at once is
-- the right way round. The browser looped the other way.
--
-- Plain PostgreSQL. See ARCHITECTURE.md.
-- ============================================================================

-- A date out of free-text jsonb, or null if it is not one. step_data is
-- written by an Excel import that does not validate what it is given, so a
-- plain ::date cast would fail the whole recalculation on one bad cell.
create or replace function try_date(p_text text)
returns date
language sql
immutable
as $$
  select case when p_text ~ '^\d{4}-\d{2}-\d{2}' then substring(p_text, 1, 10)::date end;
$$;

-- Counting in working days. Negative moves backward.
create or replace function add_business_days(
  p_start date,
  p_days integer,
  p_weekends integer[],
  p_holidays date[]
)
returns date
language plpgsql
immutable
as $$
declare
  d         date := p_start;
  remaining integer := abs(coalesce(p_days, 0));
  dir       integer := case when coalesce(p_days, 0) >= 0 then 1 else -1 end;
begin
  if p_start is null then return null; end if;
  while remaining > 0 loop
    d := d + dir;
    if not (extract(dow from d)::int = any (coalesce(p_weekends, '{}'::int[])))
       and not (d = any (coalesce(p_holidays, '{}'::date[]))) then
      remaining := remaining - 1;
    end if;
  end loop;
  return d;
end;
$$;

-- Set one key inside one step of step_data. jsonb_set cannot be used here:
-- it will not create the step object, so a package that has never carried a
-- date for a step would silently keep not carrying one.
create or replace function jsonb_merge_step(
  p_data jsonb, p_step text, p_key text, p_value jsonb
)
returns jsonb
language sql
immutable
as $$
  select coalesce(p_data, '{}'::jsonb)
      || jsonb_build_object(
           p_step,
           coalesce(p_data -> p_step, '{}'::jsonb) || jsonb_build_object(p_key, p_value)
         );
$$;

create or replace function recalculate_procurement_dates(
  p_project_id uuid,
  p_package_ids uuid[] default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  cutoff       date;
  step_ids     uuid[];
  n            integer;
  i            integer;
  this_step    uuid;
  next_step    uuid;
  prev_step    uuid;
  touched      integer := 0;
begin
  select coalesce(pr.cutoff_date, current_date) into cutoff
    from projects pr where pr.id = p_project_id;

  if cutoff is null then return 0; end if;   -- no such project

  select array_agg(s.id order by s.step_order, s.created_at)
    into step_ids
    from procurement_step_definitions s
   where s.project_id = p_project_id;

  n := coalesce(array_length(step_ids, 1), 0);
  if n = 0 then return 0; end if;

  -- ------------------------------------------------ planned, backward ----
  -- Each step starts its own duration before the step that follows it.
  for i in reverse (n - 1) .. 1 loop
    this_step := step_ids[i];
    next_step := step_ids[i + 1];

    with base as (
      select it.id, it.step_data, c.weekends, c.holidays
        from procurement_items it
        cross join lateral (
          -- The package's own calendar; failing that the project's first one;
          -- failing that Sat/Sun off and no holidays. Same fallback the grid used.
          select coalesce(own.weekends, fb.weekends, '{0,6}'::int[]) as weekends,
                 coalesce(own.holidays, fb.holidays, '{}'::date[])   as holidays
            from (select 1) _
            left join calendars own on own.id = it.calendar_id
            left join lateral (
              select d.weekends, d.holidays from calendars d
               where d.project_id = p_project_id
               order by d.created_at limit 1
            ) fb on true
        ) c
       where it.project_id = p_project_id
         and (p_package_ids is null or it.id = any (p_package_ids))
    ),
    calc as (
      select b.id,
             add_business_days(
               try_date(b.step_data #>> array[next_step::text, 'plannedDate']),
               -coalesce((b.step_data #>> array[this_step::text, 'planDuration'])::numeric::int, 0),
               b.weekends, b.holidays)::text as new_date
        from base b
       where try_date(b.step_data #>> array[next_step::text, 'plannedDate']) is not null
    )
    update procurement_items t
       set step_data = jsonb_merge_step(t.step_data, this_step::text, 'plannedDate', to_jsonb(c.new_date)),
           updated_at = now()
      from calc c
     where t.id = c.id
       and c.new_date is not null
       -- Only the packages whose date actually moved are written.
       and (t.step_data #>> array[this_step::text, 'plannedDate']) is distinct from c.new_date;
  end loop;

  -- ----------------------------------------------- forecast, forward ----
  -- The first step forecasts from its planned date or the cut-off, whichever
  -- is later; an actual date always wins. Later steps follow the one before.
  for i in 1 .. n loop
    this_step := step_ids[i];

    if i = 1 then
      with calc as (
        select it.id,
               coalesce(
                 it.step_data #>> array[this_step::text, 'actualDate'],
                 greatest(try_date(it.step_data #>> array[this_step::text, 'plannedDate']), cutoff)::text
               ) as new_date
          from procurement_items it
         where it.project_id = p_project_id
           and (p_package_ids is null or it.id = any (p_package_ids))
      )
      update procurement_items t
         set step_data = jsonb_merge_step(t.step_data, this_step::text, 'forecastDate', to_jsonb(c.new_date)),
             updated_at = now()
        from calc c
       where t.id = c.id
         and c.new_date is not null
         and (t.step_data #>> array[this_step::text, 'forecastDate']) is distinct from c.new_date;
    else
      prev_step := step_ids[i - 1];

      with base as (
        select it.id, it.step_data, c.weekends, c.holidays
          from procurement_items it
          cross join lateral (
            select coalesce(own.weekends, fb.weekends, '{0,6}'::int[]) as weekends,
                   coalesce(own.holidays, fb.holidays, '{}'::date[])   as holidays
              from (select 1) _
              left join calendars own on own.id = it.calendar_id
              left join lateral (
                select d.weekends, d.holidays from calendars d
                 where d.project_id = p_project_id
                 order by d.created_at limit 1
              ) fb on true
          ) c
         where it.project_id = p_project_id
           and (p_package_ids is null or it.id = any (p_package_ids))
      ),
      calc as (
        select b.id,
               coalesce(
                 b.step_data #>> array[this_step::text, 'actualDate'],
                 add_business_days(
                   try_date(b.step_data #>> array[prev_step::text, 'forecastDate']),
                   coalesce(
                     (b.step_data #>> array[prev_step::text, 'forecastDuration'])::numeric::int,
                     (b.step_data #>> array[prev_step::text, 'planDuration'])::numeric::int,
                     0),
                   b.weekends, b.holidays)::text
               ) as new_date
          from base b
      )
      update procurement_items t
         set step_data = jsonb_merge_step(t.step_data, this_step::text, 'forecastDate', to_jsonb(c.new_date)),
             updated_at = now()
        from calc c
       where t.id = c.id
         and c.new_date is not null
         and (t.step_data #>> array[this_step::text, 'forecastDate']) is distinct from c.new_date;
    end if;
  end loop;

  -- now() is the transaction timestamp, so this counts exactly the packages
  -- the loops above wrote.
  select count(*) into touched
    from procurement_items it
   where it.project_id = p_project_id
     and (p_package_ids is null or it.id = any (p_package_ids))
     and it.updated_at = now();

  return touched;
end;
$$;

revoke all on function try_date(text) from public, anon;
revoke all on function add_business_days(date, integer, integer[], date[]) from public, anon;
revoke all on function jsonb_merge_step(jsonb, text, text, jsonb) from public, anon;
revoke all on function recalculate_procurement_dates(uuid, uuid[]) from public, anon;

grant execute on function try_date(text) to authenticated;
grant execute on function add_business_days(date, integer, integer[], date[]) to authenticated;
grant execute on function jsonb_merge_step(jsonb, text, text, jsonb) to authenticated;
grant execute on function recalculate_procurement_dates(uuid, uuid[]) to authenticated;
