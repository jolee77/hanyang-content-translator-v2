# 한양대 콘텐츠 번역기 (v2)

## 프로젝트 개요
한국어 이러닝 스토리보드(PPTX)를 목표 언어로 번역하는 웹서비스.
**프로젝트 → 스토리보드** 계층으로 설계담당자가 번역 프로세스를 진행하고, 외부 전문가가 검증하는 협업 시스템.
시스템 UI 명칭: **한양대 콘텐츠 번역기** (`Layout` 좌측 상단 / 로그인 / 브라우저 title)

## 기술 스택
- Frontend: React 19 + Vite + TypeScript
- Styling: Tailwind CSS v4 (`nb-*` nextBMS 유틸)
- Backend: Supabase (Auth + DB + Storage + Edge Functions)
- AI: Claude / OpenAI / Google Gemini — 관리자에서 제공자 선택 후 Edge Function에서 호출
- 배포: Vercel

## 배포·원격 정보
| 항목 | 값 |
|------|-----|
| 앱 URL | https://sb-translator-v2.vercel.app |
| GitHub | https://github.com/jolee77/hanyang-content-translator-v2 |
| Vercel 프로젝트 | `sb-translator-v2` |
| Supabase | `hanyang-content-translator-v2` (`qliwoporrrxjykrfuewg`) |
| v1 Supabase (분리됨) | `elearning-translator` (`jprclgxtaxksocxeqoze`) — **사용하지 않음** |

## Supabase 설정 (v2 전용)
```
VITE_SUPABASE_URL=https://qliwoporrrxjykrfuewg.supabase.co
VITE_SUPABASE_ANON_KEY=<Supabase Dashboard → API → anon key>
```
- `.env`는 프로젝트 루트에 두고, 수정 후 **dev 서버 재시작**
- **v1 DB와 공유하지 않음** (2026-07-08 분리 완료)
- IPv4-only 네트워크에서 `supabase db push`는 pooler 세션 모드 사용  
  예: `postgresql://postgres.<ref>:<pw>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`

## 로컬 개발 시 로그인
- Vercel과 localhost 세션은 공유되지 않음 → 로컬에서 별도 로그인
- 비밀번호 오류 토스트: 「이메일 또는 비밀번호가 올바르지 않습니다」
- 「비밀번호를 잊으셨나요?」→ `/reset-password`
- Supabase Auth Redirect URLs에 등록 필요:
  - `https://sb-translator-v2.vercel.app/**`
  - `http://localhost:5173/**`
- 새 Supabase는 사용자가 비어 있음 → 관리자에서 `register-user`로 계정 생성 후 로그인

## 데이터 모델

> 컬럼명은 `src/types/index.ts` 및 Supabase 스키마와 동일. 임의 명명 금지.

### profiles
- `id`, `email`, `name`, `role` (`admin` | `designer`), `created_at`, `updated_at`

### settings (key-value)
- `key` / `value` 예: `active_ai_provider`, `claude_api_key`, `openai_api_key`, `google_api_key`
- **목표 언어 기본값(`default_target_lang`)은 API 설정에서 사용하지 않음** — 프로젝트 생성 시 `projects.target_lang`만 사용

### projects
- `id`, `created_by`, `title`, `status`, `target_lang`, `translation_guidelines`
- `source_pptx_url` / `source_pptx_name` / `vn_pptx` 등은 레거시(v1) 호환 컬럼 가능
- `created_at`, `updated_at`

### storyboards
- `id`, `project_id`, `title`, `status`
- `source_pptx_url`, `source_pptx_name`
- `source_manuscript_url`, `source_manuscript_name`, `manuscript_text`
- `created_at`, `updated_at`

### slides
- `id`, `project_id`, `storyboard_id`, `slide_num`, `slide_type`, `screen_num`
- `course_name`, `chapter_name`, `current_section`
- `screen_text` (text — JSON 문자열), `screen_desc`, `image_nums`, `narration`, `created_at`

### spelling_results / translations / verifications
- `project_id` + (가능하면) `storyboard_id` 기준
- translations: `field`, `source`, `vi_text`, `cpm`, `vi_wpm`
- verifications: `back_translation`, `score`, `issues`, `apply_status`

### expert_reviews
- `id`, `project_id`, `storyboard_id`, `token`, `status`, `expert_name`, `expert_email`, `message`, `created_at`

### expert_review_items
- `id`, `expert_review_id`, `slide_id`, `field`, `status` (`pending` | `reviewed`), `comment`, `original_vi_text`

### change_logs
- `id`, `project_id`, `user_id`, `action`, `detail`, `metadata`, `changed_at`

