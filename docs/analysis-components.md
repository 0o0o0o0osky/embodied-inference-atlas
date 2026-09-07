# 分析工作台的复用边界

换模型、推理栈或设备时，先填当前实例的数据与实现描述，再使用现有视图。
采样到交付的完整顺序见 [分析流程](single-inference-analysis.md)。

DAG 的线型表示依赖语义：实线箭头是张量数据，虚线箭头是控制或跨次迭代
（含状态反馈）。残差、缓存读取和跨模块连线沿用实际依赖，不按布线路径改线型。
计算节点用实边框；视图／布局用胶囊或分区形状，存储用圆柱，分组／融合用淡底区域。
映射缺失和预计算等状态用标签与颜色表达，不使用虚框或虚线数据边。

模型页只保留顶部“模型理论／运行表现”主导航。理论算子详情使用“概览／计算过程／Roofline”；
推理栈的 Kernel 仍从运行表现里的执行 DAG 与热点查看。概览先展示当前公式、形状和单次工作量，
维度表达式与重复次数分别折叠，不展示内部记录 ID 或空分析表。

计算过程共用 [ComputationStepper](../src/features/model-graph/visualizers/ComputationStepper.tsx) 的步骤选择、
播放、版式与折叠依据。现有三模型的全部算子种类已接入计算过程；
当前形状从算子端口解析，小数值教学例子单独标注。agent 负责核对归约轴、头共享、卷积步长、
权重／仿射是否声明等数学适用条件，不能只按算子类别填通用的“读取—计算—写入”动图。
未适配的计算图使用共享缺省提示。复用这些代码图，不为每个模型或输入保存图片。

页面、图表刻度和指标数字统一使用 `--display-face`。公式与张量尺寸用
`math-expression` 样式，数字通过 `tabular-nums` 对齐；代码、路径和原始计数器名称
使用 `code` 与 `--mono-face`。新组件沿用这些字体，不单独指定系统字体。

分块图共用 [TileMatrix](../src/features/model-graph/visualizers/TileMatrix.tsx) 的单元格、选择与高亮。
GEMM 沿 K 累加输出块；Attention 固定 Q 块并遍历 K/V，展示在线 Softmax 对分母与输出累加器的
同步重缩放。归一化合并同一行各块的统计量，逐元素运算按索引处理，RoPE 按特征对旋转。
查表、视图与物化图使用元素身份及地址映射；补零展示新元素写入，广播展示共享地址与重复写入两条路径。图块投影的分块页直接复用 GEMM。
教学数值由小型计算函数生成；用完整矩阵运算校验分块结果。实际 Kernel 的 tile/warp 配置
需要实现或采样证据，单独由运行分析提供。

## 新页面接入契约

三模型共用 `Workbench`、`ModelGraphWorkspace` 与 `RuntimeAnalysisWorkspace`。顶部上下文、场景弹层、理论摘要、算子侧栏、推理栈导航和缺省信息都由共享壳提供。新增模型填写模型图、默认参数和 presentation 配置；新增推理栈填写实现映射与测量记录。页面、字体和交互沿用现有组件。

DAG 的 `stageColumns` 配置决定哪些逻辑阶段显示在同一列；例如动作输出放在动作列末尾，同时保留原始 stage 和算子引用。需要时启用共享的正交避障路由。模型特有的条件分支和重复结构保存在 presentation 模板中。性能比较由各数据适配器提供列数据，统一交给 `RuntimePerformanceChart` 绘制；同一运行记录的返回状态通过 `runtimeEvidenceSelectionPatch` 保留。

DAG 布局围绕计算依赖组织：主激活连续向下，同一张量的投影与 RoPE 对齐，独立分支并排，缓存靠近生产者。条件计算与残差走相邻侧路；跨列传输通过列间通道，在消费者附近进入。共享 `gutter` 路由可分别设置源出口、列间位置和消费端横线，`right-to-top` 可把缓存生产分支与 Attention 输入线分开。截图审阅需检查完整模块及局部交汇处：不同张量的线路不应重叠成一个看似相连的分支。

