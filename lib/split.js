/**
 * dsh-sidebar-split —— 侧栏「工具列表 : 工作区/会话列表」上下比例控制器（浏览器端脚本）。
 *
 * 由宿主半边 lib/index.js 以 `webserver/index-inject` 的 script 行原样注入 index.html，
 * 不依赖客户端 bundle，也不插入任何 React 托管的 DOM 节点：
 *   - 只改 nav（面板/工具列表）的内联 max-height / overflow，React 从不管理这两个值；
 *   - 拖拽分隔条的可视提示挂在 <body> 上（pointer-events:none），手势靠 document 捕获阶段监听；
 *   - 侧栏收起成 56px 导轨时自动交还原生行为。
 *
 * 契约：本文件会被拼进 HTML 的 <script> 元素，正文里**不允许**出现 script 结束标签字面量。
 */
(function () {
	'use strict'

	var W = window
	if (W.__dshSidebarSplitBooted) return
	W.__dshSidebarSplitBooted = true

	var STORE_KEY = 'dsh.sidebar-split.v1'
	var HANDLE_ID = 'dsh-sidebar-split-handle'
	var STYLE_ID = 'dsh-sidebar-split-style'
	var VERSION = '0.1.0'

	var CFG = W.__DSH_SIDEBAR_SPLIT__ || {}

	function num(value, fallback) {
		return typeof value === 'number' && isFinite(value) ? value : fallback
	}

	function clampShare(value) {
		if (!isFinite(value)) return 0.45
		return Math.min(0.95, Math.max(0.02, value))
	}

	var OPT = {
		share: clampShare(num(CFG.share, 0.45)),
		minTools: Math.max(0, num(CFG.minTools, 96)),
		minSessions: Math.max(0, num(CFG.minSessions, 140)),
		enabled: CFG.enabled !== false
	}

	var state = {
		share: OPT.share,
		enabled: OPT.enabled,
		dragging: false,
		near: false,
		startY: 0,
		startShare: OPT.share,
		avail: 0
	}

	var els = { root: null, nav: null, region: null, foot: null, handle: null, style: null }
	var lastMeasure = null
	var raf = 0

	// #region 状态读写
	function loadStored() {
		try {
			var raw = W.localStorage.getItem(STORE_KEY)
			if (!raw) return
			var value = JSON.parse(raw)
			if (!value || typeof value !== 'object') return
			if (typeof value.share === 'number') state.share = clampShare(value.share)
			// 配置里 enabled:false 是硬开关：页面上的历史开关不能把它翻回来。
			if (OPT.enabled && typeof value.enabled === 'boolean') state.enabled = value.enabled
		} catch (error) {
			/* localStorage 不可用（隐私模式/被禁用）时用配置默认值 */
		}
	}

	function saveStored() {
		try {
			W.localStorage.setItem(STORE_KEY, JSON.stringify({ share: state.share, enabled: state.enabled }))
		} catch (error) {
			/* 存不下就算了，本次会话仍然生效 */
		}
	}
	// #endregion

	// #region DOM 定位
	/** 侧栏根 = 面板列表（nav）的父元素；工具项一个都没有时退回 regionArea 的父元素。 */
	function find() {
		// 面板列表在侧栏里是唯一的 nav[class*="panelList"]；会话区必须在**同一个父元素**里找，
		// 不能全局 querySelector——设置面板等其它表面也可能带 regionArea。
		var nav = document.querySelector('nav[class*="panelList"]')
		var root = nav ? nav.parentElement : null
		if (!root) return false
		var region = root.querySelector('[class*="regionArea"]')
		if (!region || region.parentElement !== root) return false
		els.root = root
		els.nav = nav
		els.region = region
		els.foot = null
		for (var i = 0; i < root.children.length; i += 1) {
			var child = root.children[i]
			if (child !== nav && child !== region && /footArea/.test(child.className || '')) {
				els.foot = child
				break
			}
		}
		return true
	}

	function collapsed() {
		return !els.root || els.root.isConnected === false || els.root.clientWidth < 90
	}
	// #endregion

	// #region 度量与应用
	/**
	 * 把侧栏内容区切成「nav 之上（品牌行/新建会话/皮肤立绘占位）」「nav」「region」「foot」四段，
	 * 只在前两段之间分配比例；available 就是 nav 与 region 共享的高度。
	 */
	function measure() {
		if (collapsed()) return null
		var root = els.root
		var nav = els.nav
		var region = els.region
		if (!region) return null
		var rootRect = root.getBoundingClientRect()
		var style = getComputedStyle(root)
		var padTop = parseFloat(style.paddingTop) || 0
		var padBottom = parseFloat(style.paddingBottom) || 0
		var contentTop = rootRect.top + padTop
		var contentBottom = rootRect.bottom - padBottom
		var contentH = Math.max(0, contentBottom - contentTop)
		var navRect = nav.getBoundingClientRect()
		// nav 的 margin-top（皮肤用它给立绘预留舞台）也算在「上方」里，不参与比例分配。
		var above = Math.max(0, navRect.top - contentTop)
		var footH = 0
		if (els.foot) footH = els.foot.getBoundingClientRect().height || 0
		var regionRect = region.getBoundingClientRect()
		// 两个上界取小：nav 上沿到 region 下沿的跨度（对中间包装层/外边距都不敏感），
		// 以及 root 内容盒里实际剩下的高度（顶部塌陷时 nav 会顶出盒子，只信这个）。
		var span = Math.max(0, regionRect.bottom - navRect.top)
		var room = Math.max(0, contentH - above - footH)
		var available = Math.min(span, room)
		// nav 与 region 之间的外边距不参与分配，否则工具列表会占过头、会话区被压扁。
		var navStyle = getComputedStyle(nav)
		var regionStyle = getComputedStyle(region)
		var gap = (parseFloat(navStyle.marginBottom) || 0) + (parseFloat(regionStyle.marginTop) || 0)
		var budget = Math.max(0, available - gap)

		// tools 先按比例，再夹到 [minTools, budget - minSessions] 里，最后硬夹到 [0, budget]：
		// 空间实在太小时也不把 region 挤成负数高度。
		var ceiling = Math.max(0, budget - OPT.minSessions)
		var floor = Math.min(OPT.minTools, ceiling)
		var tools = state.share * budget
		tools = Math.max(floor, Math.min(tools, ceiling))
		tools = Math.max(0, Math.min(tools, budget))

		return {
			contentTop: contentTop,
			contentH: contentH,
			above: above,
			footH: footH,
			gap: gap,
			available: available,
			budget: budget,
			tools: tools,
			sessions: Math.max(0, budget - tools),
			navRect: navRect,
			rootRect: rootRect
		}
	}

	function clearInline() {
		if (!els.nav) return
		var style = els.nav.style
		if (style.maxHeight !== '') style.maxHeight = ''
		if (style.overflowY !== '') style.overflowY = ''
		if (style.overflowX !== '') style.overflowX = ''
		if (style.minHeight !== '') style.minHeight = ''
		if (style.flex !== '') style.flex = ''
		lastMeasure = null
	}

	function apply() {
		if (!els.root && !find()) return
		ensureHandle()
		setNear(false)
		if (!state.enabled || collapsed()) {
			clearInline()
			hideHandle()
			return
		}
		var measured = measure()
		if (measured === null) {
			clearInline()
			hideHandle()
			return
		}
		lastMeasure = measured
		var nav = els.nav
		var wanted = Math.round(measured.tools) + 'px'
		if (nav.style.maxHeight !== wanted) nav.style.maxHeight = wanted
		if (nav.style.overflowY !== 'auto') {
			nav.style.overflowY = 'auto'
			nav.style.overflowX = 'hidden'
		}
		if (nav.style.minHeight !== '0px') nav.style.minHeight = '0px'
		if (nav.style.flex !== '0 1 auto') nav.style.flex = '0 1 auto'
		if (els.region && els.region.style.minHeight !== '0px') els.region.style.minHeight = '0px'
		updateHandle()
	}

	function schedule() {
		if (raf !== 0) return
		raf = W.requestAnimationFrame(function () {
			raf = 0
			apply()
		})
	}
	// #endregion

	// #region 提示条与样式
	function injectStyle() {
		if (document.getElementById(STYLE_ID) !== null) return
		var style = document.createElement('style')
		style.id = STYLE_ID
		style.setAttribute('data-dsh-sidebar-split', '')
		// 用真实子元素画线（::before/::after 在部分内嵌内核里不渲染，实测无像素输出）。
		style.textContent = [
			'#' + HANDLE_ID + '{position:fixed;height:12px;z-index:880;pointer-events:none;background:transparent}',
			'#' + HANDLE_ID + ' > i{position:absolute;display:block;pointer-events:none}',
			'#' + HANDLE_ID + ' > i.line{left:0;right:0;top:5px;height:1px;',
			'background:var(--dsw-alias-border-l2,rgba(127,127,127,.45));opacity:.75;transition:opacity .12s ease}',
			'#' + HANDLE_ID + ' > i.grip{left:50%;top:3px;width:28px;height:4px;margin-left:-14px;border-radius:2px;',
			'background:var(--dsw-alias-border-l3,rgba(127,127,127,.55));opacity:.55;transition:opacity .12s ease,width .12s ease,margin-left .12s ease}',
			'#' + HANDLE_ID + '[data-hot="1"] > i.line,#' + HANDLE_ID + '[data-drag="1"] > i.line{opacity:1}',
			'#' + HANDLE_ID + '[data-hot="1"] > i.grip,#' + HANDLE_ID + '[data-drag="1"] > i.grip{opacity:1;width:44px;margin-left:-22px}',
			'[data-dsh-sidebar-split-near],[data-dsh-sidebar-split-near] *{cursor:ns-resize!important}',
			'[data-dsh-sidebar-split-drag] *{cursor:ns-resize!important;user-select:none!important}'
		].join('')
		;(document.head || document.documentElement).appendChild(style)
		els.style = style
	}

	function ensureHandle() {
		if (els.handle && els.handle.isConnected) return els.handle
		var existing = document.getElementById(HANDLE_ID)
		if (existing !== null) {
			els.handle = existing
			return existing
		}
		var handle = document.createElement('div')
		handle.id = HANDLE_ID
		handle.setAttribute('aria-hidden', 'true')
		var line = document.createElement('i')
		line.className = 'line'
		var grip = document.createElement('i')
		grip.className = 'grip'
		handle.appendChild(line)
		handle.appendChild(grip)
		document.body.appendChild(handle)
		els.handle = handle
		return handle
	}

	function hideHandle() {
		if (els.handle) els.handle.style.display = 'none'
		setNear(false)
	}

	function updateHandle() {
		var handle = ensureHandle()
		var nav = els.nav
		if (!nav || state.enabled === false || collapsed()) {
			handle.style.display = 'none'
			return
		}
		var navRect = nav.getBoundingClientRect()
		var rootRect = els.root.getBoundingClientRect()
		if (navRect.height <= 0) {
			handle.style.display = 'none'
			return
		}
		// 把线放在 nav 与 region 之间的留白里（nav 有 margin-bottom），别压在滚动的文字上。
		var gap = lastMeasure ? lastMeasure.gap : 0
		var offset = gap >= 10 ? Math.round(gap / 2) : 0
		handle.style.display = 'block'
		handle.style.top = Math.round(navRect.bottom + offset - 6) + 'px'
		handle.style.left = Math.round(rootRect.left + 6) + 'px'
		handle.style.width = Math.max(24, Math.round(rootRect.width - 12)) + 'px'
	}

	function setNear(near) {
		if (state.near === near) return
		state.near = near
		var handle = els.handle
		if (handle) handle.setAttribute('data-hot', near ? '1' : '0')
		if (els.root && els.root.isConnected) {
			if (near) els.root.setAttribute('data-dsh-sidebar-split-near', '')
			else els.root.removeAttribute('data-dsh-sidebar-split-near')
		}
	}

	function nearDivider(event) {
		if (state.dragging) return false
		if (state.enabled === false || !els.nav || !els.root || collapsed()) return false
		var target = event.target
		if (!els.root.contains(target)) return false
		var rect = els.nav.getBoundingClientRect()
		// 命中区跟着那根线的位置走（线在 nav 下方的留白里），上下各给 8px 的宽容度。
		var gap = lastMeasure ? lastMeasure.gap : 0
		var line = rect.bottom + (gap >= 10 ? gap / 2 : 0)
		return event.clientY >= line - 8 && event.clientY <= line + 8
	}
	// #endregion

	// #region 手势
	function stopDrag() {
		if (!state.dragging) return
		state.dragging = false
		if (els.handle) els.handle.setAttribute('data-drag', '0')
		document.documentElement.removeAttribute('data-dsh-sidebar-split-drag')
		W.removeEventListener('pointermove', onDragMove, true)
		W.removeEventListener('pointerup', stopDrag, true)
		W.removeEventListener('pointercancel', stopDrag, true)
		saveStored()
	}

	function onDragMove(event) {
		if (!state.dragging) return
		if (event.cancelable) event.preventDefault()
		var dy = event.clientY - state.startY
		var next = clampShare(state.startShare + dy / Math.max(1, state.avail))
		if (Math.abs(next - state.share) < 0.002) return
		state.share = next
		apply()
	}

	function onPointerDown(event) {
		if (event.button !== 0 || !nearDivider(event)) return
		var measured = measure()
		if (measured === null || measured.available < 60) return
		if (event.cancelable) event.preventDefault()
		event.stopPropagation()
		state.dragging = true
		state.startY = event.clientY
		state.startShare = state.share
		state.avail = measured.available
		setNear(true)
		if (els.handle) els.handle.setAttribute('data-drag', '1')
		document.documentElement.setAttribute('data-dsh-sidebar-split-drag', '')
		W.addEventListener('pointermove', onDragMove, true)
		W.addEventListener('pointerup', stopDrag, true)
		W.addEventListener('pointercancel', stopDrag, true)
	}

	function onPointerMove(event) {
		if (state.dragging) return
		setNear(nearDivider(event))
	}

	function onMouseDown(event) {
		if (!nearDivider(event)) return
		if (event.cancelable) event.preventDefault()
		event.stopPropagation()
	}

	function onDoubleClick(event) {
		if (!nearDivider(event)) return
		if (event.cancelable) event.preventDefault()
		event.stopPropagation()
		state.share = OPT.share
		apply()
		saveStored()
	}

	function onKeyDown(event) {
		if (!event.altKey || !event.shiftKey) return
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			if (event.cancelable) event.preventDefault()
			state.share = clampShare(state.share + (event.key === 'ArrowUp' ? -0.03 : 0.03))
			apply()
			saveStored()
			return
		}
		if (event.key === '0' || event.key === ')') {
			if (event.cancelable) event.preventDefault()
			state.share = OPT.share
			apply()
			saveStored()
		}
	}
	// #endregion

	// #region 观察者与启动
	function observe() {
		if (typeof MutationObserver === 'function') {
			var observer = new MutationObserver(function () {
				if (!els.root || els.root.isConnected === false) find()
				schedule()
			})
			observer.observe(document.body, { childList: true, subtree: true })
		}
		if (typeof ResizeObserver === 'function') {
			var resize = new ResizeObserver(function () { schedule() })
			resize.observe(els.root)
			resize.observe(els.nav)
			resize.observe(els.region)
		}
		W.addEventListener('resize', schedule)
		W.addEventListener('scroll', schedule, true)
		// 兜底：React 换掉节点或样式被别处覆盖时，1.5s 内自愈（页面隐藏时不跑）。
		W.setInterval(function () {
			if (document.hidden) return
			if (!els.root || els.root.isConnected === false) find()
			apply()
		}, 1500)
	}

	function bind() {
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('pointermove', onPointerMove, true)
		document.addEventListener('mousedown', onMouseDown, true)
		document.addEventListener('dblclick', onDoubleClick, true)
		document.addEventListener('keydown', onKeyDown, true)
	}

	function boot() {
		injectStyle()
		ensureHandle()
		if (!find()) {
			setTimeout(boot, 400)
			return
		}
		loadStored()
		apply()
		observe()
		bind()
	}

	W.dshSidebarSplit = {
		version: VERSION,
		get: function () {
			var measured = lastMeasure
			return {
				share: state.share,
				enabled: state.enabled,
				collapsed: collapsed(),
				contentH: measured ? Math.round(measured.contentH) : null,
				above: measured ? Math.round(measured.above) : null,
				footH: measured ? Math.round(measured.footH) : null,
				gap: measured ? Math.round(measured.gap) : null,
				available: measured ? Math.round(measured.available) : null,
				budget: measured ? Math.round(measured.budget) : null,
				tools: measured ? Math.round(measured.tools) : null,
				sessions: measured ? Math.round(measured.sessions) : null
			}
		},
		set: function (value) {
			var next = Number(value)
			if (!isFinite(next)) return W.dshSidebarSplit.get()
			if (next > 1 && next <= 100) next = next / 100
			state.share = clampShare(next)
			apply()
			saveStored()
			return W.dshSidebarSplit.get()
		},
		reset: function () {
			state.share = OPT.share
			apply()
			saveStored()
			return W.dshSidebarSplit.get()
		},
		enabled: function (on) {
			state.enabled = on !== false
			apply()
			saveStored()
			return W.dshSidebarSplit.get()
		},
		refresh: function () {
			find()
			apply()
			return W.dshSidebarSplit.get()
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
	else boot()
	// #endregion
})()