### Storage
- 버킷: `pptx-files`
- PPTX: `{userId}/{projectId}/{storyboardId}/source.pptx`
- 원고: `{userId}/{projectId}/{storyboardId}/manuscript.{txt|docx|pdf|ppt|pptx}`

## 스토리보드 status 흐름
```
uploaded → extracted → spelling → spelling_done → translating → translated
  → verifying → verified → expert_review → done
```

UI는 **4단계**로 통합 (`src/lib/storyboardStatus.ts`):
1. 화면 텍스트 추출
2. 맞춤법·번역·역번역 (일괄 AI)
3. 전문가 검증
4. 완료

## 화면 구조
```
/login                                              로그인
/dashboard                                          프로젝트 목록
/projects/new                                       새 프로젝트 (목표 언어·번역 가이드라인)
/projects/:id                                       스토리보드 목록 + PPTX·원고 업로드
/projects/:projectId/storyboards/:storyboardId      4단계 워크플로
  Step1: ScreenTextExtractionStep   화면 텍스트 + 원고 정합성
  Step2: ScreenTextPipelineStep     맞춤법→자동적용→번역→역번역
  Step3: StoryboardExpertReviewStep 전문가 링크·현황
  Step4: StoryboardDoneStep         엑셀 / 영문 화면 PPTX
/review/:token                                      전문가 검증 (비로그인)
/admin/settings                                     AI 제공자 + API 키
/admin/users                                        사용자 등록·수정
/admin/projects                                     전체 프로젝트
```

## 원고(대본) 정합성
- 스토리보드 추가 시 **PPTX + 원고(TXT/DOCX/PDF/PPT/PPTX)** 필수 업로드
- `src/lib/manuscriptParser.ts` — 텍스트 추출
- `src/lib/manuscriptConsistency.ts` — 화면 텍스트와 원고 비교
- Step1 UI에서 일치/불일치 건수·목록 표시

## PPTX 파싱 (좌표 — PLC 실측)
```typescript
const SB_CX = 12192000
const SB_CY = 6858000

isScreenNum:   x/CX > 0.79 && y/CY < 0.12 && w/CX < 0.20
isCourseName:  x/CX > 0.10 && x/CX < 0.50 && y/CY >= 0.04 && y/CY < 0.08
isChapterName: x/CX > 0.10 && x/CX < 0.35 && y/CY >= 0.08 && y/CY < 0.15
isMenu:        박스 전체가 x/CX <= 0.25
isScreen:      중앙 화면(13%~75%)과 겹침
isScreenDesc:  x/CX >= 0.75 && y/CY < 0.63
isImageNum:    x/CX >= 0.75 && y/CY >= 0.63 && y/CY < 0.78
isNarration:   y/CY >= 0.78
```
- v2 Phase 1은 **화면 텍스트 중심** (나레이션 파이프라인은 Phase 2)
- `screen_text`는 JSON 문자열로 저장 (`normalizeScreenText` / `serializeScreenTextForDb`)
- 싱크 마커 `#N` 단독 박스는 화면텍스트에서 제외, 나레이션에는 유지

## 산출물 (v2 Phase 1)
1. **영문 화면 PPTX** — `generateEnglishScreenPptx`: KO PPTX의 화면 텍스트를 검증된 번역으로 **inplace 교체**
2. **엑셀** — 국문–목표언어 시트 (`SheetJS`)
3. (레거시) VN 오버레이 PPTX 로직은 `pptxGenerator`에 남아 있을 수 있으나 Phase 1 완료 화면은 영문 화면 PPTX 기준

## AI / Edge Functions
- `/functions/v1/spelling-check`
- `/functions/v1/translate` — `storyboard_id`, `screen_text_only` 지원
- `/functions/v1/verify`
- `/functions/v1/extract-glossary`
- `/functions/v1/register-user` / `/functions/v1/update-user`
- 공용: `supabase/functions/_shared/ai.ts` (멀티 프로바이더)
- settings의 `active_ai_provider` + 해당 API 키 사용

## 언어별 발화속도
```typescript
const LANG_CONFIG = {
  vi: { name: '베트남어', wpm: 155 },
  en: { name: '영어', wpm: 150 },
  zh: { name: '중국어(간체)', wpm: 220 },
  ja: { name: '일본어', wpm: 400 },
  id: { name: '인도네시아어', wpm: 145 },
}
const KO_CPM = 320
```

## 전문가 검증
- `create_expert_review` — optional `p_storyboard_id`
- token: `extensions.gen_random_bytes`
- RPC: `get_expert_review_by_token`, `save_expert_review_item`, `complete_expert_review`
- UI 필드 순서: 한국어 → 번역문 → 역번역
- 스토리보드 단위로 `expert_reviews.storyboard_id` 연결

