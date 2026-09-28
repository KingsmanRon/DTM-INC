import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseClientConfig, bootstrapSql, initialUsersSql } from "./lib/client-config";

// This runner can address only the disposable container named in config.toml.
// It has no URL/key arguments, no credentials and no remote database option.
const container = "supabase_db_practice-baseline-validation";
function synthetic(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/SUPPLY_[A-Z_]+/g, "Synthetic test only").replace(/example\.invalid/g, "synthetic.test");
  if (Array.isArray(value)) return value.map(synthetic);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,synthetic(v)]));
  return value;
}
const input = synthetic(JSON.parse(readFileSync("config/client.example.json", "utf8"))) as Record<string,unknown>;
input.project_ref = "zzzzzzzzzzzzzzzzzzzz";
const c = parseClientConfig(input);
c.practice.active_consent_body = "O'Brien $bootstrap$; this is synthetic consent only.";
const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Africa/Johannesburg" }).format(new Date()));
c.initial_sequences = [{ prefix: "XX", year, next_value: 700 }];
const stripTransaction = (sql: string) => sql.replace(/^begin;\n/m, "").replace(/^commit;\n/m, "");
const seed = stripTransaction(bootstrapSql(c));
const users = stripTransaction(initialUsersSql(c));
const changed = stripTransaction(bootstrapSql({ ...c, practice: { ...c.practice, practice_name: "Another synthetic practice" } }));
const sql = `begin;
create extension if not exists pgtap with schema extensions;
select plan(13);
${seed}
select is((select count(*)::int from public.hospitals),1,'only supplied facilities remain');
select is((select next_value from public.file_number_sequences where prefix='XX' and year=${year}),700::bigint,'initial sequence honoured');
select is((select active_consent_body from public.practice_settings),convert_from(decode('${Buffer.from(c.practice.active_consent_body).toString("hex")}','hex'),'UTF8'),'free text survives safely');
select lives_ok($repeat$${seed}$repeat$,'exact bootstrap repeat does nothing');
select throws_ok($different$${changed}$different$,'P0001','Database already belongs to a configured practice','different config cannot overwrite practice');
insert into auth.users(id,email) values(gen_random_uuid(),'admin@synthetic.test'),(gen_random_uuid(),'doctor@synthetic.test');
${users}
select is((select count(*)::int from public.app_users),2,'initial Auth accounts bound to app profiles');
select is((select count(*)::int from public.audit_logs where action='user_create'),2,'initial profile creation audited');
select lives_ok($repeatusers$${users}$repeatusers$,'initial user binding is repeatable');
delete from private.practice_bootstrap;
select throws_like($populated$${seed}$populated$,'%Bootstrap refuses nonempty table%','populated database refuses bootstrap');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email='doctor@synthetic.test'),'role','authenticated','aal','aal2')::text,true);
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='doctor@synthetic.test'),true);
set local role authenticated;
select lives_ok($onboard$
  select * from public.onboard_patient(auth.uid(),
    jsonb_build_object('hospital',(select name from public.hospitals limit 1),'title','Mr','first_names','Synthetic','surname','Patient','id_type','passport','id_number','TEST700','id_country','ZA','phone','000','address','Test only'),
    '{"same_as_patient":true,"title":"Mr","first_names":"Synthetic","surname":"Patient","id_number":"TEST700","date_of_birth":"1980-01-01","marital_status":"single","phone":"000","home_address":"Test only"}', '{"is_private_payer":true}',
    '{"name":"Synthetic contact","relationship":"Test","phone":"000"}',
    '{"referrer_type":"self"}', '[]',
    (select jsonb_build_object('consent_text_version',active_consent_version,
      'consent_text_hash',encode(extensions.digest(active_consent_version || '::' || active_consent_body,'sha256'),'hex'),
      'signature_type','typed_name','signature_value','Synthetic Patient','patient_present_attestation',true)
     from public.practice_settings))
$onboard$,'new practice doctor can onboard with supplied consent and facility');
select is((select file_number from public.patients),'XX-${year}-000700','onboarding uses supplied prefix and starting sequence');
select is((select payer_type::text from public.patients),'private','private payer survives onboarding');
select is(public.stage_billing_export_items(auth.uid(),(select name from public.hospitals limit 1),date_trunc('month',current_date)::date,(select array_agg(id) from public.patients)),1,'new practice doctor can stage the monthly billing item');
reset role;
select * from finish();
rollback;
`;
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t"], { input: sql, encoding: "utf8", shell: false });
if (result.error) throw result.error;
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0 || /^not ok /m.test(result.stdout ?? "") || !/ok 13 /.test(result.stdout ?? "")) process.exit(1);
