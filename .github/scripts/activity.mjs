// Rewrites the activity log in README.md from public GitHub events. No dependencies (Node 20+).
import { readFile, writeFile } from 'node:fs/promises'

const USER = 'kav-sw19'
const SKIP = new Set([`${USER}/${USER}`]) // the profile repo itself
const LINES = 8
const START = '<!-- ACTIVITY:START -->'
const END = '<!-- ACTIVITY:END -->'

const headers = { accept: 'application/vnd.github+json', 'user-agent': `${USER}-profile` }
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`

const res = await fetch(`https://api.github.com/users/${USER}/events/public?per_page=100`, { headers })
if (!res.ok) throw new Error(`GitHub API ${res.status}`)
const events = await res.json()

const short = (repo) => repo.replace(`${USER}/`, '')
function describe(e) {
  const repo = short(e.repo.name)
  const p = e.payload ?? {}
  switch (e.type) {
    case 'PushEvent': return { key: `push:${repo}`, text: (n) => `pushed ${n > 1 ? `${n}× ` : ''}to ${repo}` }
    case 'ReleaseEvent': return p.action === 'published' ? { key: e.id, text: () => `released ${repo} ${p.release?.tag_name ?? ''}`.trim() } : null
    case 'CreateEvent':
      if (p.ref_type === 'repository') return { key: e.id, text: () => `created ${repo}` }
      if (p.ref_type === 'tag') return { key: e.id, text: () => `tagged ${repo} ${p.ref}` }
      return null
    case 'PublicEvent': return { key: e.id, text: () => `open-sourced ${repo}` }
    case 'PullRequestEvent':
      if (p.action === 'opened') return { key: `pr:${repo}`, text: (n) => (n > 1 ? `opened ${n} PRs on ${repo}` : `opened PR #${p.number} on ${repo}`) }
      if (p.action === 'closed' && p.pull_request?.merged) return { key: e.id, text: () => `merged PR #${p.number} on ${repo}` }
      return null
    case 'IssuesEvent': return p.action === 'opened' ? { key: e.id, text: () => `opened issue #${p.issue?.number} on ${repo}` } : null
    case 'WatchEvent': return e.repo.name.startsWith(`${USER}/`) ? null : { key: e.id, text: () => `starred ${e.repo.name}` }
    case 'ForkEvent': return { key: e.id, text: () => `forked ${e.repo.name}` }
    default: return null
  }
}

// Group same-day pushes to the same repo into one line.
const rows = []
for (const e of events) {
  if (SKIP.has(e.repo.name)) continue
  const d = describe(e)
  if (!d) continue
  const day = e.created_at.slice(0, 10)
  const prev = rows.at(-1)
  if (prev && prev.day === day && prev.key === d.key) prev.count++
  else rows.push({ day, key: d.key, text: d.text, count: 1 })
  if (rows.length > LINES) break
}
const lines = rows.slice(0, LINES).map((r) => `${r.day}  ${r.text(r.count)}`)
const body = lines.length ? lines.join('\n') : '(quiet week. probably shipping something private.)'

const block = `${START}\n\`\`\`console\n$ tail -n ${LINES} ~/activity.log\n${body}\n\`\`\`\n${END}`
const readme = await readFile('README.md', 'utf8')
const re = new RegExp(`${START}[\\s\\S]*?${END}`)
if (!re.test(readme)) throw new Error('activity markers not found in README.md')
const next = readme.replace(re, block)
if (next !== readme) {
  await writeFile('README.md', next)
  console.log('README updated:\n' + body)
} else console.log('no change')
