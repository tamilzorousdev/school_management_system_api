const path = require('path')
const fs = require('fs')
const os = require('os')
const ExcelJS = require(path.join(__dirname, '../../../../node_modules/exceljs'))

const ALIASES = {
  id: ['test case id', 'testcase id', 'tc id', 'tc no', 'test id', 'id', 's.no', 's.no.', 'sno'],
  module: ['module', 'feature', 'area'],
  title: ['title', 'test case', 'test case title', 'scenario', 'test scenario', 'description', 'summary'],
  app: ['app', 'application', 'platform', 'channel'],
  priority: ['priority', 'pri'],
  pre: ['precondition', 'preconditions', 'pre-condition'],
  steps: ['steps', 'test steps', 'procedure', 'step'],
  expected: ['expected', 'expected result', 'expected output'],
  status: ['status', 'result', 'test status', 'execution status'],
  actual: ['actual', 'actual result', 'observed'],
  remarks: ['remarks', 'comments', 'notes', 'defect', 'bug'],
  by: ['tested by', 'executed by', 'tester'],
  on: ['tested on', 'executed on', 'date', 'test date', 'execution date'],
}
const norm = (v) => String(v?.text ?? v?.result ?? v ?? '').replace(/\s+/g, ' ').trim()

function detect(ws) {
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const map = {}
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(cell.value).toLowerCase()
      for (const [key, names] of Object.entries(ALIASES)) if (!map[key] && names.includes(h)) map[key] = c
    })
    if (map.id && (map.steps || map.title) && map.expected) return { header: r, map }
  }
  return null
}

async function open(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return wb
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : def
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
const pending = (st) => !st || /^(not run|not tested|todo|pending|blocked|n\/a)?$/i.test(st)

async function main() {
  const [cmd, file] = process.argv.slice(2)
  if (!cmd || !file) {
    console.log('usage: node sheet.js info|next|set <xlsx> [--sheet S] [--module M] [--app A] [--n 20] [--results file.tsv]')
    process.exit(1)
  }
  const wb = await open(file)
  const only = arg('sheet')
  const sheets = wb.worksheets.filter((w) => !only || w.name === only)

  if (cmd === 'info') {
    for (const ws of sheets) {
      const d = detect(ws)
      if (!d) { console.log(`${ws.name}: no test-case header found (${ws.rowCount} rows)`); continue }
      const counts = {}
      let total = 0
      for (let r = d.header + 1; r <= ws.rowCount; r++) {
        const id = norm(ws.getRow(r).getCell(d.map.id).value)
        if (!id) continue
        total++
        const st = d.map.status ? norm(ws.getRow(r).getCell(d.map.status).value) || '(empty)' : '(no status column)'
        counts[st] = (counts[st] || 0) + 1
      }
      console.log(`${ws.name}: header row ${d.header}, ${total} cases, columns ${JSON.stringify(d.map)}`)
      console.log('  status: ' + JSON.stringify(counts))
      if (d.map.module) {
        const mods = {}
        for (let r = d.header + 1; r <= ws.rowCount; r++) {
          const m = norm(ws.getRow(r).getCell(d.map.module).value)
          if (m) mods[m] = (mods[m] || 0) + 1
        }
        console.log('  modules: ' + JSON.stringify(mods))
      }
    }
  }

  if (cmd === 'next') {
    const n = Number(arg('n', 20))
    const mod = arg('module')
    const app = arg('app')
    let shown = 0
    for (const ws of sheets) {
      const d = detect(ws)
      if (!d) continue
      for (let r = d.header + 1; r <= ws.rowCount && shown < n; r++) {
        const row = ws.getRow(r)
        const g = (k) => (d.map[k] ? norm(row.getCell(d.map[k]).value) : '')
        if (!g('id')) continue
        if (!pending(g('status'))) continue
        if (mod && !g('module').toLowerCase().includes(mod.toLowerCase())) continue
        if (app && g('app') && !g('app').toLowerCase().includes(app.toLowerCase())) continue
        console.log([`${ws.name}!${r}`, g('id'), g('module'), g('app'), g('priority'), cut(g('title'), 120), cut(g('pre'), 120), cut(g('steps'), 350), cut(g('expected'), 250)].join('\t'))
        shown++
      }
    }
    console.error(`shown ${shown} (columns: ref, id, module, app, priority, title, precondition, steps, expected)`)
  }

  if (cmd === 'set') {
    const results = fs.readFileSync(arg('results'), 'utf8').split('\n').filter(Boolean)
    const backup = path.join(os.tmpdir(), 'qa-backup-' + path.basename(file))
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
    const today = new Date().toISOString().slice(0, 10)
    let done = 0
    for (const line of results) {
      const [ref, status, actual = '', remarks = ''] = line.split('\t')
      const [sn, rs] = ref.split('!')
      const ws = wb.getWorksheet(sn)
      const d = ws && detect(ws)
      if (!d || !d.map.status) { console.error('skip ' + ref); continue }
      const row = ws.getRow(Number(rs))
      row.getCell(d.map.status).value = status
      if (d.map.actual) row.getCell(d.map.actual).value = actual
      if (d.map.remarks && remarks) row.getCell(d.map.remarks).value = remarks
      if (d.map.by) row.getCell(d.map.by).value = 'Claude (QA skill)'
      if (d.map.on) row.getCell(d.map.on).value = today
      row.commit()
      done++
    }
    await wb.xlsx.writeFile(file)
    console.log(`updated ${done} rows; backup at ${backup}`)
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
