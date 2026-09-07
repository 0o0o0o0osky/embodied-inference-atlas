# 分析工作台的复用边界

换模型、推理栈或设备时，先填当前实例的数据与实现描述，再使用现有视图。
采样到交付的完整顺序见 [分析流程](single-inference-analysis.md)。

## 直接复用的模块

| 模块 | 维护入口 | 改变实例时提供什么 |
| --- | --- | --- |
| 页面层次、选择与返回 | [RuntimeAnalysisWorkspace](../src/features/runtime/RuntimeAnalysisWorkspace.tsx)、[分析上下文](../src/features/runtime/domain/resolveAnalysisContext.ts) | model、runtime、hardware、workload、选中记录；组件共享同一上下文 |
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
