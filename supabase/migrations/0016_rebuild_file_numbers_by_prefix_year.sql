-- One-time deterministic rebuild of patient file numbers by hospital-derived prefix and year bucket.
--
-- Scope note:
--   * This migration only recalculates rows for active known hospital prefixes:
--       NKA, FOU, MED, MID
--   * Legacy rows that cannot be mapped from patients.hospital (including historical DTM-* rows
--     with unknown/missing/non-standard hospital values) are intentionally left unchanged.
--
-- Numbering rule:
--   file_number := {PREFIX}-{YYYY}-{LPAD(row_number, 6, '0')}
--   where row_number is assigned deterministically per (prefix, year_from_existing_file_number)
--   ordered by (created_at, id).

DO $$
DECLARE
  v_collision_count bigint;
BEGIN
  create temporary table tmp_patient_file_number_rebuild (
    id uuid primary key,
    prefix text not null,
    file_year int not null,
    new_file_number text not null
  ) on commit drop;

  insert into tmp_patient_file_number_rebuild (id, prefix, file_year, new_file_number)
  with scoped as (
    select
      p.id,
      p.created_at,
      case p.hospital
        when 'Nkanyezi Private Hospital' then 'NKA'
        when 'Fountain Private Hospital' then 'FOU'
        when 'Mediclinic Vereeniging Hospital' then 'MED'
        when 'Midvaal Private Hospital' then 'MID'
        else null
      end as prefix,
      substring(p.file_number from '(\\d{4})')::int as file_year
    from patients p
  ), ranked as (
    select
      s.id,
      s.prefix,
      s.file_year,
      row_number() over (
        partition by s.prefix, s.file_year
        order by s.created_at asc, s.id asc
      ) as seq
    from scoped s
    where s.prefix in ('NKA', 'FOU', 'MED', 'MID')
      and s.file_year is not null
  )
  select
    r.id,
    r.prefix,
    r.file_year,
    r.prefix || '-' || r.file_year::text || '-' || lpad(r.seq::text, 6, '0') as new_file_number
  from ranked r;

  -- Collision guard #1: computed target set itself must be unique.
  select count(*) into v_collision_count
  from (
    select new_file_number
    from tmp_patient_file_number_rebuild
    group by new_file_number
    having count(*) > 1
  ) d;

  if v_collision_count > 0 then
    raise exception 'Aborting file number rebuild: duplicate computed targets detected (%)', v_collision_count;
  end if;

  -- Collision guard #2: no staged target may collide with an untouched patient row.
  select count(*) into v_collision_count
  from tmp_patient_file_number_rebuild t
  join patients p
    on p.file_number = t.new_file_number
   and p.id <> t.id
  where not exists (
    select 1
    from tmp_patient_file_number_rebuild t2
    where t2.id = p.id
  );

  if v_collision_count > 0 then
    raise exception 'Aborting file number rebuild: staged targets collide with untouched rows (%)', v_collision_count;
  end if;

  update patients p
  set file_number = t.new_file_number
  from tmp_patient_file_number_rebuild t
  where p.id = t.id;

  -- Reseed future allocation counters for each (year, prefix) after rewrite.
  insert into file_number_sequences (year, prefix, next_value)
  select
    t.file_year,
    t.prefix,
    coalesce(max(substring(t.new_file_number from '(\\d{6})$')::bigint), 0) + 1 as next_value
  from tmp_patient_file_number_rebuild t
  group by t.file_year, t.prefix
  on conflict (year, prefix)
  do update set next_value = excluded.next_value;
END
$$;
