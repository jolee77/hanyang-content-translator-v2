-- 스토리보드 원고(대본) 업로드 및 추출 텍스트 저장

ALTER TABLE storyboards
  ADD COLUMN IF NOT EXISTS source_manuscript_url TEXT,
  ADD COLUMN IF NOT EXISTS source_manuscript_name TEXT,
  ADD COLUMN IF NOT EXISTS manuscript_text TEXT;
