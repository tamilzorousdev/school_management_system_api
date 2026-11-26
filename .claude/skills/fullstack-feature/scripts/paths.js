const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../../../..')
const settingsFile = path.join(root, '.claude', 'settings.local.json')
const readSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {})
const isWeb = (d) => d && fs.existsSync(path.join(d, 'src', 'features')) && fs.existsSync(path.join(d, 'package.json'))
const isFlutter = (d) => d && fs.existsSync(path.join(d, 'pubspec.yaml')) && fs.existsSync(path.join(d, 'packages', 'sms_core'))
const arg = (n) => {
  const i = process.argv.indexOf('--' + n)
  return i > 0 ? path.resolve(process.argv[i + 1].replace(/^~/, os.homedir())) : undefined
}

function guess(kind) {
  const parent = path.dirname(root)
  const home = os.homedir()
  const list =
    kind === 'web'
      ? [path.join(parent, 'school_management_system_web'), path.join(parent, 'sms_web')]
      : [path.join(parent, 'sms'), path.join(home, 'StudioProjects', 'sms'), path.join(home, 'AndroidStudioProjects', 'sms'), path.join(home, 'Projects', 'sms')]
  return list.find((d) => (kind === 'web' ? isWeb(d) : isFlutter(d)))
}

function resolve() {
  const env = readSettings().env || {}
  const web = process.env.SMS_WEB_DIR || env.SMS_WEB_DIR
  const flutter = process.env.SMS_FLUTTER_DIR || env.SMS_FLUTTER_DIR
  return { web, flutter }
}

if (process.argv[2] === 'set') {
  const web = arg('web') || guess('web')
  const flutter = arg('flutter') || guess('flutter')
  const bad = []
  if (!isWeb(web)) bad.push('web folder not found or not the admin web repo: ' + web + ' (pass --web <dir>)')
  if (!isFlutter(flutter)) bad.push('flutter folder not found or not the sms workspace: ' + flutter + ' (pass --flutter <dir>)')
  if (bad.length) { console.error(bad.join('\n')); process.exit(1) }
  const s = readSettings()
  s.env = { ...(s.env || {}), SMS_WEB_DIR: web, SMS_FLUTTER_DIR: flutter }
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n')
  console.log('saved to .claude/settings.local.json (not committed)\nweb=' + web + '\nflutter=' + flutter + '\nTo let Claude edit these folders without prompts, add them yourself with /add-dir (this script does not change permissions).')
  process.exit(0)
}

const { web, flutter } = resolve()
console.log('api=' + root)
console.log('web=' + (isWeb(web) ? web : 'MISSING'))
console.log('flutter=' + (isFlutter(flutter) ? flutter : 'MISSING'))
if (!isWeb(web) || !isFlutter(flutter)) {
  console.log('Run once: node .claude/skills/fullstack-feature/scripts/paths.js set [--web <dir>] [--flutter <dir>]  (it tries sibling folders and common locations when a flag is left out)')
  process.exit(2)
}
