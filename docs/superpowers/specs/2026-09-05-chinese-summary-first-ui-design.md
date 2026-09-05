# 中文、总览优先的推理分析界面设计

日期：2026-09-05  
状态：已确认；第一阶段只实现 Pi0
范围：离线前端的信息架构、视觉系统；第一阶段只收敛 Pi0，不修改 canonical evidence 的事实语义

## 目标

界面打开后必须先回答一个问题，而不是先解释数据结构：

- 模型页：模型如何计算？
- 端到端页：当前模型、硬件和工作负载下，各推理栈总体有多快？
- Nsys 页：一次推理的时间主要花在哪里？
- 算子下钻：选中算子如何计算、理论上限是什么、实测 kernel 离上限多远？

所有详细 run、capture、counter、missing 原因和 provenance 都保留，但只在用户主动下钻后显示。

## 全站信息优先级

所有页面使用同一条不可逆的信息层级，默认只打开第 0 层：

```text
第 0 层  模型 / 配置总体摘要
   ↓ 用户点选
第 1 层  stage / module / 推理栈摘要
   ↓ 用户继续点选
第 2 层  operator / kernel signature 摘要
   ↓ “详细证据”
第 3 层  run / capture 历史
   ↓ 明确选择一条记录
第 4 层  单次 sample、interval、raw counter 和 provenance
```

- 总体指标必须先于局部指标出现。
- 默认指标是已声明统计口径下的摘要，不是 sample 列表。
- 第 0–2 层不显示 run ID、capture ID、measurement ID 或 raw counter 名。
- 页面不能因为存在更多证据就自动展开更深层级。
- 单次 sample 是最深、最不显眼的证据层，只能从 `详细证据 → Run/Capture 历史 → 单条记录` 到达。
- 缺失和证据限制在摘要层使用短状态；完整原因只在详细证据中出现。

## 首屏信息预算

渐进披露不是模型图的特例，而是所有分析页面的硬约束：

- 每个页面首屏只回答一个主问题，只放一个主视图。
- 首屏最多同时出现 4 个短摘要指标；指标用于定位，不替代主视图。
- 首屏不并排展示两个细节级图表，不同时展开多个 inspector，不出现 cards-in-cards。
- 详情使用一致的 `选择对象 → 局部聚焦/摘要 → 详细证据 → 原始记录` 路径。
- 页面不因屏幕空间尚有空余就补放次要信息；留白用于建立分组和视觉层级。
- 控件按当前任务出现。影响全局上下文的选择留在顶栏，影响局部视图的选择靠近主视图，低频参数放进弹层或抽屉。
- 表格只承担比较；结构、时序和数据流优先用 DAG、timeline 或 Roofline 图表达。
- 默认视图中不显示调试统计、内部 ID、数据集计数、布局诊断或实现说明；异常时才显示相应状态。

## 顶层信息架构

根路由直接进入模型页，默认选择 `Pi0`、`NVIDIA Jetson AGX Thor` 和 `BF16` 理论场景，不再先显示模型注册表。

顶栏只保留：

```text
Atlas   [模型] [硬件: AGX Thor] [理论精度: BF16] [场景]   [模型结构] [端到端] [Nsys]
```

模型、硬件、理论精度、场景和当前视图仍写入 URL，刷新和分享后能够恢复。“场景”至少绑定 views、prompt、action、denoise、output contract、timing boundary 和 state reuse。理论精度只控制 analytical 计算；runtime 的实际精度来自 canonical realization/run，二者不得互相覆盖。英文技术名词 `GEMM`、`Roofline`、`NCU`、`Nsys`、`BF16`、`FP8` 保留，其余面向用户的标题、按钮、解释和状态改为中文。

原有页面合并如下：

- `Logical` 成为默认的“模型结构”。
- `Runtime` 变成模型结构页内的“理论模型 / 推理栈实现”切换，不再占一个顶层页面。
- `Roofline & Kernels` 进入算子右侧抽屉；模型级 Roofline 从模型页的“理论总览”进入。
- `End-to-end` 变成“端到端”。
- `Timeline` 变成“Nsys”。

## 模型结构页

第一屏直接显示全宽 DAG。移除巨大模型标题、长介绍、证据数量、四格 workload 表、派生符号条、长注释和独立 breadcrumb 横条。

```text
默认态：

┌──────────────────────────────────────────────────────────────────────┐
│                         模型 DAG（全宽）                              │
└──────────────────────────────────────────────────────────────────────┘

选中态：

┌───────────────────────────────────────┬──────────────────────────────┐
│ DAG 上下文图：自动聚焦所选局部         │ 算子抽屉                     │
│ 保留邻接关系并弱化无关区域             │ 概览 / 计算 / Roofline / Kernel│
└───────────────────────────────────────┴──────────────────────────────┘
```

图上方只允许一行轻量工具：模型版本、理论/推理栈切换、场景按钮、缩放/平移。Workload 的 views、prompt、action、denoise 放进“场景”弹层；图上只用一行短摘要显示当前值。

