-- Storage: pptx-files 버킷 (PPTX + 원고)
-- 경로: {userId}/{projectId}/{storyboardId}/source.pptx | manuscript.{txt|docx}

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pptx-files',
  'pptx-files',
  false,
  104857600, -- 100MB
  ARRAY[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 본인 폴더({userId}/...)만 접근
DROP POLICY IF EXISTS "pptx_files_owner_select" ON storage.objects;
CREATE POLICY "pptx_files_owner_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'pptx-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "pptx_files_owner_insert" ON storage.objects;
CREATE POLICY "pptx_files_owner_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'pptx-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "pptx_files_owner_update" ON storage.objects;
CREATE POLICY "pptx_files_owner_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'pptx-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'pptx-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "pptx_files_owner_delete" ON storage.objects;
CREATE POLICY "pptx_files_owner_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'pptx-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
