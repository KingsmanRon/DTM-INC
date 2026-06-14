-- 0054_id_type_none_value.sql
--
-- Add the 'none' id_type for locale "us" patients, who have NO national ID
-- number. (SA values stay: 'sa_id', 'passport', 'none_minor'.) US identity is
-- anchored on name + date_of_birth instead — see 0055, which adds the columns,
-- extends the identity CHECK, and adds the duplicate-lookup index.
--
-- Isolated file per the 0005/0046/0052 convention: an enum value is added
-- separately from its first use, so a new value is never referenced as an enum
-- literal in the same transaction that creates it (Postgres rejects that).
-- 0055 only ever compares id_type::text = 'none', never the literal, so the two
-- migrations are independently safe.

alter type public.id_type add value if not exists 'none';
