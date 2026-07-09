-- 슬라이드별 PPTX 추출 성공/실패 상태
alter table slides
  add column if not exists extraction_status text not null default 'ok',
  add column if not exists extraction_error text;

comment on column slides.extraction_status is 'PPTX 추출 결과: ok | failed';
comment on column slides.extraction_error is '추출 실패 시 사유';
