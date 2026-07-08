import JSZip from 'jszip'

const SUPPORTED_EXTENSIONS = ['.txt', '.docx'] as const

export function isManuscriptFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function getManuscriptExtension(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.docx')) return '.docx'
  if (lower.endsWith('.txt')) return '.txt'
  return ''
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

  const doc = new DOMParser().parseFromString(documentXml, 'application/xml')
  const textNodes = doc.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    't',
  )

  const paragraphs: string[] = []
  let current = ''

  const body = doc.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'body',
  )[0]

  if (!body) {
    return Array.from(textNodes)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
  }

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.localName === 't') {
        current += child.textContent ?? ''
      } else if (child.localName === 'p') {
        walk(child)
        if (current.trim()) {
          paragraphs.push(current.trim())
        }
        current = ''
      } else {
        walk(child)
      }
    }
  }

  walk(body)
  if (current.trim()) paragraphs.push(current.trim())

  return paragraphs.join('\n').trim()
}

export async function extractManuscriptText(file: File): Promise<string> {
  const lower = file.name.toLowerCase()
  let text: string

  if (lower.endsWith('.txt')) {
    text = await extractTxtText(file)
  } else if (lower.endsWith('.docx')) {
    text = await extractDocxText(file)
  } else {
    throw new Error('원고는 TXT 또는 DOCX 파일만 지원합니다.')
  }

  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    throw new Error('원고에서 텍스트를 추출하지 못했습니다.')
  }

  return normalized
}
