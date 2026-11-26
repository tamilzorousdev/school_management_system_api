const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const [cmd, file, arg] = process.argv.slice(2)
if (!cmd || !file) {
  console.log('usage: node scope.js outline <docx> | section <docx> "<heading prefix>" | find <docx> "<regex>"')
  process.exit(1)
}

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const text = (x) => decode(x.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, ' ').replace(/<[^>]+>/g, '')).trim()

function lines(docx) {
  const cache = path.join(os.tmpdir(), 'scope-cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = path.join(cache, path.basename(docx) + '.' + fs.statSync(docx).mtimeMs + '.txt')
  if (fs.existsSync(out)) return fs.readFileSync(out, 'utf8').split('\n')
  const xml = execFileSync('unzip', ['-p', docx, 'word/document.xml'], { maxBuffer: 1 << 29 }).toString('utf8')
  const res = []
  for (const m of xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const b = m[0]
    if (b.startsWith('<w:tr')) {
      const cells = [...b.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => text(c[0]))
      if (cells.some(Boolean)) res.push('| ' + cells.join(' | '))
      continue
    }
    const t = text(b)
    if (!t) continue
    const h = b.match(/<w:pStyle w:val="Heading(\d)"/)
    res.push(h ? '#'.repeat(Number(h[1])) + ' ' + t : t)
  }
  fs.writeFileSync(out, res.join('\n'))
  return res
}

const all = lines(file)
const level = (l) => (l.match(/^(#+) /) || [])[1]?.length || 0

if (cmd === 'outline') {
  all.filter((l) => level(l) && level(l) <= 2).forEach((l) => console.log(l))
} else if (cmd === 'section') {
  const i = all.findIndex((l) => level(l) && l.replace(/^#+ /, '').startsWith(arg))
  if (i < 0) { console.log('not found: ' + arg); process.exit(1) }
  const lv = level(all[i])
  let j = i + 1
  while (j < all.length && !(level(all[j]) && level(all[j]) <= lv)) j++
  console.log(all.slice(i, j).join('\n'))
} else if (cmd === 'find') {
  const re = new RegExp(arg, 'i')
  all.forEach((l, n) => { if (re.test(l)) console.log(n + ': ' + l.slice(0, 300)) })
}
