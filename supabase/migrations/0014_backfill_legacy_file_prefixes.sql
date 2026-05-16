-- One-time legacy backfill: convert existing DTM-prefixed file numbers
-- to hospital-specific prefixes introduced in 0013.

with mapped as (
  select
    p.id,
    p.file_number as old_file_number,
    regexp_replace(
      p.file_number,
      '^DTM-',
      case p.hospital
        when 'Nkanyezi Private Hospital' then 'NKA-'
        when 'Fountain Private Hospital' then 'FOU-'
        when 'Mediclinic Vereeniging Hospital' then 'MED-'
        when 'Midvaal Private Hospital' then 'MID-'
      end
    ) as new_file_number
  from patients p
  where p.file_number like 'DTM-%'
), updatable as (
  select m.*
  from mapped m
  where m.new_file_number is not null
    and not exists (
      select 1 from patients p2
      where p2.file_number = m.new_file_number
        and p2.id <> m.id
    )
)
update patients p
set file_number = u.new_file_number
from updatable u
where p.id = u.id;
