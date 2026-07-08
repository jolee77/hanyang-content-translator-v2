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

VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key

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

1. **화면 텍스트 추출** — PPTX 파싱 + 원고(TXT/DOCX) 정합성 검증
2. **맞춤법·번역·역번역** — AI 일괄 처리 (`project.target_lang`)
3. **전문가 검증** — 토큰 링크 공유
4. **완료** — 영문 화면 PPTX / 엑셀 다운로드

## 배포

- 프로덕션: [sb-translator-v2.vercel.app](https://sb-translator-v2.vercel.app)
- Supabase (v2 전용): `hanyang-content-translator-v2` (`qliwoporrrxjykrfuewg`)
- Auth Redirect URL에 `https://sb-translator-v2.vercel.app/**`, `http://localhost:5173/**` 등록 필요

상세 스펙은 [CLAUDE.md](./CLAUDE.md)를 참고하세요.
