import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { Window } from 'happy-dom'

const SB_CX = 12_192_000
const SB_CY = 6_858_000

const pptxPath = process.argv[2]
const slideNum = parseInt(process.argv[3] ?? '41', 10)
if (!pptxPath) {
  console.error('Usage: node scripts/debug-slide.mjs <pptx> [slideNum]')
  process.exit(1)
}

const { DOMParser, Element } = new Window()
global.DOMParser = DOMParser
global.Element = Element

const { parsePptx } = await import('../src/lib/pptxParser.ts')

const buffer = readFileSync(pptxPath)
const slides = await parsePptx(buffer)
const slide = slides.find((s) => s.slide_num === slideNum)

console.log('Total parsed slides:', slides.length)
console.log('Slide', slideNum, ':', JSON.stringify(slide, null, 2))

// Raw shape dump from XML
const zip = await JSZip.loadAsync(buffer)
const xml = await zip.file(`ppt/slides/slide${slideNum}.xml`).async('string')
const doc = new DOMParser().parseFromString(xml, 'text/xml')

function attrInt(el, name) {
  if (!el) return 0
  const val = el.getAttribute(name) ?? el.getAttribute(`a:${name}`)
  return val ? parseInt(val, 10) : 0
}

function firstXfrm(shape) {
  const walk = (node) => {
    if (node.localName === 'xfrm') return node
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 1) {
        const f = walk(c)
        if (f) return f
      }
    }
    return null
  }
  return walk(shape)
}

function getText(sp) {
  const texts = []
  const walk = (node) => {
    if (node.localName === 't' && node.textContent) texts.push(node.textContent)
    for (const c of Array.from(node.childNodes)) if (c.nodeType === 1) walk(c)
  }
  walk(sp)
  return texts.join('')
}

const isMenu = (x, y, w, h) => {
  const xRight = (x + w) / SB_CX
  const yBottom = (y + h) / SB_CY
  return xRight <= 0.25 && y / SB_CY >= 0.08 && yBottom <= 0.78
}

const overlaps = (x, y, w, h) => {
  if (w <= 0 && h <= 0) {
    const cx = x / SB_CX
    const cy = y / SB_CY
    return cx > 0.13 && cx < 0.75 && cy > 0.08 && cy < 0.78
  }
  const xR = x / SB_CX
  const xRight = (x + Math.max(w, 0)) / SB_CX
  const yR = y / SB_CY
  const yBottom = (y + Math.max(h, 0)) / SB_CY
  if (xRight > 0.13 && xR < 0.75 && yBottom > 0.08 && yR < 0.78) return true
  const cx = (x + w / 2) / SB_CX
  const cy = (y + h / 2) / SB_CY
  return cx > 0.13 && cx < 0.75 && cy > 0.08 && cy < 0.78
}

console.log('\n--- Raw shapes in slide XML ---')
for (const sp of Array.from(doc.getElementsByTagName('*')).filter((n) => n.localName === 'sp')) {
  const text = getText(sp).trim()
  if (!text) continue
  const xfrm = firstXfrm(sp)
  const off = xfrm?.getElementsByTagName('*').find((n) => n.localName === 'off')
  const ext = xfrm?.getElementsByTagName('*').find((n) => n.localName === 'ext')
  const x = attrInt(off, 'x')
  const y = attrInt(off, 'y')
  const w = attrInt(ext, 'cx')
  const h = attrInt(ext, 'cy')
  console.log({
    text: text.slice(0, 40),
    x,
    y,
    w,
    h,
    xPct: (x / SB_CX).toFixed(3),
    xRightPct: ((x + w) / SB_CX).toFixed(3),
    yPct: (y / SB_CY).toFixed(3),
    overlap: overlaps(x, y, w, h),
    menu: isMenu(x, y, w, h),
  })
}
