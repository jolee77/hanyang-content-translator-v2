-- v2.0: 프로젝트-스토리보드 계층, 번역 가이드라인, 다중 AI API

-- 프로젝트에 번역 가이드라인 추가
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS translation_guidelines TEXT NOT NULL DEFAULT '';

-- 스토리보드 테이블 (프로젝트당 여러 PPTX)
CREATE TABLE IF NOT EXISTS storyboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  source_pptx_url TEXT,
  source_pptx_name TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storyboards_project_id_idx ON storyboards(project_id);

-- slides에 storyboard_id 연결
ALTER TABLE slides
  ADD COLUMN IF NOT EXISTS storyboard_id UUID REFERENCES storyboards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS slides_storyboard_id_idx ON slides(storyboard_id);

-- 기존 프로젝트 데이터 → 스토리보드 1건으로 이전
INSERT INTO storyboards (project_id, title, status, source_pptx_url, source_pptx_name, sort_order)
SELECT
  p.id,
  COALESCE(NULLIF(p.source_pptx_name, ''), p.title),
  p.status,
  p.source_pptx_url,
  p.source_pptx_name,
  0
FROM projects p
WHERE p.source_pptx_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM storyboards s WHERE s.project_id = p.id
  );

UPDATE slides sl
SET storyboard_id = s.id
FROM storyboards s
WHERE sl.project_id = s.project_id
  AND sl.storyboard_id IS NULL;

-- storyboards RLS
ALTER TABLE storyboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "프로젝트 소유자 storyboards 조회" ON storyboards;
CREATE POLICY "프로젝트 소유자 storyboards 조회"
  ON storyboards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = storyboards.project_id
        AND (
          p.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "프로젝트 소유자 storyboards 생성" ON storyboards;
CREATE POLICY "프로젝트 소유자 storyboards 생성"
  ON storyboards FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = storyboards.project_id
        AND (
          p.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "프로젝트 소유자 storyboards 수정" ON storyboards;
CREATE POLICY "프로젝트 소유자 storyboards 수정"
  ON storyboards FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = storyboards.project_id
        AND (
          p.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "프로젝트 소유자 storyboards 삭제" ON storyboards;
CREATE POLICY "프로젝트 소유자 storyboards 삭제"
  ON storyboards FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = storyboards.project_id
        AND (
          p.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles pr
            WHERE pr.id = auth.uid() AND pr.role = 'admin'
          )
        )
    )
  );

-- 다중 AI API 설정 기본값
INSERT INTO settings (key, value)
VALUES ('active_ai_provider', 'claude')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('openai_api_key', NULL)
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
VALUES ('google_api_key', NULL)
ON CONFLICT (key) DO NOTHING;
