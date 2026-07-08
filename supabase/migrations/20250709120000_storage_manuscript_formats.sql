-- 원고 업로드 형식 확장: PDF, PPT, PPTX

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'text/plain'
]::text[]
WHERE id = 'pptx-files';