未选中任何对象时不保留常驻右栏；DAG 占满可用宽度，模型级理论摘要压缩为图上方的一行状态，需要时再进入模型级理论总览。只有点击 stage/module/operator 后才打开右侧详情。打开详情时，DAG 容器平滑收窄并自动聚焦所选对象所在 scope 与直接邻接关系；关闭详情后恢复进入前的完整 DAG 视野。动效只解释这次空间变化，并尊重 `prefers-reduced-motion`。

第一阶段只实现 Pi0 的这套交互与视觉规范。Pi0.5、SmolVLA 保持可访问但不作为本阶段验收对象，也不因这次重构修改其 presentation 坐标。

算子右侧抽屉按以下顺序渐进展示：

1. **概览**：算子名称、输入输出 shape、公式和重复次数。
2. **计算过程**：GEMM/Conv/Attention 等交互动画。
3. **Roofline**：当前硬件和理论精度下的 AI、理论时间、理论 limiter 和 ceiling 来源。
4. **实测 Kernel**：默认按 exact context + kernel signature 汇总；仅在选定推理栈且存在可信映射时展示 NCU 摘要。单个 NCU replay 进入 Capture 历史后才可见；歧义映射明确标为“未建立”，不制造效率或 gap。

四项是互斥 tabs，默认且同时只打开“概览”；切换 tab 才挂载对应内容，不能四块纵向铺开。详细 tensor、formula provenance、missing 字段和原始 counter 放在当前 tab 内的“详细证据”单开折叠区，默认不挂载。

## 三模型 DAG 规范

Pi0、Pi0.5 和 SmolVLA 统一使用三个主语义列：

```text
视觉编码器              前缀 / VLM                动作解码器
image → tokens          prompt/state/cache        denoise → action
                                                    └ public output
```

展示规则：

- 横向节点只表示无依赖的并行分支；串行依赖必须单调向下。
- Q/K/V 固定为三 lane 并行布局。
- K/V cache 使用独立 storage/read rail，不与 Q/K/V projection 混成同一语义层。
- Public output 保留其逻辑 stage 身份，但显示为 Action 列底部 terminal group，不生成第四个空列。
- add、mul、scale、shift、gate 等微型算子显示在主线或紧凑 micro-chain 中，不独占普通 48px 行。
- 节点宽度按语义角色统一，而不是主要由文字长度决定。
- cache、residual、feedback 使用命名且固定 inset 的 authored rail；边不穿 scope badge 或节点。
- Inspector 始终位于右侧，与 stage 数量无关；DAG 自身可以横向平移。

Pi0 保留已接受的拓扑和人工坐标，仅应用新的视觉 tokens。Pi0.5 重新对齐 Q/K/V、cache rail 和 AdaRMS micro-chain。SmolVLA 将 `pad → state projection` 改为竖向依赖，并把每个 self/cross expert pair 明确堆叠；cross-attention 的 K/Q/V 三路并行后再汇合。

canonical `data/model_graphs/*.json` 不因展示编排而改写。Presentation 层新增 visual-stage placement、micro-chain 和 authored rail 能力。

## 端到端页

默认只显示一个总表，不显示逐-run大表。

Pi0 第一批目标采样格固定 `prompt=48`、`denoise=10`，仅展开 `views={1,2,3}` 与 `action chunk={20,50}`，即每个推理栈/实际精度最多 6 个目标配置。运行时不支持的 action chunk 和尚未采集的精确配置显示为待测，不用历史 prompt、原生但不同的 chunk 或 analytical 数值补点。

当前模型、硬件、工作负载和精度由顶栏/场景选择固定。总表一行对应一个推理栈在这一完整上下文中的结果：

| 推理栈 | 端到端延时 | 理论下界 | 可比 gap | 实际精度 | 输出口径 | 状态 |
|---|---:|---:|---:|---:|---|---|

规则：

- 只有完整 `comparison_context` 相同且证据规则允许时才并列或计算 gap。
- 总表显示单条 canonical measurement 已经声明的 mean/p50、范围和 sample count；前端不跨 measurement 重新求 mean、median 或 percentile。
- 不同 workload、timing boundary、state reuse、precision 或 operating point 不合并；它们通过“场景”切换，不在默认总表铺成多行。
- 在选定场景后，每个 runtime 只有一个 exact match 时直接显示；出现多个 realization/configuration 变体时，主行显示“有 N 个变体”而不合并数值，用户从行内变体选择器确定一个后才显示其摘要。
- measured、analytical、external 不混成同一比例。理论下界可以作为独立列，但只有 `measured_vs_bound` 规则成立时显示 gap。
- 点击一行后先出现 stage/module 摘要；“详细证据”中才出现运行配置和 `Run history (n)`。
- 单次 run ID、九列 provenance、每次 sample 和全部统计量仅在选中 Run history 中的一条记录后出现。

无数据的推理栈用一句状态表示，不渲染空证据表。E2E 总表不提供 runtime 顶栏过滤，因为 runtime 正是该表的比较行；模型 overlay 和 Nsys 页各自提供可见的 runtime/realization 选择。

## Nsys 页

