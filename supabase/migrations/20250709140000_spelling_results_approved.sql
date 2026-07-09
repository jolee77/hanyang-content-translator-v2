-- 맞춤법: 검토 승인(반영 대기) — 슬라이드/PPTX 반영은 별도 단계
ALTER TABLE public.spelling_results
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;
