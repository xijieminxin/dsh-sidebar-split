/**
 * split.js 的逻辑回归（无浏览器）：用最小 DOM 桩喂受控的几何数据，
 * 校验选择器命中、比例/像素双夹、API、持久化、折叠退回与幂等启动。
 *
 * 运行：node test/logic-test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = readFileSync(join(HERE, '..', 'lib', 'split.js'), 'utf8')

let failures = 0
let checks = 0
function check(name, actual, expected) {
	checks += 1
	const ok = JSON.stringify(actual) === JSON.stringify(expected)
	if (!ok) {
		failures += 1
		console.log(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
	} else {
		console.log(`ok   ${name} = ${JSON.stringify(actual)}`)
	}
}

/** 极小的元素/样式桩，只覆盖 split.js 实际用到的面。 */
class Style {
	constructor() {
		this.maxHeight = ''
		this.overflowY = ''
		this.overflowX = ''
		this.minHeight = ''
		this.flex = ''
		this.display = ''
		this.top = ''
		this.left = ''
		this.width = ''
		this.textContent = ''
	}
}

class El {
	constructor(tag, className) {
		this.tagName = tag.toUpperCase()
		this.className = className || ''
		this.children = []
		this.parentElement = null
		this.style = new Style()
		this.attrs = {}
		this.id = ''
		this.isConnected = true
		this.clientWidth = 280
		this.clientHeight = 900
		this.paddingTop = '6px'
		this.paddingBottom = '6px'
		this.marginTop = '0px'
		this.marginBottom = '0px'
		this._rect = { top: 0, left: 0, right: 280, bottom: 900, width: 280, height: 900 }
	}
	appendChild(child) {
		child.parentElement = this
		this.children.push(child)
		return child
	}
	setAttribute(key, value) {
		this.attrs[key] = String(value)
	}
	getAttribute(key) {
		return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null
	}
	removeAttribute(key) {
		delete this.attrs[key]
	}
	getBoundingClientRect() {
		return this._rect
	}
	contains(node) {
		if (node === this) return true
		return this.children.some((child) => child.contains(node))
	}
	matches(selector) {
		const attr = /^([a-z]*)\[class\*="([^"]+)"\]$/.exec(selector)
		if (attr !== null) {
			const tag = attr[1]
			if (tag !== '' && this.tagName !== tag.toUpperCase()) return false
			return (this.className || '').includes(attr[2])
		}
		if (selector.startsWith('#')) return this.id === selector.slice(1)
		if (/^[a-z]+$/.test(selector)) return this.tagName === selector.toUpperCase()
		throw new Error(`unsupported selector ${selector}`)
	}
	querySelectorAll(selector, out = []) {
		for (const child of this.children) {
			if (child.matches(selector)) out.push(child)
			child.querySelectorAll(selector, out)
		}
		return out
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null
	}
}

function buildDom() {
	const document = {
		readyState: 'complete',
		hidden: false,
		listeners: {},
		createElement(tag) {
			return new El(tag)
		},
		head: null,
		body: null,
		documentElement: null,
		getElementById(id) {
			const found = [...document.documentElement.querySelectorAll(`#${id}`), ...document.body.querySelectorAll(`#${id}`)]
			return found[0] ?? null
		},
		querySelector(selector) {
			return document.documentElement.querySelector(selector) ?? document.body.querySelector(selector)
		},
		addEventListener(type, handler) {
			;(document.listeners[type] ||= []).push(handler)
		}
	}
	document.head = new El('head')
	document.body = new El('body')
	document.documentElement = new El('html')

	const root = new El('div', 'wtg9ga_root')
	const logo = new El('div', 'wtg9ga_logoRow')
	const newSession = new El('button', 'wtg9ga_newSession')
	const nav = new El('nav', 'wtg9ga_panelList')
	for (let i = 0; i < 5; i += 1) nav.appendChild(new El('div', 'wtg9ga_panelRow'))
	const region = new El('div', 'wtg9ga_regionArea')
	region.appendChild(new El('div', 'ws'))
	const foot = new El('div', 'wtg9ga_footArea')

	root.appendChild(logo)
	root.appendChild(newSession)
	root.appendChild(nav)
	root.appendChild(region)
	root.appendChild(foot)
	document.body.appendChild(root)

	// 受控几何：root 高 900、padding 6 → 内容 888；nav 之上占 314（品牌 60 + 新建会话 50 + 皮肤立绘 204）
	root.clientWidth = 280
	root.clientHeight = 900
	root._rect = { top: 0, left: 0, right: 280, bottom: 900, width: 280, height: 900 }
	nav._rect = { top: 320, left: 12, right: 268, bottom: 620, width: 256, height: 300 }
	region._rect = { top: 632, left: 12, right: 268, bottom: 894, width: 256, height: 262 }
	foot._rect = { top: 894, left: 0, right: 280, bottom: 894, width: 280, height: 0 }

	return { document, root, nav, region, foot }
}

