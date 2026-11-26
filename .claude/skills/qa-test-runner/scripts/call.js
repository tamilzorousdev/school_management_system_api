const fs = require('fs')
const os = require('os')
const path = require('path')

const BASE = process.env.QA_API || 'http://localhost:3000/api/v1'
const OTP = process.env.QA_OTP || '123456'
const tokenFile = (m) => path.join(os.tmpdir(), `qa-token-${m}.json`)

async function raw(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}

async function login(mobile, app) {
  const f = tokenFile(mobile + '-' + app)
  if (fs.existsSync(f)) {
    const t = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (Date.now() - t.at < 10 * 60 * 1000) return t.token
  }
  await raw('POST', '/auth/otp/request', { mobile })
  const r = await raw('POST', '/auth/otp/verify', { mobile, otp: OTP, client: { app } })
  const token = r.body?.data?.access_token
  if (!token) throw new Error('login failed ' + mobile + ' ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300))
  fs.writeFileSync(f, JSON.stringify({ token, at: Date.now() }))
  return token
}

function compact(v, depth = 0) {
  if (Array.isArray(v)) return v.length > 3 ? [...v.slice(0, 3).map((x) => compact(x, depth + 1)), `…+${v.length - 3} more`] : v.map((x) => compact(x, depth + 1))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 14).map(([k, x]) => [k, depth > 3 ? '…' : compact(x, depth + 1)]))
  return typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v
}

async function main() {
  const [mobile, method, url, json] = process.argv.slice(2)
  if (!mobile || !method) {
    console.log('usage: node call.js <mobile|none> <GET|POST|PUT|PATCH|DELETE> </path> [json-body]   (env QA_API, QA_OTP, QA_APP=admin|mobile)')
    process.exit(1)
  }
  const app = process.env.QA_APP || 'admin'
  const token = mobile === 'none' ? undefined : await login(mobile, app)
  const r = await raw(method, url, json ? JSON.parse(json) : undefined, token)
  const b = r.body
  const out = typeof b === 'object' && b ? { status: b.status, error: b.error, message: b.message, errors: b.errors, data: compact(b.data) } : b
  console.log(r.status, JSON.stringify(out))
}
main().catch((e) => { console.error(e.message); process.exit(1) })
