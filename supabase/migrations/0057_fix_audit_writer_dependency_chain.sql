begin;

-- ============================================================================
-- 1. Refuse to proceed if the expected restricted audit architecture is absent.
-- ============================================================================

do $guard$
declare
  v_role pg_roles%rowtype;
begin
  if to_regrole('audit_writer') is null then
    raise exception 'Required role audit_writer does not exist';
  end if;

  select *
  into v_role
  from pg_roles
  where rolname = 'audit_writer';

  if v_role.rolsuper
     or v_role.rolcanlogin
     or v_role.rolinherit
     or v_role.rolbypassrls
     or v_role.rolcreaterole
     or v_role.rolcreatedb
     or v_role.rolreplication then
    raise exception
      'audit_writer has unsafe role attributes: super=%, login=%, inherit=%, bypassrls=%',
      v_role.rolsuper,
      v_role.rolcanlogin,
      v_role.rolinherit,
      v_role.rolbypassrls;
  end if;

  if to_regprocedure(
    'public.audit_canonical_json(jsonb)'
  ) is null then
    raise exception 'Missing public.audit_canonical_json(jsonb)';
  end if;

  if to_regprocedure(
    'public.audit_iso8601_utc(timestamp with time zone)'
  ) is null then
    raise exception 'Missing public.audit_iso8601_utc(timestamptz)';
  end if;

  if to_regprocedure(
    'extensions.digest(text,text)'
  ) is null then
    raise exception 'Missing extensions.digest(text,text)';
  end if;

  if to_regprocedure(
    'public.write_audit_entry_atomic(' ||
    'uuid,public.role_name,public.audit_action,text,text,' ||
    'uuid,jsonb,inet,text,timestamp with time zone)'
  ) is null then
    raise exception 'Missing public.write_audit_entry_atomic';
  end if;

  if to_regclass(
    'public.audit_logs_chain_position_seq'
  ) is null then
    raise exception 'Missing audit_logs_chain_position_seq';
  end if;
end
$guard$;


-- ============================================================================
-- 2. Canonicalisation helpers.
--
-- Keep these owned by postgres and callable only by the restricted writer and
-- service_role. They contain no dynamic SQL and use fixed trusted search paths.
-- ============================================================================

alter function public.audit_canonical_json(jsonb)
  set search_path = pg_catalog, public, pg_temp;

alter function public.audit_iso8601_utc(timestamptz)
  set search_path = pg_catalog, public, pg_temp;


revoke all
  on function public.audit_canonical_json(jsonb)
  from public;

revoke all
  on function public.audit_iso8601_utc(timestamptz)
  from public;

revoke all
  on function public.audit_canonical_json(jsonb)
  from anon, authenticated;

revoke all
  on function public.audit_iso8601_utc(timestamptz)
  from anon, authenticated;


grant execute
  on function public.audit_canonical_json(jsonb)
  to audit_writer, service_role;

grant execute
  on function public.audit_iso8601_utc(timestamptz)
  to audit_writer, service_role;


-- ============================================================================
-- 3. pgcrypto dependency.
--
-- digest() is in the extensions schema. audit_writer needs USAGE on the schema
-- and EXECUTE on the exact overload used by the chain writer.
-- It receives no CREATE privilege.
-- ============================================================================

grant usage on schema extensions to audit_writer;

revoke create on schema extensions from audit_writer;

grant execute
  on function extensions.digest(text, text)
  to audit_writer;


-- ============================================================================
-- 4. Reassert the writer boundary.
--
-- service_role may invoke it, but the body executes as audit_writer.
-- The fixed path includes the trusted extensions schema so unqualified digest()
-- resolves correctly.
-- ============================================================================

alter function public.write_audit_entry_atomic(
  uuid,
  public.role_name,
  public.audit_action,
  text,
  text,
  uuid,
  jsonb,
  inet,
  text,
  timestamptz
)
  owner to audit_writer;

alter function public.write_audit_entry_atomic(
  uuid,
  public.role_name,
  public.audit_action,
  text,
  text,
  uuid,
  jsonb,
  inet,
  text,
  timestamptz
)
  set search_path = pg_catalog, public, extensions, pg_temp;

alter function public.write_audit_entry_atomic(
  uuid,
  public.role_name,
  public.audit_action,
  text,
  text,
  uuid,
  jsonb,
  inet,
  text,
  timestamptz
)
  set row_security = on;


