#!/usr/bin/env bash
# Destructive synthetic fixtures: LOCAL disposable database only.
set -euo pipefail
: "${DTM_TEST_DATABASE_URL:?Set a disposable LOCAL PostgreSQL URL}"
case "$DTM_TEST_DATABASE_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Refusing a non-local database URL' >&2; exit 2 ;;
esac
psql_test() { psql "$DTM_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@"; }
test_output_dir=$(mktemp -d)
cleanup() {
  psql_test -q <<'SQL'
delete from public.audit_log_outbox where payload_json->>'patientId'='f3000000-0000-0000-0000-000000000002';
select public.hard_delete_patient_data('f3000000-0000-0000-0000-000000000002');
delete from public.app_users where id='f3000000-0000-0000-0000-000000000001';
SQL
  rm -rf "$test_output_dir"
}
trap cleanup EXIT
psql_test -q <<'SQL'
insert into public.app_users(id,email,full_name,role_id,status)
select 'f3000000-0000-0000-0000-000000000001','concurrency@synthetic.test','Synthetic concurrency',id,'active' from public.roles where name='staff';
insert into public.patients(id,file_number,hospital,title,first_names,surname,id_type,id_number,id_country,phone,address)
values ('f3000000-0000-0000-0000-000000000002','FOU-SYNTHETIC-CONCURRENCY','Fountain Private Hospital','Mr','Synthetic','Concurrency','passport','TEST-CONCURRENCY','ZA','000','Test only');
insert into public.document_upload_intents(id,patient_id,actor_user_id,storage_key,original_filename,category,mime_type,declared_size)
values ('f3000000-0000-0000-0000-000000000003','f3000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002/test.pdf','test.pdf','other','application/pdf',10);
SQL
# Both connections finalise the same intent. Holding the first transaction open
# makes an overlap likely; either ordering must still return the same document.
for hold in 1 0; do
  psql_test -qAt > "$test_output_dir/$hold" <<SQL &
begin;
set local role service_role;
select id from public.finalize_document_upload('f3000000-0000-0000-0000-000000000003','f3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002',10,repeat('a',64),'application/pdf');
select pg_sleep($hold);
commit;
SQL
  if [[ "$hold" == 1 ]]; then first_pid=$!; else second_pid=$!; fi
done
wait "$first_pid"
wait "$second_pid"
diff "$test_output_dir/1" "$test_output_dir/0"
psql_test -q <<'SQL'
do $$
begin
  if (select count(*) from public.patient_documents where patient_id='f3000000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'concurrent finalisation did not produce exactly one document';
  end if;
  if (select count(*) from public.audit_log_outbox where payload_json->>'patientId'='f3000000-0000-0000-0000-000000000002' and payload_json->>'action'='document_upload') <> 1 then
    raise exception 'concurrent finalisation did not produce exactly one upload event';
  end if;
end;
$$;
SQL
echo 'PASS: two connections returned one document and one durable upload event'
