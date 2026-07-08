-- 초기 스키마 (v1에서 수동 생성되던 기본 테이블들)
-- NOTE: 이후 마이그레이션들이 ALTER/DROP/ADD를 수행하므로,
--       여기서는 "최초" 형태(legacy 컬럼 포함)를 먼저 만들고,
--       나머지 마이그레이션을 그대로 적용한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  name text,
  role text NOT NULL DEFAULT 'designer' CHECK (role IN ('admin', 'designer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- settings (key-value)
CREATE TABLE IF NOT EXISTS public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_admin_read" ON public.settings;
CREATE POLICY "settings_admin_read"
ON public.settings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

DROP POLICY IF EXISTS "settings_admin_write" ON public.settings;
CREATE POLICY "settings_admin_write"
ON public.settings
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- projects
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  source_pptx_url text,
  source_pptx_name text,
  vn_pptx text,
  target_lang text NOT NULL DEFAULT 'vi',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_owner_select" ON public.projects;
CREATE POLICY "projects_owner_select"
ON public.projects
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "projects_owner_insert" ON public.projects;
CREATE POLICY "projects_owner_insert"
ON public.projects
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "projects_owner_update" ON public.projects;
CREATE POLICY "projects_owner_update"
ON public.projects
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "projects_owner_delete" ON public.projects;
CREATE POLICY "projects_owner_delete"
ON public.projects
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- slides
CREATE TABLE IF NOT EXISTS public.slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slide_num integer NOT NULL,
  slide_type text,
  screen_num text,
  course_name text,
  chapter_name text,
  current_section text,
  screen_text text,
  screen_desc text,
  image_nums text,
  narration text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slides_owner_select" ON public.slides;
CREATE POLICY "slides_owner_select"
ON public.slides
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

DROP POLICY IF EXISTS "slides_owner_write" ON public.slides;
CREATE POLICY "slides_owner_write"
ON public.slides
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

-- spelling_results
CREATE TABLE IF NOT EXISTS public.spelling_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slide_id uuid NOT NULL REFERENCES public.slides(id) ON DELETE CASCADE,
  field text NOT NULL,
  original text,
  suggestion text,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spelling_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spelling_owner_rw" ON public.spelling_results;
CREATE POLICY "spelling_owner_rw"
ON public.spelling_results
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

-- translations (legacy)
CREATE TABLE IF NOT EXISTS public.translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slide_id uuid NOT NULL REFERENCES public.slides(id) ON DELETE CASCADE,
  ko_screen text,
  ko_narration text,
  tr_screen text,
  tr_narration text,
  tr_section text,
  speed_status text,
  ko_sec integer,
  tr_sec integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "translations_owner_rw" ON public.translations;
CREATE POLICY "translations_owner_rw"
ON public.translations
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

-- verifications (legacy; score는 이후 마이그레이션에서 추가)
CREATE TABLE IF NOT EXISTS public.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  slide_id uuid NOT NULL REFERENCES public.slides(id) ON DELETE CASCADE,
  translation_id uuid REFERENCES public.translations(id) ON DELETE SET NULL,
  back_translation text,
  match boolean,
  edited_tr text,
  apply_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verifications_owner_rw" ON public.verifications;
CREATE POLICY "verifications_owner_rw"
ON public.verifications
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

-- expert reviews
CREATE TABLE IF NOT EXISTS public.expert_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  expert_name text,
  expert_email text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expert_reviews_owner_select" ON public.expert_reviews;
CREATE POLICY "expert_reviews_owner_select"
ON public.expert_reviews
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

DROP POLICY IF EXISTS "expert_reviews_owner_write" ON public.expert_reviews;
CREATE POLICY "expert_reviews_owner_write"
ON public.expert_reviews
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

CREATE TABLE IF NOT EXISTS public.expert_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expert_review_id uuid NOT NULL REFERENCES public.expert_reviews(id) ON DELETE CASCADE,
  slide_id uuid NOT NULL REFERENCES public.slides(id) ON DELETE CASCADE,
  field text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expert_review_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expert_review_items_owner_rw" ON public.expert_review_items;
CREATE POLICY "expert_review_items_owner_rw"
ON public.expert_review_items
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.expert_reviews er
    JOIN public.projects p ON p.id = er.project_id
    WHERE er.id = expert_review_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.expert_reviews er
    JOIN public.projects p ON p.id = er.project_id
    WHERE er.id = expert_review_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

-- change_logs (컬럼들은 이후 마이그레이션에서 보강되지만, 지금도 최종 형태로 생성해도 무방)
CREATE TABLE IF NOT EXISTS public.change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text,
  detail text,
  metadata jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.change_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "change_logs_owner_select" ON public.change_logs;
CREATE POLICY "change_logs_owner_select"
ON public.change_logs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

DROP POLICY IF EXISTS "change_logs_owner_insert" ON public.change_logs;
CREATE POLICY "change_logs_owner_insert"
ON public.change_logs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_id
      AND (p.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = auth.uid() AND pr.role = 'admin'))
  )
);

