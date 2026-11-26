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
  steps: ['steps', 'test steps', 'procedure', 'step', 'steps to execute'],
  expected: ['expected', 'expected result', 'expected output'],
  status: ['status', 'result', 'test status', 'execution status'],
  actual: ['actual', 'actual result', 'observed'],
  remarks: ['remarks', 'comments', 'notes', 'defect', 'bug', 'failure note'],
  by: ['tested by', 'executed by', 'tester'],
  outcome: ['unit test / bug', 'unit test or bug'],
  cause: ['bug cause', 'cause of bug', 'defect cause'],
  on: ['tested on', 'executed on', 'date', 'test date', 'execution date'],
}
const norm = (v) => String(v?.text ?? v?.result ?? v ?? '').replace(/\s+/g, ' ').trim()

function detect(ws) {
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const map = {}
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(cell.value).toLowerCase()
      for (const [key, names] of Object.entries(ALIASES)) if (!map[key] && (names.includes(h) || (key === 'status' && names.some((n) => h.startsWith(`${n} `))))) map[key] = c
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

const OUTCOME_TITLE = 'Unit Test / Bug'
const CAUSE_TITLE = 'Bug Cause'
const isFail = (st) => /^fail/i.test(st)
const outcomeFor = (st) => (isFail(st) ? 'Bug' : /^pass/i.test(st) ? 'Unit test done' : '')

function ensureColumn(ws, d, key, title) {
  if (d.map[key]) return
  const headerRow = ws.getRow(d.header)
  const col = Math.max(...Object.values(d.map), headerRow.cellCount, ws.columnCount) + 1
  const cell = headerRow.getCell(col)
  const left = headerRow.getCell(col - 1)
  cell.value = title
  cell.style = { ...left.style }
  ws.getColumn(col).width = key === 'cause' ? 60 : 18
  headerRow.commit()
  d.map[key] = col
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)
const pending = (st) => !st || /^(not run|not tested|not executed|todo|pending|blocked|n\/a)?$/i.test(st)

async function main() {
  const [cmd, file] = process.argv.slice(2)
  if (!cmd || !file) {
    console.log('usage: node sheet.js info|next|set|summary <xlsx> [--sheet S] [--module M] [--app A] [--n 20] [--results file.tsv] [--dry-run] [--force]')
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
    const VALID = ['Pass', 'Fail', 'Blocked', 'Not run', 'Pass (code)', 'Fail (code)']
    const dry = process.argv.includes('--dry-run')
    const force = process.argv.includes('--force')
    const results = fs.readFileSync(arg('results'), 'utf8').split('\n').filter((l) => l.trim())
    const backup = path.join(os.tmpdir(), 'qa-backup-' + path.basename(file))
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
    const today = new Date().toISOString().slice(0, 10)
    const seen = new Set()
    const planned = []
    const rejected = []
    for (const line of results) {
      const [ref, rawStatus = '', actual = '', remarks = '', id = '', cause = ''] = line.split('\t')
      const status = VALID.find((v) => v.toLowerCase() === rawStatus.trim().toLowerCase())
      const [sn, rs] = (ref || '').split('!')
      const ws = wb.getWorksheet(sn)
      const d = ws && detect(ws)
      const reject = (why) => rejected.push(`${ref}: ${why}`)
      if (!d || !d.map.status) { reject('sheet or status column not found'); continue }
      if (!status) { reject(`status "${rawStatus}" must be one of ${VALID.join(', ')}`); continue }
      const rowNo = Number(rs)
      if (!Number.isInteger(rowNo) || rowNo <= d.header || rowNo > ws.rowCount) { reject('row out of range'); continue }
      if (seen.has(ref)) { reject('duplicate ref in results'); continue }
      const row = ws.getRow(rowNo)
      const sheetId = norm(row.getCell(d.map.id).value)
      if (!sheetId) { reject('row has no test case id'); continue }
      if (id && id.trim() !== sheetId) { reject(`id mismatch: results say "${id.trim()}", sheet row has "${sheetId}"`); continue }
      const current = norm(row.getCell(d.map.status).value)
      if (!pending(current) && !force) { reject(`already has status "${current}" (use --force to overwrite)`); continue }
      if (!actual.trim()) { reject('actual result is empty'); continue }
      if ((status === 'Fail' || status === 'Fail (code)' || status === 'Blocked') && !remarks.trim()) { reject('Fail and Blocked need a remark (cause, repro or blocking id)'); continue }
      if (isFail(status) && !cause.trim()) { reject('Fail needs a cause (6th column): product defect, wrong test or data issue, with file:line'); continue }
      if (/^pass \(code\)$/i.test(status) && !/code|inspect/i.test(actual + remarks)) { reject('Pass (code) must say it was a code inspection') ; continue }
      seen.add(ref)
      planned.push({ ref, row, d, ws, status, actual: actual.trim(), remarks: remarks.trim(), cause: cause.trim(), sheetId })
    }
    rejected.forEach((m) => console.error('REJECTED ' + m))
    if (dry) {
      planned.forEach((p) => console.log(`would set ${p.ref} (${p.sheetId}) -> ${p.status}`))
      console.log(`dry run: ${planned.length} valid, ${rejected.length} rejected; nothing written`)
      return
    }
    for (const p of planned) {
      ensureColumn(p.ws, p.d, 'outcome', OUTCOME_TITLE)
      ensureColumn(p.ws, p.d, 'cause', CAUSE_TITLE)
    }
    for (const p of planned) {
      p.row.getCell(p.d.map.outcome).value = outcomeFor(p.status)
      p.row.getCell(p.d.map.cause).value = isFail(p.status) ? p.cause : ''
      p.row.getCell(p.d.map.status).value = p.status
      if (p.d.map.actual) p.row.getCell(p.d.map.actual).value = p.actual
      if (p.d.map.remarks && p.remarks) p.row.getCell(p.d.map.remarks).value = p.remarks
      if (p.d.map.by) p.row.getCell(p.d.map.by).value = 'Claude (QA skill)'
      if (p.d.map.on) p.row.getCell(p.d.map.on).value = today
      p.row.commit()
    }
    if (planned.length) await wb.xlsx.writeFile(file)
    const check = await open(file)
    let bad = 0
    for (const p of planned) {
      const ws = check.getWorksheet(p.ref.split('!')[0])
      const d = detect(ws)
      const row = ws.getRow(Number(p.ref.split('!')[1]))
      const ok = norm(row.getCell(d.map.id).value) === p.sheetId && norm(row.getCell(d.map.status).value) === p.status && (!d.map.actual || norm(row.getCell(d.map.actual).value) === p.actual) && d.map.outcome && norm(row.getCell(d.map.outcome).value) === outcomeFor(p.status) && (!isFail(p.status) || norm(row.getCell(d.map.cause).value) === p.cause)
      if (!ok) { bad++; console.error('VERIFY FAILED ' + p.ref) }
    }
    console.log(`updated ${planned.length} rows, rejected ${rejected.length}, verified after save ${planned.length - bad}/${planned.length}; backup at ${backup}`)
    if (bad || rejected.length) process.exitCode = 2
  }

  if (cmd === 'summary') {
    const total = {}
    const open = []
    for (const ws of sheets) {
      const d = detect(ws)
      if (!d) continue
      for (let r = d.header + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)
        const id = norm(row.getCell(d.map.id).value)
        if (!id) continue
        const st = d.map.status ? norm(row.getCell(d.map.status).value) : ''
        const key = st || '(untested)'
        total[key] = (total[key] || 0) + 1
        if (/^fail/i.test(st)) open.push([`${ws.name}!${r}`, id, d.map.priority ? norm(row.getCell(d.map.priority).value) : '', d.map.actual ? cut(norm(row.getCell(d.map.actual).value), 100) : '', d.map.cause ? cut(norm(row.getCell(d.map.cause).value), 160) : (d.map.remarks ? cut(norm(row.getCell(d.map.remarks).value), 160) : '')].join('\t'))
      }
    }
    console.log('status counts: ' + JSON.stringify(total))
    if (open.length) { console.log('bugs (ref, id, priority, actual, cause):'); open.forEach((l) => console.log(l)) }
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