每个模型、推理栈或硬件入口都必须使用共享壳、上下文解析、导航及选中对象。
**必需的是组件位置与明确状态，不是每页已经具备全部测量。** 信息未填或采集
不可用时由组件给缺省状态；不能通过复制页面、补零或自由生成说明绕开契约。
以下字段以 [catalog schema](../schema/catalog)、[运行类型](../src/types/atlas.ts)
和 [实现类型](../src/features/runtime/domain/types.ts) 为准，字段命名不同的 adapter
须先规范化再进入组件。

| 接入层 | 必填身份／结构 | 能力内容与缺省行为 | agent 最少提供什么 |
| --- | --- | --- | --- |
| 模型 | `model_id, display_name, model_type, architecture_id`，输入／输出模态、`execution_modes, artifacts`；参数量可为 null | DAG 参数默认值来自当前模型；没有已确认形状时显示未填写，不能借另一个模型的默认值 | 对应架构与权重标识、已知输入约束；需要理论图时补当前模型图与公式入口 |
| 推理栈 | `runtime_id, display_name, backend, model_support` | 每个支持项有模型、`status, evidence, reason_code, has_canonical_measurement`；支持与已测分开 | 原生支持范围、来源、实际实现 revision；不把“有源码”写成“有测量” |
| 硬件 | `device_id, display_name, accelerator_architecture, memory_capacity_gib, memory_type, compute_capability, peak_claims, source_ids`；实例用 system 引用设备 | 峰值列表允许尚无条目；Roofline 上限独立记录。当前 schema 的内存容量要求数值，未知时先补可靠规格或明确的 nullable 契约，再接入，不能用 0 代未知 | 基础规格来源、单位、公开峰值适用精度；设备实例与公开规格分开 |
| 输入与运行 | `workload.common` 的 batch、输入／输出契约；相应模型 workload；测量 run 关联模型、artifact、runtime、device/system、configuration、source | 形状维度按当前模型填写，未知字段保持可空；未测时不生成假 run。实际 precision、timing 和 operating point 独立于理论选择 | 输入配方、shape、真实精度、计时边界；有测量再填稳定批次与输入身份 |
| 共享分析壳 | 同一 `model/runtime/hardware/workload` 上下文、所选 run/capture/entity；比较→系统→DAG/热点→优化及返回 | 每个必需入口给就绪或缺省状态；无数据时仍能识别当前对象与返回位置 | 配置 descriptor 与能力记录，复用现有组件；不为缺失情况另写 workspace |
| 系统与执行对象 | 有证据时提供 `system_flow` 的 node/lane/step/read/write/edge/evidence，以及 timeline 的 window/lanes/events/coverage | 未填写流程与未采集 timeline 分开；只有流程证据也可画定性图。事件有时间而无 DAG 关联时仍显示热点 | 已确认模块、传输、提交边界；核对线程职责与采集器排除，未知职责留空 |
| DAG 与机制 | realization 的 groups/mappings/evidence/launch；可选 `reuse` 及机制配置 | 未关联 Kernel 显示待关联；机制未实现与机制未核对分开。模板仅布局已有内容 | 逻辑 refs、多对多关系、精度/shape 来源；复用对象的 kind/lifetime/依赖/重建条件，成本未知为 null |
| Roofline 与计数器 | 有证据才给 scenario/basis/point、ceiling 或独立 NCU metric | 缺公式、缺上限、未采计数器、设备不支持各有原因；有效延时继续可见 | FLOPs/读写公式边界、流量来源与内存域、精度、来源和条件；不编收益 |

