import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parsePptx, parseSingleSlide, normalizeScreenText, type ParseProgress, type ParsedSlide } from '../lib/pptxParser'
import { supabase } from '../lib/supabase'
import type { Slide } from '../types'
import { STORAGE_BUCKET } from './useProject'
import { useAuth } from './useAuth'

const slidesQueryKey = ['slides'] as const
const INSERT_BATCH_SIZE = 25

export type { ParseProgress }

export type SlideInsert = Omit<Slide, 'id' | 'created_at'>
export type SlideUpdate = Partial<
  Omit<Slide, 'id' | 'project_id' | 'storyboard_id' | 'slide_num' | 'created_at'>
>

function normalizeSlide(slide: Slide): Slide {
  return {
    ...slide,
    screen_text: normalizeScreenText(slide.screen_text),
    extraction_status: slide.extraction_status ?? 'ok',
    extraction_error: slide.extraction_error ?? null,
  }
}

function normalizeSlides(slides: Slide[]): Slide[] {
  return slides.map(normalizeSlide)
}

function serializeScreenTextForDb(boxes: Slide['screen_text']): string | null {
  if (!boxes?.length) return null
  return JSON.stringify(boxes)
}

function isMissingExtractionColumnError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: string }).message)
      : String(error ?? '')
  return /extraction_status|extraction_error|schema cache/i.test(msg)
}

function withoutExtractionMeta(row: SlideInsert): Record<string, unknown> {
  const { extraction_status: _s, extraction_error: _e, ...rest } = row
  return rest
}

async function insertSlideBatch(batch: SlideInsert[]) {
  const first = await supabase.from('slides').insert(batch).select()
  if (!first.error) return first

  if (isMissingExtractionColumnError(first.error)) {
    return supabase.from('slides').insert(batch.map(withoutExtractionMeta)).select()
  }

  return first
}

export function useSlides(storyboardId: string | undefined) {
  return useQuery({
    queryKey: [...slidesQueryKey, storyboardId],
    queryFn: async (): Promise<Slide[]> => {
      const { data, error } = await supabase
        .from('slides')
        .select('*')
        .eq('storyboard_id', storyboardId!)
        .order('slide_num', { ascending: true })

      if (error) throw error
      return normalizeSlides(data)
    },
    enabled: !!storyboardId,
  })
}

async function downloadPptx(storagePath: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath)
  if (error) throw error
  return data.arrayBuffer()
}

/** 화면 텍스트 + 나레이션 저장 (화면설명·이미지번호 제외) */
function toExtractedSlideRows(
  projectId: string,
  storyboardId: string,
  parsed: ParsedSlide[],
): SlideInsert[] {
  return parsed.map((slide) => ({
    project_id: projectId,
    storyboard_id: storyboardId,
    slide_num: slide.slide_num,
    slide_type: slide.slide_type,
    screen_num: slide.screen_num,
    course_name: slide.course_name,
    chapter_name: slide.chapter_name,
    current_section: slide.current_section,
    screen_text: serializeScreenTextForDb(slide.screen_text) as unknown as SlideInsert['screen_text'],
    screen_desc: null,
    image_nums: null,
    narration: slide.narration,
    extraction_status: slide.extraction_status,
    extraction_error: slide.extraction_error,
  }))
}

function parsedToSlideUpdate(parsed: ParsedSlide): SlideUpdate {
  return {
    slide_type: parsed.slide_type,
    screen_num: parsed.screen_num,
    course_name: parsed.course_name,
    chapter_name: parsed.chapter_name,
    current_section: parsed.current_section,
    screen_text: parsed.screen_text,
    screen_desc: null,
    image_nums: null,
    narration: parsed.narration,
    extraction_status: parsed.extraction_status,
    extraction_error: parsed.extraction_error,
  }
}

