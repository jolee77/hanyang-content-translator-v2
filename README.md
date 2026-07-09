# 한양대 콘텐츠 번역기 (v2)

한국어 이러닝 스토리보드(PPTX)를 목표 언어로 번역하는 웹서비스.
프로젝트·스토리보드 단위로 추출·AI 파이프라인·전문가 검증·산출물 다운로드를 지원합니다.

## 기술 스택

- React 19 + Vite + TypeScript
- Tailwind CSS v4
- Supabase (Auth, DB, Storage, Edge Functions)
- React Query + React Router
- 배포: Vercel

## 시작하기

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env에 Supabase URL·anon key 입력 후 dev 서버 재시작

VITE_SUPABASE_URL=https://qliwoporrrxjykrfuewg.supabase.co
VITE_SUPABASE_ANON_KEY=<dashboard anon key>

# 개발 서버
npm run dev
# 또는
npm run start:dev

# 프로덕션 빌드
npm run build
```

## 주요 라우트

| 경로 | 설명 |
|------|------|
| `/login` | 로그인 |
| `/dashboard` | 프로젝트 목록 |
| `/projects/new` | 새 프로젝트 (목표 언어·번역 가이드라인) |
| `/projects/:id` | 스토리보드 목록 / PPTX·원고 업로드 |
| `/projects/:projectId/storyboards/:storyboardId` | 4단계 워크플로 |
| `/review/:token` | 전문가 검증 (토큰) |
| `/admin/*` | 관리자 (API 설정·사용자·전체 프로젝트) |

## 워크플로 (스토리보드)

1. **화면 텍스트 추출** — PPTX 파싱 + 원고(TXT/DOCX/PDF/PPT/PPTX) 정합성 검증
   - 마스터/레이아웃 텍스트까지 병합해 슬라이드별 `screen_text`·`narration`을 함께 추출
   - 추출 실패 슬라이드는 사유를 표시하고 개별 재시도를 지원
2. **맞춤법·번역·역번역** — AI 일괄 처리 (`project.target_lang`)
   - 맞춤법은 자동 반영하지 않고, 먼저 승인/거절 검토 후 승인 건만 슬라이드에 반영
   - 대량 처리 시 청크 진행률을 UI에 표시
3. **전문가 검증** — 토큰 링크 공유
4. **완료** — 영문 화면 PPTX / 엑셀 다운로드

## 배포·인프라

| 항목 | URL / 값 |
|------|----------|
| 프로덕션 | https://sb-translator-v2.vercel.app |
| GitHub | https://github.com/jolee77/hanyang-content-translator-v2 |
| Supabase (v2 전용) | `hanyang-content-translator-v2` (`qliwoporrrxjykrfuewg`) |

- Auth Redirect URL: `https://sb-translator-v2.vercel.app/**`, `http://localhost:5173/**`
- v1 Supabase와 **분리됨** (공유하지 않음)

## 최근 업데이트 (2026-07-09)

- UI 시스템명: **한양대 콘텐츠 번역기**
- 프로젝트·스토리보드 계층, 원고 정합성, 멀티 AI API
- 목표 언어는 프로젝트 생성 시에만 선택
- v2 전용 Supabase 생성·마이그레이션·함수 배포 완료
- Git 저장소 초기화 및 `main` 푸시 완료
- PPTX 파서가 슬라이드 마스터/레이아웃 상속 텍스트를 포함하도록 개선
- 슬라이드별 추출 성공/실패 상태 및 실패 사유 저장
- 맞춤법 검토를 `승인 -> 슬라이드 반영 -> PPTX 다운로드` 흐름으로 분리

### 다음에 할 일 (요약)
1. ~~Supabase Auth Redirect URL~~ — 완료 (`config push`)
2. ~~Storage `pptx-files`~~ — 완료 (마이그레이션)
3. ~~최초 관리자~~ — `bootstrap-admin` 1회 실행 완료
4. **관리자 → API 설정**에서 AI 제공자·API 키 등록
5. Vercel ↔ GitHub 저장소 연결 (대시보드 수동)
6. PPTX·원고 업로드 E2E 스모크 테스트

상세 스펙·TODO: [CLAUDE.md](./CLAUDE.md)