硬件 `DeviceRecord` 的前端类型目前只声明部分 catalog 字段，不能代替完整 schema
验收。Roofline `ceiling` 的 compute/bandwidth 和运行点另成记录；规格峰值、实际
频率及功耗条件不可互相替代。闭合 schema 尚不能表达的新能力先做最小契约扩展，
再由共享 adapter 消费，不塞进任意文本字段。

### 缺省状态是统一能力契约

下面是 presentation 的统一含义，不要求新建一套平行 canonical 状态字段；从
现有 support、availability、missing、coverage 与关联原因解析，保留原始原因。

| 状态 | 判定依据 | 默认信息与操作 |
| --- | --- | --- |
| 数据缺失／未填写 | 身份已知，相关规格、输入维度、流程或公式尚未提供 | “输入形状未填写”“系统流程待补充”等具体对象状态；已有模块照常显示 |
| 未采集 | 支持该分析，但当前 case 没有相应 E2E、timeline 或计数器记录 | “当前输入未采集系统时间线”；保留当前输入和正常返回，不强制启动采集 |
| 无匹配数据 | 已有其他配置或采样口径的记录，当前模型／设备／输入／实际精度没有匹配项 | “当前输入暂无系统时间线”等局部状态；保留当前选择，其他配置的值不串入 |
| 不支持 | 源码、设备能力或工具环境已确认不支持当前组合／能力 | 显示简短范围和已确认原因；不显示假空图或可测量的承诺 |
| 未关联 | 已有有效事件／指标，但与当前 run、shape、DAG 或实现的关系不够明确 | 保留原始对象的耗时，说明待关联；不自动高亮某个算子 |
| 已具备但未核验／冲突 | 有记录，稳定性、精度或相同输入检查未通过／不完整 | 保留真实记录与具体状态，不能升级为稳定代表或匹配达成率 |

新增页面验收至少检查一次有证据入口与一次缺省入口：身份、形状、理论与实际
精度不串值；缺失模块有明确状态；选择和返回沿用共享导航。未采集不等于接入失败，
没有说明缺什么才是接入缺口。

## 直接复用的模块