第一屏必须是一次选定推理的直观火焰图/时间线，而不是说明文字和统计表：

```text
[总时长] [GPU kernel] [CPU scheduled] [copy] [未分类]

CPU main     ███          ██
CPU worker      ███████
CUDA API     ────────
GPU kernel      ██████████████
GPU copy                    ██
```

- Runtime/realization 选择位于 Nsys 图上方；场景和硬件继承全局上下文。
- 默认 capture 必须是 exact-context 的 process-tree node trace，因为只有它提供可展开的 kernel/copy interval；若不存在就显示缺失状态，不用 graph envelope 或 system-wide scheduler trace 代替。
- 首屏标为“Node trace · 代表性执行图”，同时显示 target-window denominator、interval coverage 和“单 capture”徽标，但不显示内部 capture ID。Nsys trace 天然来自一次 capture，界面不得把它冒充跨-run聚合结果。
- Lane 左侧只显示短名称；颜色固定区分 CPU、CUDA API、GPU kernel、copy 和 unknown。
- 首屏指标优先显示 capture 内经过 union/aggregation 的 target window、recorded kernel/copy union、CPU scheduled core-time 和未分类摘要，不列出每次 interval。指标采用并列卡片而非 stacked composition，并明确“可能重叠、不可相加”；recorded kernel union 不称为完整 GPU busy time。
- 点击 stage/signature 后先显示该类 interval 的聚合；单条 interval 只有在“详细证据”中明确切换到 interval 级别后才显示起止时间和持续时间。
- overlap ledger、分类覆盖率、capture contract、侵入性说明和 NCU replay 配对都放在“展开分析”；capture ID 和逐 interval 表继续放在其下的“详细证据”。
- graph envelope、node trace 和 system-wide scheduler capture 不做跨 capture 算术。
- 空白区域标为“未观测”，不标为 CPU/GPU idle。

## 视觉系统

视觉定位为“现代计算分析工作台”，不是旧式仪器表格，也不是游戏化全暗 RGB。

- 顶栏：深石墨 `#0B1420`。
- 主画布：冷白 `#F5F8FC`。
- Surface：`#FFFFFF`。
- 主文字：`#17232E`。
- 次文字：`#657483`。
- 分隔线：`#D9E2EA`。
- 数据流/选择：青色 `#0E8EA0`。
- warning/error 只使用克制的琥珀和红色语义色。

离线内置 `IBM Plex Sans` 和 `IBM Plex Mono` WOFF2，并跟踪其许可证；Sans 用于标题、正文、控件和数字，Mono 只用于 ID、公式与 raw counter。页面标题 40–52px，章节标题 24–30px，正文 15–16px，表格/控件 13–14px，辅助文字不低于 12px。移除 Arial Narrow、极端负字距、全大写 eyebrow、斜纹 missing 背景和层层方框。

图表允许一次 300–500ms 的绘制动画；选择算子时只动画高亮相关数据流。支持 `prefers-reduced-motion`，不加入无意义的浮动和循环动画。

## 组件与数据边界

新增或重构为以下边界：

- `ModelWorkspacePage`：顶栏状态和三大入口。
- `ModelDagSurface`：DAG、场景摘要与实现 overlay。
- `OperatorDrawer`：概览、计算、Roofline、Kernel 四层下钻。
- `EndToEndSummary`：按完整上下文生成推理栈级摘要，默认不暴露 run。
- `RunHistoryDrawer`：逐-run证据，仅按需挂载。
- `NsysFlameView`：代表性 capture 的聚合主时间线，首屏不暴露 capture/interval 身份。
- `NsysAnalysisDrawer`：overlap、coverage、capture 与配对证据。

现有 adapters 继续负责证据语义；展示组件不得自行把 missing 变成 0、合并不同 capture、推断 LPDDR 带宽或建立未证实的 operator/kernel link。

## 响应式与可访问性

- 桌面默认态为全宽 DAG；选中态才出现 28–32rem 右侧抽屉，DAG 自动聚焦局部。
- 窄屏时抽屉变为底部 sheet；DAG 保留明确的水平滚动/平移提示。
- 键盘可以选中 DAG 节点、总表行和 timeline interval。
- focus、颜色对比和 reduced-motion 保持可见、可用。

## 非目标

- 不下载模型、不安装推理栈、不新增 benchmark 或压力测试。
- 不修改 canonical measurement/profiler 事实来迁就 UI。
- 不做暗/亮双主题，不加入新的复杂动画库。
- 本轮不扩展新模型或新硬件。

## 最小验证

只保留与本次风险直接相关的验证：

1. 一个端到端摘要选择测试：不同 comparison context 不能合并，多个变体不能生成前端合成数值。
2. 一个三模型布局测试：依赖节点不在同一横排，Public terminal 不生成第四主列。
3. TypeScript typecheck、canonical validation 和确定性 build check。
4. 四张 1920×1200 人工截图：Pi0、Pi0.5、SmolVLA 模型页，以及端到端/Nsys 中选择一个最能暴露层级问题的页面；发现具体视觉错误再补针对性检查，不建立截图矩阵。
