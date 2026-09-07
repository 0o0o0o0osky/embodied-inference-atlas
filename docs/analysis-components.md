# 分析工作台的复用边界

换模型、推理栈或设备时，先填当前实例的数据与实现描述，再使用现有视图。
采样到交付的完整顺序见 [分析流程](single-inference-analysis.md)。

## 新页面接入契约

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

## 新增机制或适配器时

1. 查同类渲染器与配置，先复用布局。只换标签或步骤数量时修改配置。
2. 实现决定机制；设备决定上限与计数器。换设备时复用同一实现图，重新选上限和实测数据。
3. 模型公式、逻辑结构或算法真的不同，新增模型描述／公式；不把现有模型参数塞进通用组件。
4. 新机制需要新的视觉结构时，增加一个小型渲染器及 typed 输入，在机制 resolver 注册适用条件。
5. 采样启动器、NVTX 窗口名和报告格式属于适配器。工具不支持的输入格式先补适配器，再复用统计、canonical 校验与渲染。
6. 实现声明、形状和关联经 staging 校验后用于展示。无依据的条目保持缺失，不复制另一实例的值。

检验复用时换一个模型或设备描述，确认视图沿用同一组件、参数来自新记录；
只检查改动涉及的选择、返回、缺失状态和一张真实截图。