| 模块 | 维护入口 | 改变实例时提供什么 |
| --- | --- | --- |
| 页面层次、选择与返回 | [RuntimeAnalysisWorkspace](../src/features/runtime/RuntimeAnalysisWorkspace.tsx)、[分析上下文](../src/features/runtime/domain/resolveAnalysisContext.ts) | model、runtime、hardware、workload、选中记录；组件共享同一上下文 |
| 能力缺省状态 | [AnalysisPlaceholder](../src/components/AnalysisPlaceholder.tsx) | 共享 presentation 接收 `title, state, detail`；state 区分未填写、未采集、无匹配、待关联、不支持、待核验，缺失原因由上下文解析，组件不推测事实 |
| 默认输入与比较策略 | [modelAnalysisDescriptor](../src/features/runtime/domain/modelAnalysisDescriptor.ts) | 模型默认输入、已支持的比较范围；实测组合来自记录 |
| 理论与实现 DAG | [LogicalDagSvg](../src/features/model-graph/components/LogicalDagSvg.tsx)、[实现图](../src/features/runtime/components/Pi0ImplementationDagSection.tsx) | 模型节点、张量形状、布局、融合／量化组和逻辑映射 |
| CPU/GPU 系统过程 | [RuntimeSystemFlow](../src/features/runtime/components/RuntimeSystemFlow.tsx) | `flow` 的节点、执行通道、顺序、读写、边界和有依据的连线；`runtimeLabel` 只作标题 |
| 真实时间线与深度查看 | [TimelineViewport](../src/features/timeline/components/TimelineViewport.tsx)、[Perfetto 导出](../src/features/timeline/perfetto/traceExport.ts) | 一条 canonical timeline；单位转换、区间聚合、缩放与导出统一处理 |
| 总体统计与 Kernel 热点 | [Pi0NsysSection](../src/features/runtime/components/Pi0NsysSection.tsx)、[ExecutionHotspots](../src/features/runtime/components/ExecutionHotspots.tsx) | 中位数与稳定性摘要、事件、调用配置、已确认关联；已有文件名不构成模型限制 |
| Roofline 与硬件指标 | [Roofline 功能目录](../src/features/roofline)、[KernelNcuMetrics](../src/features/runtime/components/KernelNcuMetrics.tsx) | 对象工作量、内存域、流量口径、实际调用、设备上限和指标单位 |
| 选中对象的 Roofline 图表与指标 | [RooflinePlot](../src/features/roofline/components/RooflinePlot.tsx)、[指标表](../src/features/roofline/components/RooflineMetricsTable.tsx)、[理论详情](../src/features/roofline/components/TheoryRooflinePanel.tsx) | 统一轴、空心理论点、实测点、指标行和折叠说明；GEMM、Attention、RMSNorm 与 Kernel 配对共用，公式不放入绘图组件 |
| RMSNorm 理论估计 | [归一化公式](../src/features/roofline/domain/normalizationEstimate.ts)、[逻辑算子适配](../src/features/roofline/domain/rmsNormFromOperator.ts) | 行数、归一化宽度、存储位宽、普通算术/归约/rsqrt 及带宽；基础归一化与条件化仿射分别提供 |
| 逐元素运算与图块投影 | [单次公式](../src/features/roofline/domain/localOperatorEstimate.ts)、[局部图表适配](../src/features/model-graph/components/LocalOperatorRooflinePanel.tsx) | 加法、乘法、Euler 更新的形状；图块尺寸、共享投影权重、输入与输出位宽。普通加乘、融合乘加与矩阵计算分别选择上限 |
| 归一化、激活与嵌入 | [计算配方](../src/features/roofline/domain/remainingOperatorEstimate.ts)、[共享面板适配](../src/features/model-graph/components/RemainingOperatorRooflinePanel.tsx) | LayerNorm 的中心方差、GELU 的 tanh 近似、SiLU、给定系数表的 RoPE、正弦时间编码和查表。普通算术与特殊函数分别计数，所选配方写在标题及折叠条件中 |
| Attention 两种理论路径 | [公式](../src/features/roofline/domain/attentionEstimate.ts)、[共享图表](../src/features/roofline/components/AttentionRooflinePanel.tsx) | 单次 Q/K/V 形状、各张量字节数、mask 与 Tensor/CUDA/SFU/带宽速率；硬件 profile 单独配置并标注参考假设 |
| 布局与物化拷贝 | [ConcatCostPanel](../src/features/model-graph/components/ConcatCostPanel.tsx)、[带宽标尺](../src/features/roofline/components/BandwidthReferenceBar.tsx) | concat/reshape/slice/permute、单次输入与输出字节数、激活位宽与带宽；同一模板呈现预布局和物化条件。零 FLOP 的布局与查表用线性 GB/s 视图 |
| 执行优化卡片与机制图 | [RuntimeReuseDiagram](../src/features/runtime/components/RuntimeReuseDiagram.tsx)、[机制配置](../src/features/runtime/presentation/reuseMechanisms.ts) | 复用类型、生命周期、依赖、失效条件；已核对的机制配置决定选哪幅图 |
| 色彩、字体与交互 | [base.css](../src/styles/base.css)、[wheelZoom](../src/features/workbench/wheelZoom.ts) | 使用共享语义 token；不为每种硬件新建主题或缩放实现 |
| 离线构建与截图 | [build](../tools/build.py)、[render_review](../tools/render_review.mjs) | 已解析数据、完整页面 URL、视窗和截图选择器；产物留 `.local/` |

页面与图形都用现有 React、SVG、CSS。机制图的布局是代码资产，输入来自 typed 配置；
不为每个输入保存一张位图。真实截图是本次审阅记录，留本机。已有模型的 DAG 几何保持不变。

## 自动生成与 agent 编写各负责什么

