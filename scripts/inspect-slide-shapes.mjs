import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { Window } from 'happy-dom'

const SB_CX = 12_192_000
const SB_CY = 6_858_000
const pptxPath = process.argv[2]
const slideNum = parseInt(process.argv[3] ?? '9', 10)

const { DOMParser } = new Window()
global.DOMParser = DOMParser

const { parseSingleSlide } = await import('../src/lib/pptxParser.ts')

const buf = readFileSync(pptxPath)
const zip = await JSZip.loadAsync(buf)

async function getMergedShapes(bundle, slideNum) {
  // inline minimal - use parser internals via parse and raw xml
}

const slide = await parseSingleSlide(buf, slideNum)
console.log('PARSED screen:', slide.screen_text?.map((b) => b.text))
console.log('PARSED narration:', slide.narration)

const slideRels = await zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`).async('string')
const layoutMatch = slideRels.match(/slideLayouts\/(slideLayout\d+\.xml)/)
const layoutPath = layoutMatch ? `ppt/slideLayouts/${layoutMatch[1]}` : null

async function shapesFrom(path) {
  const xml = await zip.file(path).async('string')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const walk = (node, fn) => {
    if (node.localName) fn(node)
    for (const c of node.children || []) walk(c, fn)
  }
  const getText = (sp) => {
    const t = []
    walk(sp, (n) => {
      if (n.localName === 't' && n.textContent) t.push(n.textContent)
    })
    return t.join('')
  }
  const getXfrm = (sp) => {
    let f = null
    walk(sp, (n) => {
      if (n.localName === 'xfrm') f = n
    })
    return f
  }
  const cSld = [...doc.getElementsByTagName('*')].find((n) => n.localName === 'cSld')
  const spTree = [...(cSld?.children || [])].find((n) => n.localName === 'spTree')
  const out = []
  if (!spTree) return out
  for (const sp of [...spTree.getElementsByTagName('*')].filter((n) => n.localName === 'sp')) {
    const text = getText(sp).trim()
    if (!text) continue
    const xfrm = getXfrm(sp)
    const off = [...(xfrm?.children || [])].find((n) => n.localName === 'off')
    const ext = [...(xfrm?.children || [])].find((n) => n.localName === 'ext')
    const x = +off?.getAttribute('x') || 0
    const y = +off?.getAttribute('y') || 0
    const w = +ext?.getAttribute('cx') || 0
    const h = +ext?.getAttribute('cy') || 0
    out.push({ text: text.slice(0, 80), xPct: +(x / SB_CX).toFixed(3), yPct: +(y / SB_CY).toFixed(3), wPct: +(w / SB_CX).toFixed(3), hPct: +(h / SB_CY).toFixed(3) })
  }
  return out
}

const master = await shapesFrom('ppt/slideMasters/slideMaster1.xml')
const layout = layoutPath ? await shapesFrom(layoutPath) : []
const slideShapes = await shapesFrom(`ppt/slides/slide${slideNum}.xml`)

const all = [...master, ...layout, ...slideShapes]
for (const s of all.filter((s) => s.text.length > 3)) {
  const nar = s.yPct >= 0.74 || (s.yPct >= 0.7 && s.xPct < 0.15)
  const desc = s.xPct >= 0.75 && s.yPct < 0.63
  const img = s.xPct >= 0.75 && s.yPct >= 0.63 && s.yPct < 0.78
  const screen = s.xPct > 0.13 && s.xPct + s.wPct < 0.8 && s.yPct > 0.08 && s.yPct < 0.78
  if (/#|모션|prompt|Providing|optimal|즉|가이드|방향/i.test(s.text)) {
    console.log({ ...s, nar, desc, img, screen })
  }
}
