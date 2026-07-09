import { readFileSync } from 'fs'
import JSZip from 'jszip'
import { Window } from 'happy-dom'

const SB_CX = 12_192_000
const SB_CY = 6_858_000
const pptxPath = process.argv[2]
const slideNum = parseInt(process.argv[3] ?? '128', 10)

const { DOMParser } = new Window()
global.DOMParser = DOMParser

const buf = readFileSync(pptxPath)
const zip = await JSZip.loadAsync(buf)

async function shapesFromPath(path, label) {
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
  const result = []
  if (!spTree) return result
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
    result.push({
      label,
      text: text.slice(0, 60),
      xPct: (x / SB_CX).toFixed(3),
      yPct: (y / SB_CY).toFixed(3),
      menu: (x + w) / SB_CX <= 0.25,
    })
  }
  return result
}

const slideRels = await zip.file(`ppt/slides/_rels/slide${slideNum}.xml.rels`).async('string')
const layoutMatch = slideRels.match(/slideLayout(\d+)\.xml/)
const layoutPath = layoutMatch
  ? `ppt/slideLayouts/slideLayout${layoutMatch[1]}.xml`
  : null

const all = [
  ...(await shapesFromPath('ppt/slideMasters/slideMaster1.xml', 'master')),
  ...(layoutPath ? await shapesFromPath(layoutPath, 'layout') : []),
  ...(await shapesFromPath(`ppt/slides/slide${slideNum}.xml`, 'slide')),
]

for (const s of all.filter((s) => /Outro|05|01|화면번호/i.test(s.text))) {
  console.log(s)
}
