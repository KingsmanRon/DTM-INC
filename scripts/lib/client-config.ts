import { createHash } from "node:crypto";
import { z } from "zod";
import { FileNumberFormat } from "../../src/lib/validation/file-number";

const text = z.string().trim().min(1).max(20_000);
const prefix = z.string().regex(/^[A-Z]{2,5}$/);
export const fileNumberFormat = FileNumberFormat;

export const ClientConfig = z.object({
  schema_version: z.literal(1),
  project_ref: z.string().regex(/^[a-z0-9]{20}$/),
  practice: z.object({
    practice_name: text, practice_tagline: text, practice_number: text,
    doctor_name: text, doctor_qualifications: text, practice_address: text,
    practice_phone: text, information_officer_name: text,
    information_officer_email: z.string().email(), privacy_notice_body: text,
    active_consent_version: text, active_consent_body: text,
    consent_cards: z.array(z.object({ badge: z.string().min(1).max(3), title: text, body: text }).strict()).min(1).max(10),
    logo_path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*\.png$/).refine(s => !s.includes("..")),
    file_number_prefix: prefix, file_number_format: fileNumberFormat,
  }).strict(),
  facilities: z.array(z.object({ name: text, file_prefix: prefix, active: z.boolean(), display_order: z.number().int() }).strict()).min(1),
  initial_sequences: z.array(z.object({ prefix, year: z.number().int().min(1900).max(9999), next_value: z.number().int().min(1).max(999999999) }).strict()),
  initial_users: z.array(z.object({ full_name: text, email: z.string().email().transform(s => s.toLowerCase()), role: z.enum(["doctor", "staff", "admin"]) }).strict()).min(2),
  branding: z.object({ app_name: text, app_title: text, app_description: text, app_url: z.string().url().refine(s => new URL(s).protocol === "https:" && new URL(s).pathname === "/" && !new URL(s).search && !new URL(s).hash && !new URL(s).username && !new URL(s).password) }).strict(),
}).strict().superRefine((c, ctx) => {
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: `Duplicate ${label}` });
  };
  unique(c.facilities.map(f => f.name.toLowerCase()), "facility names");
  unique(c.facilities.map(f => f.file_prefix), "facility prefixes");
  unique(c.initial_users.map(u => u.email), "user emails");
  unique(c.initial_sequences.map(s => `${s.year}:${s.prefix}`), "sequences");
  if (!c.facilities.some(f => f.active)) ctx.addIssue({ code: "custom", message: "An active facility is required" });
  if (!c.initial_users.some(u => u.role === "admin") || c.initial_users.filter(u => u.role === "doctor").length !== 1)
    ctx.addIssue({ code: "custom", message: "Supply an administrator and exactly one doctor; additional clinicians require an explicit practice decision" });
  for (const s of c.initial_sequences) if (!c.facilities.some(f => f.file_prefix === s.prefix))
    ctx.addIssue({ code: "custom", message: "Sequence prefix must belong to a supplied facility" });
});
export type ClientConfiguration = z.infer<typeof ClientConfig>;

export function parseClientConfig(input: unknown): ClientConfiguration {
  const c = ClientConfig.parse(input);
  // Example files describe missing inputs; they are never executable defaults.
  if (c.project_ref === "abcdefghijklmnopqrst" || /SUPPLY_|REPLACE_|\.invalid\b|example\.com/i.test(JSON.stringify(c))) throw new Error("Replace every example placeholder with owner approved information");
  return c;
}

export function configurationHash(c: ClientConfiguration): string {
  return createHash("sha256").update(JSON.stringify(c)).digest("hex");
}

