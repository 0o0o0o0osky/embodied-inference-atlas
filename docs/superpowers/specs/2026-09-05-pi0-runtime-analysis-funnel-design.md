# Pi0 推理栈分析漏斗设计

## 目标

把 Pi0 的“推理栈实现”页从实现 DAG 浏览器改为性能诊断入口。阅读顺序固定为：

1. 端到端总体表现；
2. Nsys 单 capture 分解；
3. Kernel 热点与 NCU / Roofline 状态；
4. 源码审计得到的融合、量化和完整实现 DAG。

首屏回答“当前推理栈跑多快、测量口径是什么”，而不是先解释实现细节。

## 范围

- 本轮只重构 Pi0 × Jetson AGX Thor 的推理栈页。
- 复用当前 canonical 数据、URL 状态和离线构建方式。
- 保留现有 `end-to-end`、`timeline`、`roofline-kernels` 路由作为详细证据页。
- 不新增依赖，不采集新数据，不改模型或 Kernel 实现。
- 不顺手修复本次开始前已经存在的测试失败。

## 信息架构

```text
Pi0 / 推理性能
├── 总体表现
│   ├── 输入切片：视角数 × executed prompt tokens
│   ├── 按输入、输出、计时边界分组的推理栈小表
│   └── 未运行、受阻和不支持状态
├── Nsys 分解
│   ├── 同一 capture 的少量摘要
│   ├── 紧凑时间线
│   └── 完整 Nsys 详情入口
└── Kernel 与实现
    ├── Nsys Kernel 热点 Top 5
    ├── NCU 与 Kernel Roofline 覆盖状态
    ├── 融合与实际精度摘要（源码审计）
    └── 点击后挂载完整实现 DAG 与映射表
```

总体、Nsys、Kernel 是向下阅读的分析漏斗，不是三张互斥大页面。详细证据通过链接进入现有页面。

## 总体表现

- 默认输入切片为 `V=2, L_PROMPT=22`，选择范围来自当前硬件上的实测 E2E 矩阵；用户可以切换视角与 prompt 长度。
- 一行代表 `(runtime, actual precision, selected input slice)` 的一条汇总记录。
- 端到端主值遵循既有方法学：实测优先 mean，否则 p50；统计量名称必须跟随数值显示。
- P95、每 run 样本数、实际精度和 Profiler 覆盖作为少量辅助列。
- FlashRT 与 vla.cpp 分属不同测量口径。口径标题明确展示输入类型、输出 action shape、state reuse、timing boundary 和 operating point。
- 不跨口径排序，不显示 speedup、相对柱长、最快颜色或暗示同比的图形。
- VLA-Perf 是分析工具，不进入推理栈表。
- run ID、revision、原始 measurement ID 和逐 sample 数据不进入首屏。

## Nsys 分解

- 只有选中推理栈后才展示对应证据；不得借用其他 runtime 的 capture。
- 默认选择 graph-envelope capture，以较低侵入的预测窗口为第一视图；node trace 和 system-wide trace 作为切换项。
- 摘要和时间线必须来自同一 capture。
- Graph span 只称“执行包络”，不能称 GPU busy；CPU scheduled time 不能称 CPU 利用率、空闲或可卸载空间。
- prompt token 未记录时明确显示“部分上下文匹配”，不能暗示与上方 E2E 是同一次执行。
- NCU replay 指标不放在 Nsys 区域。

## Kernel 与实现

- 默认显示同一 node trace 的 Kernel 热点 Top 5，只展示签名、累计时长、占已记录 Kernel 时长、调用数和 NCU 状态。
- 单 launch NCU replay 不与 Nsys aggregate 时长相加。
- NCU 的 SM、Tensor、Memory SOL、L1/L2、Occupancy 等完整指标留在详细页。
- 缺少 DRAM 流量、SchedulerStats 或 scoreboard 时，不判定 compute-bound、memory-bound 或 LPDDR 饱和。
- Kernel Roofline 没有实测点时显示“未建立”，不把通用理论点伪装成所选 runtime 的实测结果。
- 融合、消除和量化属于“实现映射”子区，明确标注“源码审计；Profiler 未关联”。
- 当前 `operator_kernel_links` 为零；禁止从 Kernel 热点画线连接 DAG 节点。
- 完整 DAG 默认不挂载。用户点击“查看完整实现图”后才渲染，关闭后释放其视觉空间。

## 视觉方向

产品是面向推理工程师的离线性能仪器，而不是通用 SaaS dashboard。

- 色彩：冷白 `#F5F8FC`、纸白 `#FFFFFF`、石墨 `#17232E`、信号青 `#0E8EA0`、深青黑 `#102A32`、证据警示琥珀 `#A8731D`。
- 字体：沿用 IBM Plex Sans / Noto Sans SC；数字和短标签使用现有 mono 字体，但不让整页变成终端界面。
- 布局：左对齐、全宽分段、单一主表；不用 KPI 卡片阵列。Nsys 时间线是唯一高对比视觉焦点。
- 正文不低于 14px，辅助说明不低于 12px；首屏表最多六列。
- 小屏将 P95 和样本数折入端到端/状态单元，避免横向信息爆炸。
- 交互动画只用于展开 DAG 和切换 capture，尊重 `prefers-reduced-motion`。

## 证据边界

- measured、analytical、source audit、Nsys、NCU 是不同证据面；页面顺序不意味着来自同一次执行。
- 缺失值保持缺失，不转成零。
- operating point 为 `unknown` 时不生成运行时速度比。
- 所有当前 E2E correctness 为 `not_assessed`，页面不声称验证过的 speedup。

## 验收

- 1440×900 首屏能看到总体表和 Nsys 区域的开头，看不到大型 DAG。
- 默认切片能看到 FlashRT 以及 vla.cpp 两种实际精度的聚合值，且按不同口径分组。
- 选择没有 Profiler 的 vla.cpp 时，Nsys/Kernel 显示明确缺失状态，不借用 FlashRT 数据。
- 选择 FlashRT 后，Nsys 默认 graph capture，Kernel 区显示 Top 5 和未建立 Kernel Roofline/算子关联的状态。
- 点击后可以打开完整 DAG，原有缩放、拖拽和节点详情仍可用；关闭后恢复紧凑页面。

