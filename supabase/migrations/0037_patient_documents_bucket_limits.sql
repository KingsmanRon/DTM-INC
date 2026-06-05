-- Enforce the patient-documents size + MIME limits at the storage layer.
--
-- In the signed-URL upload flow the bytes go browser -> Supabase directly, so
-- these bucket limits are the first line of defence (the finalize route's
-- re-check is the second). Supabase rejects an oversized or wrong-type object
-- at upload time, before any DB row exists. The values mirror the app-layer
-- limits in src/lib/documents/constants.ts: 25 MB; PDF/JPEG/PNG/HEIC/WEBP.
--
-- 26214400 = 25 * 1024 * 1024.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp'
    ]
where id = 'patient-documents';