export function bootstrapSql(c: ClientConfiguration): string {
  const hex = Buffer.from(JSON.stringify(c), "utf8").toString("hex");
  const hash = configurationHash(c);
  // Hex prevents SQL and dollar quote injection from consent or other free text.
  return `-- Generated offline. Execute only in the NEW project's SQL editor.
-- Expected project ref: ${c.project_ref}. No network operation is performed by the generator.
begin;
set local standard_conforming_strings = on;
do $bootstrap$
declare
  cfg jsonb := convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb;
  existing_hash text;
  t text;
  occupied boolean;
begin
  perform pg_advisory_xact_lock(hashtext('practice_bootstrap'));
  select configuration_hash into existing_hash from private.practice_bootstrap where id;
  if existing_hash = '${hash}' then return; end if;
  if existing_hash is not null then raise exception 'Database already belongs to a configured practice'; end if;
  foreach t in array array['app_users','patients','clinical_notes','patient_documents',
    'patient_encryption_keys','consent_records','audit_logs','audit_log_outbox',
    'billing_export_items','patient_file_number_history','file_number_reservations','file_number_sequences'] loop
    execute format('lock table public.%I in share row exclusive mode', t);
    execute format('select exists(select 1 from public.%I)', t) into occupied;
    if occupied then raise exception 'Bootstrap refuses nonempty table %', t; end if;
  end loop;
  if exists(select 1 from auth.users) or exists(select 1 from storage.objects where bucket_id = 'patient-documents') then
    raise exception 'Bootstrap requires empty Auth and patient storage';
  end if;
  delete from public.hospitals;
  insert into public.hospitals(name,file_prefix,active,display_order)
    select name,file_prefix,active,display_order from jsonb_to_recordset(cfg->'facilities')
      as f(name text,file_prefix text,active boolean,display_order integer);
  update public.practice_settings set
${Object.keys(c.practice).map(key => `    ${key} = ${key === "consent_cards" ? `(cfg->'practice'->'${key}')` : `(cfg->'practice'->>'${key}')`}`).join(",\n")},
    updated_by = null where id = 1;
  if not found then raise exception 'Missing practice_settings singleton'; end if;
  insert into public.file_number_sequences(prefix,year,next_value)
    select prefix,year,next_value from jsonb_to_recordset(cfg->'initial_sequences')
      as s(prefix text,year integer,next_value bigint);
  update public.roles set description = 'Practice clinician. Clinical notes access.' where name = 'doctor';
  insert into private.practice_bootstrap(id,configuration_hash) values (true,'${hash}');
end;
$bootstrap$;
commit;
`;
}

export function initialUsersSql(c: ClientConfiguration): string {
  const hex = Buffer.from(JSON.stringify(c.initial_users), "utf8").toString("hex");
  return `-- After creating/inviting these Auth users in the NEW project's dashboard.
-- Bind database profiles to Auth IDs found by email; no invented UUIDs or passwords.
begin;
do $users$
declare u record; auth_id uuid; existing public.app_users%rowtype; role_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('practice_bootstrap'));
  if not exists(select 1 from private.practice_bootstrap where configuration_hash = '${configurationHash(c)}') then
    raise exception 'Apply the matching bootstrap configuration first';
  end if;
  for u in select * from jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb)
    as x(full_name text,email text,role text) loop
    select id into strict auth_id from auth.users where lower(email) = u.email;
    select id into strict role_id from public.roles where name::text = u.role;
    select * into existing from public.app_users where id = auth_id;
    if found then
      if existing.email <> u.email or existing.role_id <> role_id or existing.full_name <> u.full_name then
        raise exception 'Existing profile differs; use audited user administration';
      end if;
      continue;
    end if;
    insert into public.app_users(id,email,full_name,role_id,status)
      values(auth_id,u.email,u.full_name,role_id,'active');
    perform public.write_audit_entry_atomic(null,null,'user_create','app_users',auth_id::text,null,
      jsonb_build_object('source','initial_practice_bootstrap','role',u.role),null,null,now());
  end loop;
end;
$users$;
commit;
`;
}

export function brandingEnv(c: ClientConfiguration): string {
  const values = {
    NEXT_PUBLIC_DEPLOYMENT_PROFILE: "client", NEXT_PUBLIC_BRAND_ASSET_BASE: "/client-brand",
    NEXT_PUBLIC_APP_NAME: c.branding.app_name, NEXT_PUBLIC_APP_TITLE: c.branding.app_title,
    NEXT_PUBLIC_APP_DESCRIPTION: c.branding.app_description,
    NEXT_PUBLIC_APP_URL: c.branding.app_url, NEXT_PUBLIC_SITE_URL: c.branding.app_url,
    CLINICAL_NOTES_KEY_PROVIDER: "vault", CLINICAL_NOTES_KEK_ID: "vault:clinical-notes-kek/v1",
    ALLOW_DEV_KEK_FALLBACK: "false", FEATURE_HANDWRITTEN_NOTES: "false",
    FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS: "", FEATURE_HANDWRITTEN_NOTES_FINALISE: "false", FEATURE_HANDWRITTEN_NOTES_PDF: "false",
  };
  return Object.entries(values).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
}