async function insertSlideRows(
  rows: SlideInsert[],
  onProgress?: (progress: ParseProgress) => void,
): Promise<Slide[]> {
  const inserted: Slide[] = []
  const total = rows.length

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const { data, error } = await insertSlideBatch(batch)

    if (error) throw error
    inserted.push(...normalizeSlides(data ?? []))

    onProgress?.({
      current: Math.min(i + batch.length, total),
      total,
      phase: 'saving',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return inserted
}

export function useExtractSlides() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      storagePath,
      onProgress,
    }: {
      projectId: string
      storyboardId: string
      storagePath: string
      onProgress?: (progress: ParseProgress) => void
    }): Promise<Slide[]> => {
      const buffer = await downloadPptx(storagePath)
      const parsed = await parsePptx(buffer, onProgress)
      const rows = toExtractedSlideRows(projectId, storyboardId, parsed)

      if (rows.length === 0) {
        throw new Error('PPTX에서 슬라이드를 추출하지 못했습니다.')
      }

      const { error: deleteError } = await supabase
        .from('slides')
        .delete()
        .eq('storyboard_id', storyboardId)

      if (deleteError) throw deleteError

      return insertSlideRows(rows, onProgress)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}

function prepareSlideUpdateForDb(updates: SlideUpdate): Record<string, unknown> {
  const prepared: Record<string, unknown> =
    updates.screen_text === undefined
      ? { ...updates }
      : {
          ...updates,
          screen_text: serializeScreenTextForDb(updates.screen_text ?? null),
        }
  return prepared
}

async function updateSlideRow(id: string, updates: Record<string, unknown>) {
  const first = await supabase.from('slides').update(updates).eq('id', id).select().single()
  if (!first.error) return first

  if (isMissingExtractionColumnError(first.error)) {
    const { extraction_status: _s, extraction_error: _e, ...rest } = updates
    return supabase.from('slides').update(rest).eq('id', id).select().single()
  }

  return first
}

export function useRetrySlideExtraction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId: _projectId,
      storyboardId: _storyboardId,
      storagePath,
      slideId,
      slideNum,
    }: {
      projectId: string
      storyboardId: string
      storagePath: string
      slideId: string
      slideNum: number
    }): Promise<Slide> => {
      const buffer = await downloadPptx(storagePath)
      const parsed = await parseSingleSlide(buffer, slideNum)
      const updates = prepareSlideUpdateForDb(parsedToSlideUpdate(parsed))

      const { data, error } = await updateSlideRow(slideId, updates)

      if (error) throw error
      return normalizeSlide(data)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}

export function useBulkUpdateSlides() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      storyboardId: _storyboardId,
      slides,
    }: {
      storyboardId: string
      slides: Slide[]
    }): Promise<Slide[]> => {
      const results: Slide[] = []

      for (const slide of slides) {
        const { data, error } = await updateSlideRow(slide.id, {
          slide_type: slide.slide_type,
          screen_num: slide.screen_num,
          screen_text: serializeScreenTextForDb(slide.screen_text),
          narration: slide.narration,
          extraction_status: slide.extraction_status ?? 'ok',
          extraction_error: slide.extraction_error,
        })

        if (error) throw error
        results.push(normalizeSlide(data))
      }

      return results
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}

export function useUpdateSlide() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      storyboardId: _storyboardId,
      updates,
    }: {
      id: string
      storyboardId: string
      updates: SlideUpdate
    }): Promise<Slide> => {
      const { data, error } = await updateSlideRow(id, prepareSlideUpdateForDb(updates))

      if (error) throw error
      return normalizeSlide(data)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}

export function useCompleteExtraction() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      storyboardId,
      slides,
    }: {
      projectId: string
      storyboardId: string
      slides: Slide[]
    }): Promise<void> => {
      for (const slide of slides) {
        const { error } = await updateSlideRow(slide.id, {
          slide_type: slide.slide_type,
          screen_num: slide.screen_num,
          screen_text: serializeScreenTextForDb(slide.screen_text),
          narration: slide.narration,
          extraction_status: slide.extraction_status ?? 'ok',
          extraction_error: slide.extraction_error,
        })

        if (error) throw error
      }

      const { error: statusError } = await supabase
        .from('storyboards')
        .update({ status: 'extracted' })
        .eq('id', storyboardId)

      if (statusError) throw statusError

      if (user) {
        await supabase.from('change_logs').insert({
          project_id: projectId,
          user_id: user.id,
          action: 'extraction_done',
          detail: `${slides.length}개 슬라이드 화면 텍스트 추출 완료`,
        })
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['storyboards'] })
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}
