-- Consult one-off file-number reservations before falling back to the per-(year, prefix) counter.
--
-- public.file_number_reservations holds pre-approved, verified-clean slots (e.g. FOU/2026/32,
-- NKA/2026/128) meant to backfill gaps. The table was inert until now; this teaches
-- allocate_file_number() to consume the lowest unconsumed reservation for the resolved
-- (year, prefix) before touching the sequence counter.
--
-- Invariants preserved: signature, year resolution, and the practice_settings format lookup are
-- unchanged; next_value advances ONLY on the non-reservation path; patients.file_number UNIQUE
-- stays the final backstop. Reservations consume lowest-seq-first, so numbers may issue out of
-- chronological order by design.
--
-- Concurrency: the (year, prefix) sequence row is locked FOR UPDATE before the reservation is
-- consulted, so concurrent onboards for the same (year, prefix) serialize and cannot
-- double-consume a slot. The reservation select uses plain FOR UPDATE (no SKIP LOCKED): the
-- sequence-row lock already serializes those onboards, so blocking is correct; skipping would
-- only risk silently leaving a reservation unconsumed and burning a counter value.
--
-- consumed_by is intentionally left unset: the patient id does not exist inside this function
-- (onboard_patient generates it at INSERT, after allocation returns), and the signature must
-- not change. RLS/grants on file_number_reservations are managed out-of-band, not here.
--
-- Verified against the deployed body (pg_get_functiondef) before writing: the normal-onboard
-- path here is byte-identical to the live function; the only additions are the reservation
-- consult and the if/else around the existing counter increment.

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

  -- Lock the (year, prefix) row up front so the reservation consult and any counter
  -- increment serialize against concurrent onboards for the same (year, prefix).
  perform 1
    from file_number_sequences
    where year = v_year
      and prefix = v_prefix
    for update;

  -- Reservation consult: consume the lowest unconsumed reserved slot before the counter.
  -- Plain FOR UPDATE (no SKIP LOCKED): the sequence-row lock above already serializes
  -- same-(year, prefix) onboards, so this blocks on contention rather than skipping -- a
  -- skipped row would silently leave a reservation unconsumed and burn a counter value.
  select seq
    into v_seq
    from file_number_reservations
    where prefix = v_prefix
      and year = v_year
      and consumed_at is null
    order by seq
    limit 1
    for update;

  if found then
    -- Consume the reserved slot. Do NOT advance next_value on this path.
    update file_number_reservations
      set consumed_at = now()
      where prefix = v_prefix
        and year = v_year
        and seq = v_seq;
  else
    -- No reservation: existing counter-increment logic, unchanged.
    update file_number_sequences
      set next_value = next_value + 1
      where year = v_year
        and prefix = v_prefix
      returning next_value - 1 into v_seq;
  end if;

  v_result := replace(v_format, '{PREFIX}', v_prefix);
  v_result := replace(v_result, '{YYYY}', v_year::text);
  v_result := replace(v_result, '{SEQ:06}', lpad(v_seq::text, 6, '0'));

  return v_result;
end $$;

revoke all on function allocate_file_number(int, text) from public;
