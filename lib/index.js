/**
 * dsh-sidebar-split —— 宿主半边。
 *
 * 只做一件事：把同包 lib/split.js 作为 script 行注入 index.html，
 * 并把 bundle patch 里的 config 作为默认值用 global 行交给页面。
 *
 * 机制（沿用 dsh-sidebar-ratio 已验证的注入路线）：
 * - `webserver/index-inject` 的结构化行共有 global / script / script-src /
 *   script-preload / style / html 六种；本包只用 global 与 script。
 * - 每次渲染 index.html 都重新收集注入表 → 改 lib/split.js 只需刷新页面，不必重启宿主。
 * - script 行的 text 里不允许出现 script 结束标签字面量（宿主不做转义），
 *   下面注入前先断言，命中就 warn 并整行跳过：宁可插件不生效，也不能把页面结构搞坏。
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT_FILE = join(HERE, 'split.js')

/** bundle patch 里 config 的已知字段；其余忽略。 */
const KEYS = ['share', 'minTools', 'minSessions', 'enabled']

/** script 结束标签（大小写不敏感）——注入内容里出现它等于把页面撕开。 */
const CLOSING_TAG = /<[/]script/i

/** split.js 的 mtime 缓存：避免每次 index 响应都在请求路径上同步读文件。 */
const cache = { mtimeMs: -1, size: -1, text: null }

function warn(ctx, message) {
  try {
    ctx.logger.warn(`dsh-sidebar-split: ${message}`)
  } catch {
    /* 没有 logger 也不抛 */
  }
}

/** 读 split.js（按 mtime+size 缓存，保证刷新页面就能拿到最新内容）。读不到返回 null。 */
function readScript(ctx) {
  let stat
  try {
    stat = statSync(SCRIPT_FILE)
  } catch (error) {
    warn(ctx, `跳过注入（stat ${SCRIPT_FILE} 失败：${error instanceof Error ? error.message : String(error)}）`)
    return null
  }
  if (cache.text !== null && stat.mtimeMs === cache.mtimeMs && stat.size === cache.size) return cache.text
  let text
  try {
    text = readFileSync(SCRIPT_FILE, 'utf8')
  } catch (error) {
    warn(ctx, `跳过注入（读取 ${SCRIPT_FILE} 失败：${error instanceof Error ? error.message : String(error)}）`)
    return null
  }
  cache.mtimeMs = stat.mtimeMs
  cache.size = stat.size
  cache.text = text
  return text
}

export function apply(ctx, config = {}) {
  const defaults = pick(config)

  ctx.on('webserver/index-inject', (table) => {
    const text = readScript(ctx)
    // 读不到就安静跳过：注入失败绝不能把页面渲染拖成 500。
    if (typeof text !== 'string' || text === '') return
    if (CLOSING_TAG.test(text)) {
      warn(ctx, `跳过注入（${SCRIPT_FILE} 里出现了 script 结束标签字面量，注入会破坏页面结构）`)
      return
    }
    // global 行落在 head，且先于 script 行
    table.push({ kind: 'global', name: '__DSH_SIDEBAR_SPLIT__', value: defaults })
    table.push({ kind: 'script', placement: 'body', text })
  })
}

/** 只放行可 JSON 序列化的已知字段（null / boolean / number）。 */
function pick(config) {
  const out = {}
  if (config === null || typeof config !== 'object') return out
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    const value = config[key]
    if (value === null || typeof value === 'boolean' || typeof value === 'number') out[key] = value
  }
  return out
}