-- 스토리보드 단위 전문가 검증 + 파이프라인 상태

ALTER TABLE expert_reviews
  ADD COLUMN IF NOT EXISTS storyboard_id UUID REFERENCES storyboards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS expert_reviews_storyboard_id_idx ON expert_reviews(storyboard_id);

CREATE OR REPLACE FUNCTION create_expert_review(
  p_project_id UUID,
  p_expert_name TEXT,
  p_expert_email TEXT,
  p_message TEXT DEFAULT NULL,
  p_storyboard_id UUID DEFAULT NULL
)
RETURNS expert_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_token TEXT;
  v_translation_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM projects
    WHERE id = p_project_id AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_storyboard_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storyboards
    WHERE id = p_storyboard_id AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Storyboard not found';
  END IF;

  SELECT COUNT(*) INTO v_translation_count
  FROM translations t
  JOIN slides s ON s.id = t.slide_id
  WHERE t.project_id = p_project_id
    AND (p_storyboard_id IS NULL OR s.storyboard_id = p_storyboard_id)
    AND (t.field LIKE 'screen_text%' OR t.field = 'screen_text');

  IF v_translation_count = 0 THEN
    RAISE EXCEPTION 'No translations';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO expert_reviews (
    project_id,
    storyboard_id,
    token,
    status,
    expert_name,
    expert_email,
    message
  )
  VALUES (
    p_project_id,
    p_storyboard_id,
    v_token,
    'pending',
    NULLIF(trim(p_expert_name), ''),
    NULLIF(trim(p_expert_email), ''),
    NULLIF(trim(p_message), '')
  )
  RETURNING * INTO v_review;

  INSERT INTO expert_review_items (expert_review_id, slide_id, field, status, original_vi_text)
  SELECT v_review.id, t.slide_id, t.field, 'pending', t.vi_text
  FROM translations t
  JOIN slides s ON s.id = t.slide_id
  WHERE t.project_id = p_project_id
    AND (p_storyboard_id IS NULL OR s.storyboard_id = p_storyboard_id)
    AND (t.field LIKE 'screen_text%' OR t.field = 'screen_text');

  IF p_storyboard_id IS NOT NULL THEN
    UPDATE storyboards
    SET status = 'expert_review', updated_at = now()
    WHERE id = p_storyboard_id;
  ELSE
    UPDATE projects
    SET status = 'expert_review', updated_at = now()
    WHERE id = p_project_id;
  END IF;

  RETURN v_review;
END;
$$;

CREATE OR REPLACE FUNCTION complete_expert_review(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review expert_reviews%ROWTYPE;
  v_pending INT;
BEGIN
  SELECT * INTO v_review
  FROM expert_reviews
  WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found';
  END IF;

  SELECT COUNT(*) INTO v_pending
  FROM expert_review_items
  WHERE expert_review_id = v_review.id AND status = 'pending';

  IF v_pending > 0 THEN
    RAISE EXCEPTION 'Pending items remain';
  END IF;

  UPDATE expert_reviews
  SET status = 'done'
  WHERE id = v_review.id;

  IF v_review.storyboard_id IS NOT NULL THEN
    UPDATE storyboards
    SET status = 'done', updated_at = now()
    WHERE id = v_review.storyboard_id;
  END IF;

  UPDATE projects
  SET status = 'done', updated_at = now()
  WHERE id = v_review.project_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION create_expert_review(UUID, TEXT, TEXT, TEXT, UUID) TO authenticated;
