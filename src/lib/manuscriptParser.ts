import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import JSZip from 'jszip'

const SUPPORTED_EXTENSIONS = ['.txt', '.docx', '.pdf', '.ppt', '.pptx'] as const

export type ManuscriptExtension = (typeof SUPPORTED_EXTENSIONS)[number]

export const MANUSCRIPT_ACCEPT = '.txt,.docx,.pdf,.ppt,.pptx'
export const MANUSCRIPT_FORMAT_LABEL = 'TXT, DOCX, PDF, PPT, PPTX'
export const MANUSCRIPT_UNSUPPORTED_MSG =
  '원고는 TXT, DOCX, PDF, PPT, PPTX만 업로드할 수 있습니다.'

let pdfWorkerReady = false

function ensurePdfWorker(): void {
  if (pdfWorkerReady) return
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  pdfWorkerReady = true
}

export function isManuscriptFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function getManuscriptExtension(fileName: string): ManuscriptExtension | '' {
  const lower = fileName.toLowerCase()
  for (const ext of SUPPORTED_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext
  }
  return ''
}

export function getManuscriptContentType(extension: ManuscriptExtension): string {
  switch (extension) {
    case '.txt':
      return 'text/plain'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.pdf':
      return 'application/pdf'
    case '.ppt':
      return 'application/vnd.ms-powerpoint'
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    default:
      return 'application/octet-stream'
  }
}

function isZipBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function collectTextNodesByLocalName(root: Element, localName: string): Element[] {
  const result: Element[] = []
  const walk = (node: Element) => {
    if (node.localName === localName) result.push(node)
    for (const child of Array.from(node.children)) {
      if (child instanceof Element) walk(child)
    }
  }
  walk(root)
  return result
}

function extractOoxmlParagraphs(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const paragraphs = collectTextNodesByLocalName(doc.documentElement, 'p')
  if (paragraphs.length === 0) {
    const text = collectTextNodesByLocalName(doc.documentElement, 't')
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
    return text ? [text] : []
  }

  return paragraphs
    .map((p) =>
      collectTextNodesByLocalName(p, 't')
        .map((node) => node.textContent ?? '')
        .join(''),
    )
    .map((line) => line.trim())
    .filter(Boolean)
}

async function extractTxtText(file: File): Promise<string> {
  return file.text()
}

async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) {
    throw new Error('DOCX에서 document.xml을 찾을 수 없습니다.')
  }

  return extractOoxmlParagraphs(documentXml).join('\n').trim()
}

async function extractPptxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(buffer)
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/i)?.[1] ?? '0', 10)
      const nb = parseInt(b.match(/slide(\d+)/i)?.[1] ?? '0', 10)
      return na - nb
    })

  if (slidePaths.length === 0) {
    throw new Error('PPTX에서 슬라이드 텍스트를 찾을 수 없습니다.')
  }

  const slideTexts: string[] = []
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async('string')
    if (!xml) continue
    const paragraphs = extractOoxmlParagraphs(xml)
    if (paragraphs.length > 0) {
      slideTexts.push(paragraphs.join('\n'))
    }
  }

  return slideTexts.join('\n\n').trim()
}

function extractLegacyPptText(buffer: ArrayBuffer): string {
  const view = new DataView(buffer)
  const parts: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < view.byteLength - 1; i += 2) {
    let text = ''
    let j = i

    while (j < view.byteLength - 1) {
      const code = view.getUint16(j, true)
      j += 2

      const isPrintable =
        code === 0x0009 ||
        code === 0x000a ||
        code === 0x000d ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd)

      if (!isPrintable) break
      text += String.fromCharCode(code)
    }

    const normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length >= 6 && !seen.has(normalized)) {
      seen.add(normalized)
      parts.push(normalized)
    }
  }

  return parts.join('\n').trim()
}

async function extractPptText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()

  if (isZipBuffer(buffer)) {
    return extractPptxText(file)
  }

  const text = extractLegacyPptText(buffer)
  if (!text) {
    throw new Error('PPT에서 텍스트를 추출하지 못했습니다. PPTX로 저장 후 다시 시도해 주세요.')
  }

  return text
}

async function extractPdfText(file: File): Promise<string> {
  ensurePdfWorker()
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data }).promise

  const pages: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) pages.push(text)
  }

  return pages.join('\n').trim()
}

export async function extractManuscriptText(file: File): Promise<string> {
  const ext = getManuscriptExtension(file.name)
  if (!ext) {
    throw new Error(MANUSCRIPT_UNSUPPORTED_MSG)
  }

  let text: string
  switch (ext) {
    case '.txt':
      text = await extractTxtText(file)
      break
    case '.docx':
      text = await extractDocxText(file)
      break
    case '.pdf':
      text = await extractPdfText(file)
      break
    case '.pptx':
      text = await extractPptxText(file)
      break
    case '.ppt':
      text = await extractPptText(file)
      break
    default:
      throw new Error(MANUSCRIPT_UNSUPPORTED_MSG)
  }

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    throw new Error('원고에서 텍스트를 추출하지 못했습니다.')
  }

  return normalized
}
