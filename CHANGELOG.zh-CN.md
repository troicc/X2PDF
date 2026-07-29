# Changelog

## 0.12.0

- 每个代码块标题栏新增“复制”按钮，一次复制完整原始代码，不复制 PrismJS 高亮标签。
- 复制成功、失败均显示即时状态，1.4 秒后恢复按钮文字。
- 新增 Clipboard API 与隐藏 textarea 双路径，兼容禁止异步剪贴板写入的浏览器配置。
- 无语言标签的代码块也显示代码工具栏并支持复制。
- 代码复制按钮在 PDF 生成时自动隐藏，不改变打印内容。
- 公式 LaTeX 与诊断复制统一使用同一剪贴板工具。
- 新增剪贴板工具单元测试和代码工具栏浏览器回归测试。

## 0.11.0

- 修复 MathJax TeX→MathML 产生多个 `<math>` 顶层子节点时，Chromium 原生 MathML 将公式排成纵向单列的问题。
- 在导入 MathML 前显式补充顶层 `<mrow>`，使整条公式作为一个数学行参与屏幕与打印布局。
- 移除公式根节点的 `min-width: 100%`，改用 `width: max-content`，避免分数线被拉伸到整页宽度。
- 保持原生 MathML 文本层，公式仍可选中、搜索，并可通过按钮复制原始 LaTeX。
- 诊断新增 `rootRowsNormalized`，记录修复了多少个隐式顶层数学行。
- 新增屏幕与打印媒体下的公式横向布局回归测试。


## 0.10.0

- 公式主渲染改为 Chromium 原生 MathML，预览和 PDF 中的公式可选中、搜索。
- MathJax 仅负责 TeX → MathML 转换；SVG 只作为单公式兼容兜底。
- 新增“复制 LaTeX”按钮，打印时自动隐藏。
- 清理 MathML `annotation` / `annotation-xml` / assistive 层，避免重复两行。
- 公式渲染诊断增加 renderer、selectable、nonSelectable 和 svgFallback 统计。
- PDF 生成启用 tagged PDF 和文档目录。
- 最低 Chrome 版本调整为 109。

## 0.9.0

- 移除 MathJax assistive-MathML 重复层，修复公式在 PDF 中出现两行且字体不同。
- 公式输出增加 `merror` 检测，不再把红色 TeX 错误文本计为成功。
- DOM 捕获和结构化解析均增加重复 TeX 折叠。
- 规范 X 可访问性公式中的数学字母 Unicode，并修复无花括号的 `\boldsymbol` / `\mathbf` 等命令。
- 缩小后端公式索引的误判范围，避免普通 UUID/文本被当成公式候选。

## 0.8.0

- 新增 X DraftJS `LATEX`、`TEX`、`MATH` 和 `EQUATION` entity 解析。
- 新增公式引用索引，可通过 `entityKey` 在捕获的 X 后端响应中定位真实 TeX/MathML。
- 新增滚动 DOM 公式采集，支持 KaTeX annotation、MathML、MathJax、`data-latex`、`data-tex` 和可访问性公式源。
- 新增按 DraftJS LATEX entity 序号对齐的 DOM 公式兜底，避免公式顺序错位。
- 内置 MathJax 3.2.1 `tex-mml-svg`，离线将 TeX/MathML 转为自包含 SVG。
- PDF 下载前强制等待全部公式排版完成；失败公式显示原始源并写入诊断。
- 新增公式输出数量、解析来源、未解析 entity 和 MathJax 渲染结果诊断。
- 公式 SVG 自动适应 A4/Letter 页面宽度，并以矢量形式打印。

## 0.7.0

- 新增本地 PrismJS 语法高亮，PDF 中保留可复制代码和高亮颜色。
- 支持 Python、JavaScript/TypeScript、Shell、JSON、HTML/CSS、SQL、C/C++/C#、Java、Go、Rust 等常用语言。
- 新增无语言标签代码的保守自动检测；无法可靠判断时保持纯文本。
- 新增 X 浅色、GitHub 浅色、One Dark 和不高亮四种代码主题。
- 新增 X 原生 Chirp、原有衬线阅读和系统无衬线三种字体预设。
- Chirp 运行时从 `abs.twimg.com` 加载；失败时提示并回退系统字体，不在扩展包中分发字体文件。
- 页面尺寸、字体、字号、代码主题和显示选项现在保存到本地。
- “复制诊断”新增高亮语言统计、字体预设和 Chirp 加载状态。

## 0.6.0

- 新增 X 后端 JSON 响应捕获：在导航前启用 CDP Network，读取页面已经请求的 GraphQL/JSON 响应。
- 新增递归 Article payload 检测，不依赖 GraphQL operation 名称或 hash。
- 标题只使用结构化 Article payload 中的 `title`，并记录 `title.source = article.title`。
- 新增 DraftJS `content_state.blocks/entities` 解析器。
- 支持 atomic entity 的 Markdown fenced code、普通 code entity、表格、引用和列表。
- 支持 `inline_style_ranges` 的粗体、斜体、删除线、下划线、代码、上标和下标。
- 支持 `media_items` 按 DraftJS block 顺序解析媒体，DOM 图片仅用于未解析媒体的兜底。
- 新增内容缺口检查：代码提示语后若没有 code/image/media/table，诊断会报警。
- 新增预览页结构化获取状态和完整性提示。
- 直接 PDF 下载流程保持不变。

## 0.5.0

- 滚动过程中持续采集 X 虚拟化媒体。
- PDF 下载前缓存 `pbs.twimg.com` 图片。
