import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parsePptx, normalizeScreenText, type ParseProgress, type ParsedSlide } from '../lib/pptxParser'
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
  }
}

function normalizeSlides(slides: Slide[]): Slide[] {
  return slides.map(normalizeSlide)
}

function serializeScreenTextForDb(boxes: Slide['screen_text']): string | null {
  if (!boxes?.length) return null
  return JSON.stringify(boxes)
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

/** v2: 화면 텍스트만 저장 */
function toScreenTextOnlySlideRows(
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
    narration: null,
  }))
}

async function insertSlideRows(
  rows: SlideInsert[],
  onProgress?: (progress: ParseProgress) => void,
): Promise<Slide[]> {
  const inserted: Slide[] = []
  const total = rows.length

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const { data, error } = await supabase.from('slides').insert(batch).select()

    if (error) throw error
    inserted.push(...normalizeSlides(data))

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
      const rows = toScreenTextOnlySlideRows(projectId, storyboardId, parsed)

      const { error: deleteError } = await supabase
        .from('slides')
        .delete()
        .eq('storyboard_id', storyboardId)

      if (deleteError) throw deleteError

      if (rows.length === 0) return []

      return insertSlideRows(rows, onProgress)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...slidesQueryKey, variables.storyboardId] })
    },
  })
}

function prepareSlideUpdateForDb(updates: SlideUpdate): Record<string, unknown> {
  if (updates.screen_text === undefined) return updates
  return {
    ...updates,
    screen_text: serializeScreenTextForDb(updates.screen_text ?? null),
  }
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
        const { data, error } = await supabase
          .from('slides')
          .update({
            slide_type: slide.slide_type,
            screen_num: slide.screen_num,
            screen_text: serializeScreenTextForDb(slide.screen_text),
          })
          .eq('id', slide.id)
          .select()
          .single()

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
      const { data, error } = await supabase
        .from('slides')
        .update(prepareSlideUpdateForDb(updates))
        .eq('id', id)
        .select()
        .single()

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
        const { error } = await supabase
          .from('slides')
          .update({
            slide_type: slide.slide_type,
            screen_num: slide.screen_num,
            screen_text: serializeScreenTextForDb(slide.screen_text),
          })
          .eq('id', slide.id)

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