revoke all
  on function public.write_audit_entry_atomic(
    uuid,
    public.role_name,
    public.audit_action,
    text,
    text,
    uuid,
    jsonb,
    inet,
    text,
    timestamptz
  )
  from public;

revoke execute
  on function public.write_audit_entry_atomic(
    uuid,
    public.role_name,
    public.audit_action,
    text,
    text,
    uuid,
    jsonb,
    inet,
    text,
    timestamptz
  )
  from anon, authenticated;

grant execute
  on function public.write_audit_entry_atomic(
    uuid,
    public.role_name,
    public.audit_action,
    text,
    text,
    uuid,
    jsonb,
    inet,
    text,
    timestamptz
  )
  to service_role;


-- ============================================================================
-- 5. Reassert the writer's minimal data permissions.
-- ============================================================================

alter table public.audit_logs enable row level security;

grant select, insert
  on table public.audit_logs
  to audit_writer;

grant usage
  on sequence public.audit_logs_chain_position_seq
  to audit_writer;


drop policy if exists audit_logs_writer_insert
  on public.audit_logs;

create policy audit_logs_writer_insert
  on public.audit_logs
  for insert
  to audit_writer
  with check (true);


drop policy if exists audit_logs_writer_select
  on public.audit_logs;

create policy audit_logs_writer_select
  on public.audit_logs
  for select
  to audit_writer
  using (true);


-- ============================================================================
-- 6. Post-change assertions.
--
-- Any missing dependency rolls back the entire migration.
-- ============================================================================

do $assert$
declare
  v_writer regprocedure :=
    to_regprocedure(
      'public.write_audit_entry_atomic(' ||
      'uuid,public.role_name,public.audit_action,text,text,' ||
      'uuid,jsonb,inet,text,timestamp with time zone)'
    );

  v_config text;
begin
  if not has_schema_privilege(
    'audit_writer',
    'extensions',
    'USAGE'
  ) then
    raise exception 'audit_writer lacks USAGE on extensions';
  end if;

  if has_schema_privilege(
    'audit_writer',
    'extensions',
    'CREATE'
  ) then
    raise exception 'audit_writer must not have CREATE on extensions';
  end if;

  if not has_function_privilege(
    'audit_writer',
    to_regprocedure('public.audit_canonical_json(jsonb)'),
    'EXECUTE'
  ) then
    raise exception 'audit_writer cannot execute audit_canonical_json';
  end if;

  if not has_function_privilege(
    'audit_writer',
    to_regprocedure(
      'public.audit_iso8601_utc(timestamp with time zone)'
    ),
    'EXECUTE'
  ) then
    raise exception 'audit_writer cannot execute audit_iso8601_utc';
  end if;

  if not has_function_privilege(
    'audit_writer',
    to_regprocedure('extensions.digest(text,text)'),
    'EXECUTE'
  ) then
    raise exception 'audit_writer cannot execute extensions.digest';
  end if;

  if not has_function_privilege(
    'service_role',
    v_writer,
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute atomic audit writer';
  end if;

  if has_function_privilege(
    'anon',
    v_writer,
    'EXECUTE'
  ) then
    raise exception 'anon can execute atomic audit writer';
  end if;

  if has_function_privilege(
    'authenticated',
    v_writer,
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute atomic audit writer';
  end if;

  if not has_table_privilege(
    'audit_writer',
    'public.audit_logs',
    'SELECT'
  ) then
    raise exception 'audit_writer lacks SELECT on audit_logs';
  end if;

  if not has_table_privilege(
    'audit_writer',
    'public.audit_logs',
    'INSERT'
  ) then
    raise exception 'audit_writer lacks INSERT on audit_logs';
  end if;

  if not has_sequence_privilege(
    'audit_writer',
    'public.audit_logs_chain_position_seq',
    'USAGE'
  ) then
    raise exception 'audit_writer lacks sequence USAGE';
  end if;

  select array_to_string(p.proconfig, ',')
  into v_config
  from pg_proc p
  where p.oid = v_writer;

  if coalesce(v_config, '') not like '%extensions%'
     or coalesce(v_config, '') not like '%row_security=on%' then
    raise exception
      'Unexpected writer function configuration: %',
      v_config;
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_roles r
      on r.oid = p.proowner
    where p.oid = v_writer
      and r.rolname = 'audit_writer'
      and p.prosecdef = true
  ) then
    raise exception
      'Writer must be SECURITY DEFINER owned by audit_writer';
  end if;
end
$assert$;

commit;
