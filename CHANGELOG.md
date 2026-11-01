# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-02

首个可用版本。

### Added

- 侧栏内部新增可拖动分隔线：在「工具 / 面板列表」与「工作区 + 会话列表」之间按比例分配高度。
- 分隔线常驻可见（1px 细线 + 28×4 抓手），鼠标靠近变粗，拖拽时高亮。
- 键盘：`Alt`+`Shift`+`↑` / `↓` 调整 3%，`Alt`+`Shift`+`0` 重置；双击分隔线同样重置。
- 控制台 API：`dshSidebarSplit.get()` / `set()` / `reset()` / `enabled()` / `refresh()` / `version`。
- 双下限保护：工具列表不低于 `minTools`，会话区不低于 `minSessions`；比例本身夹在 2%–95%。
- 比例持久化到 `localStorage`（`dsh.sidebar-split.v1`），刷新后保持。
- 侧栏折叠成导轨、未注册任何面板、或 `enabled: false` 时自动交还原生行为。
- 尺寸变化自适应：`MutationObserver` + `ResizeObserver` + `window.resize`，外加 1.5s 自愈检查。
- 与皮肤（如 orca-link 把面板列表整体下推）共存：按 `getBoundingClientRect` 差分计算，不写死皮肤数值。
- 注入前校验：`lib/split.js` 中若出现 script 结束标签字面量，则跳过注入并告警，避免破坏页面结构。
- 测试：`test/logic-test.mjs` 18 项 DOM 断言 + `test/fixture.html` 视觉回归页面。