const store = new Map()
const dom = buildDom()
const context = {
	document: dom.document,
	getComputedStyle: (el) => ({ paddingTop: el.paddingTop, paddingBottom: el.paddingBottom, marginTop: el.marginTop, marginBottom: el.marginBottom }),
	MutationObserver: undefined,
	ResizeObserver: undefined,
	setTimeout: () => 0,
	setInterval: () => 0,
	requestAnimationFrame: (fn) => {
		fn()
		return 1
	},
	localStorage: {
		getItem: (key) => (store.has(key) ? store.get(key) : null),
		setItem: (key, value) => store.set(key, String(value))
	},
	console
}
context.window = context
context.window.addEventListener = () => {}
context.window.removeEventListener = () => {}
context.window.localStorage = context.localStorage
context.document.defaultView = context

vm.createContext(context)
vm.runInContext(SCRIPT, context, { filename: 'split.js' })
vm.runInContext(SCRIPT, context, { filename: 'split.js (second load, must be a no-op)' })

const api = context.window.dshSidebarSplit
check('api exists', typeof api, 'object')
// available = 888 - 314 - 0 = 574；0.45*574 = 258.3 → 258；改写后关掉 140 的下限（ceiling 434）
check('boot maxHeight', dom.nav.style.maxHeight, '258px')
check('boot overflowY', dom.nav.style.overflowY, 'auto')
check('boot region minHeight', dom.region.style.minHeight, '0px')
check('get().available', api.get().available, 574)

api.set(0.2)
check('set(0.2)', dom.nav.style.maxHeight, '115px')
api.set(80)
check('set(80) → 80%', dom.nav.style.maxHeight, '434px')
api.reset()
check('reset', dom.nav.style.maxHeight, '258px')
check('stored', JSON.parse(store.get('dsh.sidebar-split.v1')), { share: 0.45, enabled: true })

api.enabled(false)
check('disabled clears inline', dom.nav.style.maxHeight, '')
api.enabled(true)
check('re-enabled', dom.nav.style.maxHeight, '258px')

// 侧栏折叠成导轨（56px）：必须交还原生行为
dom.root.clientWidth = 56
api.refresh()
check('collapsed clears inline', dom.nav.style.maxHeight, '')
dom.root.clientWidth = 280
api.refresh()
check('expanded again', dom.nav.style.maxHeight, '258px')

// 工具列表天然比分配值矮时，max-height 只是上限，不制造空白
check('sessions >= minSessions', api.get().sessions, 316)

// 皮肤给 regionArea 加了 margin-top：它不参与比例分配（否则可用高度算多、会话区被压扁）
dom.region.marginTop = '180px'
api.refresh()
check('region marginTop excluded (sessions)', api.get().sessions, 217)
check('tools after gap', dom.nav.style.maxHeight, '177px')
dom.region.marginTop = '0px'
api.refresh()
check('gap removed', dom.nav.style.maxHeight, '258px')

// 注入契约：脚本正文不得出现 script 结束标签字面量
check('no closing script tag', /<[/]script/i.test(SCRIPT), false)

console.log('')
console.log(failures === 0 ? `PASS ${checks}/${checks}` : `FAILED ${failures}/${checks}`)
process.exit(failures === 0 ? 0 : 1)