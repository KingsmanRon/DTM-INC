-- Track file number counters per (year, prefix) instead of per year.

alter table file_number_sequences
  add column if not exists prefix text;

update file_number_sequences
set prefix = 'DTM'
where prefix is null;

alter table file_number_sequences
  alter column prefix set not null;

alter table file_number_sequences
  drop constraint if exists file_number_sequences_pkey;

alter table file_number_sequences
  add constraint file_number_sequences_pkey primary key (year, prefix);

create or replace function allocate_file_number(p_year int default null, p_prefix text default null)
returns text language plpgsql security definer as $$
declare
  v_year   int;
  v_seq    bigint;
  v_prefix text;
  v_format text;
  v_result text;
begin
  v_year := coalesce(p_year, extract(year from (now() at time zone 'Africa/Johannesburg'))::int);

  -- Resolve prefix before sequence allocation so counters are prefix-specific.
  select coalesce(p_prefix, file_number_prefix), file_number_format
    into v_prefix, v_format
    from practice_settings where id = 1;

  -- Lock or insert this year's sequence row for this prefix.
  insert into file_number_sequences (year, prefix, next_value)
    values (v_year, v_prefix, 1)
    on conflict (year, prefix) do nothing;

  update file_number_sequences
    set next_value = next_value + 1
    where year = v_year
      and prefix = v_prefix
    returning next_value - 1 into v_seq;

  v_result := replace(v_format, '{PREFIX}', v_prefix);
  v_result := replace(v_result, '{YYYY}', v_year::text);
  v_result := replace(v_result, '{SEQ:06}', lpad(v_seq::text, 6, '0'));

  return v_result;
end $$;

revoke all on function allocate_file_number(int, text) from public;