| 内容 | 直接由工具／模板生成 | agent 需要判断并提供 |
| --- | --- | --- |
| 总延时、波动和代表选择 | 已声明批次的统计、单位、稳定性检查 | 输入与计时边界是否一致，异常是否需要补采 |
| 时间线、热点排名、资源表 | 原始区间、计数器、调用数和排序 | 主线程／后台线程在当前实现的职责，热点是否值得继续追查 |
| DAG 位置、融合与量化边界 | 已确认映射的定位与高亮 | 实际调用点、形状、精度、层／步范围和多对多关系的证据 |
| 系统过程与生命周期图 | 通道、节点、连线、重复范围的布局 | 模块做什么、读写什么、准备时机、数据依赖与失效条件 |
| 通用机制解释 | 确认能力后选用 Graph 提交、结果预计算等模板 | 当前实现是否采用该机制、哪些计算移到准备阶段、哪些仍逐次执行 |
| Roofline | 从同一对象的工作量、流量、耗时计算点与参考百分比 | 公式边界、精度路径、流量是否建模、设备上限是否适用 |
| 瓶颈结论 | 展示已提供的结论与证据 | 主要耗时、可能原因、可证伪的假设、最小下一步验证；不由低占用率等单指标自动下结论 |

稳定的术语、单位、缺失状态和机制通用句在 presentation 模块维护一次。
agent 只写当前对象新增的信息：具体计算／交互、证据支持的解释，以及尚待验证的判断。
原始审阅笔记、模板使用说明与工具选项不直接复制进页面。

## 布局与 Attention 的理论输入

逻辑 concat、reshape、切片描述张量关系，不自动对应 Kernel。已确认的 view/offset
用映射状态或注释表达，无额外拷贝；实际 copy/reorder 才关联执行事件与耗时。
Concat 不固定为零：预布局可省去独立拼接，部分预布局只计算仍发生的片段拷贝。
理论面板分别展示兼容布局和物化路径；输入来自单次张量尺寸、激活位宽及所选带宽，
行选择只计算输出所需元素。生产者写入和消费者读取仍归各自算子。

Attention 的显式分数矩阵路径与融合片上驻留路径是独立理论假设，不能据此认定某个
运行栈采用了其中一条。agent 提供 batch、Q/KV 头数、query/key 长度、QK/value
维度、输入/累加/输出精度、mask 规则与存储，以及是否物化分数矩阵、融合边界、已知分块和重读规则。
当前融合模型采用理想边界读写，具体 tile 的重复读取与在线 Softmax 重缩放另需建模。
CUDA 算术与归约共享资源，指数与倒数共享 SFU；相同资源先累加需求，不同资源取包络。
公开规格和参考假设分别记录；缺少设备速率时保留工作量与流量。该单算子对照不改写模型总量的既有覆盖口径。
公式与上限由组件计算；要叠加实测，再提供对应调用、时间来源、相同工作量及流量
口径的关联。未知布局、分块或调用关系保留为条件，不从 Kernel 名称猜测。

## 新增机制或适配器时

1. 查同类渲染器与配置，先复用布局。只换标签或步骤数量时修改配置。
2. 实现决定机制；设备决定上限与计数器。换设备时复用同一实现图，重新选上限和实测数据。
3. 模型公式、逻辑结构或算法真的不同，新增模型描述／公式；不把现有模型参数塞进通用组件。
4. 新机制需要新的视觉结构时，增加一个小型渲染器及 typed 输入，在机制 resolver 注册适用条件。
5. 采样启动器、NVTX 窗口名和报告格式属于适配器。工具不支持的输入格式先补适配器，再复用统计、canonical 校验与渲染。
6. 实现声明、形状和关联经 staging 校验后用于展示。无依据的条目保持缺失，不复制另一实例的值。

检验复用时换一个模型或设备描述，确认视图沿用同一组件、参数来自新记录；
只检查改动涉及的选择、返回、缺失状态和一张真实截图。