## UI 테마
- primary `#162B52`, accent `#4B40E0`
- `nb-*` 클래스: `src/index.css`, `Layout.tsx`

## 주요 마이그레이션 (v2 신규분)
| 파일 | 내용 |
|------|------|
| `20250623000000_init_schema.sql` | 빈 프로젝트용 초기 스키마 (신규 Supabase 필수) |
| `20250708120000_v2_storyboards_multi_api.sql` | storyboards, guidelines, multi-API |
| `20250708140000_storyboard_expert_review.sql` | expert_reviews.storyboard_id + RPC |
| `20250708150000_storyboard_manuscript.sql` | 원고 컬럼 |
| `20250709100000_storage_pptx_bucket.sql` | `pptx-files` 버킷 + Storage RLS |
| `20250709100100_auth_user_trigger.sql` | `auth.users` → `profiles` 트리거 |

## 구현 현황 (2026-07-08)

### 완료
- [x] 시스템명「한양대 콘텐츠 번역기」UI 반영
- [x] 프로젝트·스토리보드 계층 + 번역 가이드라인
- [x] 목표 언어: 프로젝트 생성 시에만 선택 (API 설정에서 제거)
- [x] 멀티 AI (Claude / OpenAI / Gemini)
- [x] 사용자 등록·수정 (`register-user`, `update-user`)
- [x] 스토리보드 4단계 워크플로
- [x] PPTX + 원고 업로드 / 원고 정합성 검증
- [x] v2 전용 Supabase 생성·마이그레이션·Edge Function 배포
- [x] Vercel 프로덕션 배포 + env를 v2 Supabase로 교체
- [x] GitHub 저장소 초기화·푸시 (`hanyang-content-translator-v2`)

### 내일·이후 TODO
| 우선순위 | 항목 | 설명 |
|---------|------|------|
| ~~높음~~ | ~~Storage 버킷~~ | `20250709100000_storage_pptx_bucket.sql` 적용 완료 |
| ~~높음~~ | ~~Auth Redirect URL~~ | `supabase/config.toml` + `config push` 완료 |
| ~~높음~~ | ~~최초 관리자~~ | `bootstrap-admin` Edge Function으로 1회 생성 (이후 409) |
| 중 | Vercel↔GitHub 연결 | CLI `vercel git connect` 실패 — Vercel 대시보드에서 수동 연결 |
| 중 | Storage / 업로드 스모크 | 실제 PPTX·원고 업로드 E2E 테스트 |
| 중 | 관리자 API 키 등록 | `/admin/settings`에서 AI 제공자·키 설정 |
| 낮음 | Phase 2 | 영상 기반 전문가 나레이션 추출 → 중국어 번역 |
| 낮음 | 공통 UI 리팩터 | Button, Card, Badge 등 |
| 낮음 | 레거시 v1 Step 컴포넌트 | `src/components/project/*` (`@ts-nocheck`) 정리 |

## 최초 관리자 부트스트랩 (1회)

1. Supabase Secrets: `BOOTSTRAP_SECRET` 설정
2. `bootstrap-admin` 함수 배포
3. POST `/functions/v1/bootstrap-admin` — body: `{ email, name, password, secret }`
4. 관리자가 1명 생기면 동일 API는 409 반환 (재실행 불가)
5. 로그인 후 비밀번호 변경 권장

## Supabase config.toml

`supabase/config.toml` — Auth `site_url`, `additional_redirect_urls`  
변경 후: `npx supabase config push --yes`

## 폴더 구조 (핵심)
```
src/
  components/
    storyboard/   ScreenTextExtractionStep, ScreenTextPipelineStep,
                  StoryboardExpertReviewStep, StoryboardDoneStep, ...
    project/      (v1 레거시 스텝 — Phase1 플로에서는 미사용)
    layout/       Layout
    auth/         ProtectedRoute, AdminRoute
  pages/
    DashboardPage, NewProjectPage, ProjectDetailPage,
    StoryboardDetailPage, ExpertReviewPage, LoginPage, ...
    admin/        SettingsPage, UsersPage, ProjectsPage
  hooks/
    useStoryboard, useStoryboardPipeline, useProject, useSlides, ...
  lib/
    manuscriptParser, manuscriptConsistency, pptxParser, pptxGenerator,
    storyboardStatus, supabase, claudeApi, ...
supabase/
  migrations/     init + v1→v2 누적 SQL
  functions/      translate, spelling-check, verify, register-user, update-user, ...
```

## 코딩 컨벤션
- TypeScript strict, 함수형 named export
- React Query + useState
- try/catch + toast
- 한국어 UI
- 배포 시 `.env` / 시크릿 / `lib/` 샘플 / `supabase/.temp` 커밋 금지
