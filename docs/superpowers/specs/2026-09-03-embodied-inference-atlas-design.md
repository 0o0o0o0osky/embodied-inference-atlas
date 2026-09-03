# Embodied Inference Atlas 设计规格

状态：已完成对话设计，等待书面规格审阅  
日期：2026-09-03  
仓库：`embodied-inference-atlas`

## 1. 目标

Embodied Inference Atlas 是一个独立、纯数据、完全离线的具身模型推理分析仓库。它用于回答以下问题：

1. 当前 VLA、World Model（WM）、World Action Model（WAM）及混合模型的推理时间消耗在哪里？
2. 不同推理栈离设备理论上限和实测可达上限有多远？
3. 差距来自模型工作量、运行时调度、CPU/GPU 空洞、kernel 效率、内存系统，还是设备频率与功耗限制？
4. GPU 忙时 CPU 是否确实存在可利用的计算余量？即使存在，该余量是否足以覆盖共享内存竞争、同步和工作切分成本？
5. 哪些瓶颈在多个模型、推理栈和设备上重复出现？

仓库呈现证据，不预设 CPU 协同、量化、调度或 kernel 重写一定有效。结论必须能追溯到本地测量、公开外部报告或显式分析假设。

这里的“纯数据”是指仓库不包含推理 runtime、模型权重或在线应用逻辑。规范化数据和由同一份数据生成的静态 HTML 报告共同构成数据产品；静态页面明确属于首版范围。

## 2. 范围与非目标

### 2.1 范围内

- 模型模块、数据流、张量形状和执行次数。
- 算子类型、形状、FLOPs、访存量和算术强度。
- 端到端延迟、阶段延迟、吞吐、功耗、能耗和运行稳定性。
- Nsys 提取的 CPU/GPU timeline、同步、传输、空洞与重叠。
- NCU 提取的真实推理 kernel 指标。
- VLA-Perf 或等价分析产生的延迟下界与 roofline。
- 浮点和量化执行配置各自独立的 roofline。
- 推理栈能力、公开声称的优化，以及实际测量中可验证的行为。
- 本地实测、外部报告和理论分析的并列展示。

### 2.2 永久排除

- 下载模型或模型权重。
- 自动安装、配置或维护任何推理栈。
- 成为新的推理框架、benchmark 调度平台或在线服务。
- 修改、生成或优化推理 kernel。
- 在 Git 中保存原始 `.nsys-rep`、`.ncu-rep`、完整日志或高频 telemetry。
- 在网页中提供原始 profiler 报告查看器。
- 将不同任务契约、不同输出语义的数据强行计算 speedup。

推理栈的部署和实际运行发生在仓库之外。本仓库从已存在的测量产物中提取、验证、比较和展示数据。

## 3. 设计原则

1. **证据优先**：所有数字带有证据类型、测量方法和配置上下文。
2. **缺失不是零**：未采集或不适用的指标使用 `null` 和原因，不进行推断填充。
3. **可比性显式化**：只有 `comparison_contract` 完全一致并被构建器归入同组的结果才能生成 speedup 或排名。
4. **瓶颈分层**：模型工作量、运行时、系统并行、kernel 和硬件工作点分开分析。
5. **真实运行优先**：NCU kernel 必须来自被评估推理栈的真实推理路径。
6. **离线优先**：构建和网页浏览不依赖网络、CDN、数据库或后端服务。
7. **隐私默认关闭**：原始数据留在产生它的采集机器，只有白名单字段可进入版本库。
8. **避免伪精度**：理论峰值、经验峰值和真实测量分别展示。

## 4. 模型分类与工作负载描述

模型使用带判别字段（discriminator）的公共结构和类型扩展，而不是以 VLA 字段作为全局结构。`model_type` 支持：

- `vla`
- `world_model`
- `world_action_model`
- `hybrid`
- `other`

模型 catalog 只保存架构固有属性。所有模型共享以下描述：

- 参数规模、默认精度、公开模型 ID 和架构版本。
- 输入与输出模态。
- 模块 DAG、张量流、shape 表达式和实际 shape。
- 模块执行次数、循环结构和关键状态。
- 推理契约，包括输入准备点、输出可用点和状态复用规则。

每次测量的动态工作负载统一放在 `workload` 下：`workload.common` 保存 batch、输入模态和任务契约；`workload.vla`、`workload.world_model`、`workload.world_action_model` 是互不复用字段名的类型命名空间。类型扩展仅在适用时出现：

- VLA：`camera_views`、图像分辨率、`prompt_tokens`、`action_dimension`、`action_chunk`、`denoise_steps`。
- WM：`history_frames`、`latent_tokens`、`rollout_frames`、生成分辨率和 `sampling_steps`。
- WAM：`observation_steps`、`planning_horizon_actions`、`candidate_trajectories`、动作生成与评估轮次。
- Hybrid：`components` 按顺序引用上述有类型的 payload，并明确模块边界和数据交换。

每个扩展在 schema 中明确 required 字段、数值类型和单位；不适用的扩展不得出现。执行模式独立记录，例如 autoregressive、diffusion、flow matching、video generation、single-pass encoder 和 iterative planner。模型页按适用字段展示，不适用字段不会被伪装成零。

## 5. 总体架构

采用“静态数据编译器”架构：

```text
各采集机器的本地原始报告（不入库）
        ↓
本地提取器
        ↓
.local/staging（不入库，人工检查）
        ↓
schema 校验 + 隐私检查 + promotion
        ↓
data/ 中的规范化 JSON（入库）
        ↓
Python 静态构建器
        ↓
site/ 中的离线 HTML（入库）
```

选择该架构是因为数据需要审阅和长期追踪，而网页本身不需要服务器。与手写 HTML 相比，它避免数据和页面逻辑重复；与 SPA、Node 工具链或本地数据库相比，它更容易完全离线复制和审计。

## 6. 仓库结构

```text
embodied-inference-atlas/
├── data/
│   ├── catalog/
│   │   ├── models.json
│   │   ├── devices.json
│   │   ├── systems.json
│   │   ├── runtimes.json
│   │   └── sources.json
│   ├── architectures/
│   └── measurements/
│       ├── runs.json
│       ├── end_to_end.json
│       ├── stages.json
│       ├── operators.json
│       ├── kernels.json
│       ├── operator_kernel_links.json
│       ├── timelines.json
│       ├── telemetry.json
│       └── rooflines.json
├── schema/
├── extractors/
│   ├── nsys.py
│   ├── ncu.py
│   ├── vla_perf.py
│   ├── benchmark.py
│   └── external_report.py
├── web/
├── assets/vendor/
├── tools/
│   ├── validate.py
│   ├── promote.py
│   └── build.py
├── site/
├── tests/
├── .local/
└── README.md
```

`schema/` 定义可以进入版本库的数据契约；`web/` 保存页面模板和前端源文件；`site/` 是可直接打开的生成结果。这三者职责不重叠。

每台采集机器在自己的 checkout 或工作目录中使用 `.local/` 保存原始报告、临时导出和 staging 数据，并整体加入 `.gitignore`。提取器默认只能写入 `.local/staging`，不能直接修改 `data/`。机器之间只交换通过校验的规范化 JSON，不集中复制原始 profiler 文件。

## 7. 规范化数据模型

### 7.1 Catalog

`models.json` 记录模型分类、参数量、模块 DAG、输入输出、shape 表达式和执行模式。

`devices.json` 保留真实设备型号，例如 NVIDIA Jetson AGX Thor、NVIDIA A800，并记录：

- GPU/CPU 架构、内存容量和内存类型。
- 各精度理论计算峰值。
- 理论内存带宽和可选的经验可达带宽。
- 支持的功耗模式、时钟策略和规格来源。

`systems.json` 区分同型号的不同物理机器和多设备拓扑。它使用匿名 `system_id`（例如 `thor-unit-01`）关联 device model、CPU、内存配置、设备数量、互连、OS、驱动和 CUDA 版本；不保存 hostname、资产编号、IP 或机房位置。同一型号的多台机器不会被默认为同一运行环境。

`runtimes.json` 记录 runtime 名称、版本、公开上游 commit、后端和能力。私有 fork 不保存 commit，只使用匿名版本标签。能力项包括 CUDA Graph、异步预处理、KV/paged cache、prefix/radix reuse、batching、step batching、multi-stage、multi-device、量化和流水执行。每项能力均标记为 `verified_measured`、`reported`、`not_supported` 或 `unknown`，避免把项目宣传直接当成本机事实。

`sources.json` 记录外部来源 URL、标题、发布日期、访问日期、证据范围和简要转述，不复制大段原文。

URL 必须是明确公开的 HTTP(S) 页面；拒绝 localhost、私网/IP 地址、内嵌用户名密码和本机文件链接，并移除非必要 query、fragment 与跟踪参数。

### 7.2 Configuration、Run 与 Measurement

数据使用三个层级，避免把不同 profiler replay 伪装成同一次运行：

- `configuration_id`：规范化实验配置，可关联具有相同模型、workload、runtime、设备和工作点意图的多种采集。
- `run_id`：一次具体的 benchmark、Nsys、NCU、telemetry、分析计算或外部报告记录。不同采集工具必须使用不同 `run_id`。
- `measurement_id`：run 中的一个数值、分布、事件集合或分析结论，拥有自己的 method、window 和证据来源。

跨 run 页面只能将记录标为“同配置关联测量”，不能声称它们来自同一热状态或同一执行样本。核心字段包括：

- `schema_version`
- `model_id`、`runtime_id`、`device_id`、匿名 `system_id` 及本次分配的设备拓扑
- `evidence`：`measured_local | reported_external | analytical`
- run 级 `capture_method` 和 measurement 级 `measurement_method`：`wall_clock | cuda_event | nsys | ncu | telemetry | vla_perf | reported | derived`
- `comparison_contract` 和由构建器分配的 `comparability_group`
- 模型类型对应的 workload 参数
- `workload.common` 和由模型类型判定的 VLA、WM、WAM 或 Hybrid workload payload
- precision/quantization 配置
- timing boundary 和状态复用策略
- 样本数、warmup 和聚合方法
- 正确性状态与无效原因
- 设备工作点、telemetry 和 throttle 状态

measurement 继承 run 的证据来源，但可以使用更具体的 method。`derived` measurement 必须列出输入 `measurement_id`、公式/分析版本和假设；不能只保存一个脱离来源的结果。

`comparability_group` 不是可自由填写的比较依据，只是页面显示标签。实际比较依据是结构化的 `comparison_contract`，至少包含：

- 模型 artifact 或被明确声明为等价的 artifact 组。
- 任务、输入来源、预处理、输出语义和正确性门槛。
- 完整 workload payload、shape 和 solver/sampling schedule。
- precision/quantization 语义。
- timing boundary、state/prefix reuse 和 warm/cold policy。

构建器只对 canonical JSON 完全相等的 `comparison_contract` 分组，再分配无语义的顺序标签，例如 `cg-0001`；不通过路径、文件 hash 或时间戳生成 ID。人工标签不能覆盖字段不一致。网页只在 contract 一致且记录有效时计算 speedup。

### 7.3 精度与量化配置

精度不是单个字符串。记录至少包含：

- `weight_dtype`
- `activation_dtype`
- `accumulation_dtype`
- `execution_dtype`
- `quant_scheme`
- `granularity`
- `scale_zero_point_bytes`
- `dequant_strategy`
- `fused`

因此 W8A16、W8A8、W4A16、FP8、BF16 和 FP16 是不同执行配置。仅权重量化不能自动使用 INT8 或 INT4 的计算峰值。

### 7.4 测量数据集

- `end_to_end.json`：samples、p50、p95、mean、吞吐、功耗和单位工作能耗。
- `stages.json`：可嵌套阶段、相对时间区间或统计摘要、资源 lane、覆盖率、inclusive/exclusive 时间、执行次数和 critical-path 属性。
- `operators.json`：模块归属、类型、M/N/K 或其他 shape、调用次数、FLOPs、各层级 bytes 和算术强度。
- `kernels.json`：规范化 kernel 类型、白名单生成的 `kernel_label_sanitized`、launch shape、时长、调用次数和 NCU 指标；不保存原始实例名或从原字符串生成的可逆 ID。
- `operator_kernel_links.json`：算子与 kernel 的多对多关联、关联依据、覆盖率、置信度和 ambiguous/unknown 状态。
- `timelines.json`：脱敏、降采样后的 CPU/GPU lane 与事件，不保存原始 trace 字符串。
- `telemetry.json`：降采样时间序列及统计摘要。
- `rooflines.json`：设备 ceiling、操作点、下界、峰值来源和分析假设。

所有数值 measurement 明确记录 `value`、`unit`、`statistic`、`sample_count`、`population`、warmup/steady-state 划分和采样窗口；百分位数同时记录 `percentile_method`。延迟规范单位为毫秒，功率为同一 timing window 上的平均瓦特，能量为该窗口积分得到的焦耳。吞吐和单位工作能耗必须带 `work_unit`，例如 `action`、`action_chunk`、`generated_frame`、`rollout` 或 `token`，不同 work unit 不进入同一比较图。

stage 的 `inclusive/exclusive` 只对同一个 run 中具有时间区间的事件按时间并集计算。阶段堆叠图只接受覆盖同一 timing window、互斥且完整的 partition。只有 p50/p95 等独立摘要时，各阶段不能相加；页面改用并列图并提示“统计量不可加”。

## 8. 瓶颈分层与延迟差距

为了避免把所有问题都归结为 kernel，分析按四层展示：

1. **工作负载层**：模块和循环的执行次数、NFE、生成 token/frame/action 数量，以及不可并行的依赖链。
2. **运行时层**：graph 构建、launch gap、同步、CPU 前后处理、数据移动和 stage 串行化。
3. **kernel 层**：单 kernel 相对其精度 roofline 的效率、occupancy、waves 和 memory hierarchy 行为。
4. **设备层**：功耗模式、实际频率、温度、throttle 和 CPU/GPU/内存共享资源竞争。

当数据允许时，一个 run 同时展示：

- 分析得到的关键路径下界。
- GPU kernel union/critical-path 时间。
- 完整端到端时间。
- kernel 效率差距和 runtime/orchestration 差距。

这些差距不会被自动解释为“可完全消除”。页面同时显示计算方法和缺失证据。跨模型、跨 runtime 的瓶颈矩阵用于发现重复出现的阶段、同步模式和低效 shape。

## 9. Nsys 提取与 CPU/GPU 并行分析

`nsys.py` 使用本机 `nsys stats` 和 SQLite 导出能力读取：

- CPU 线程、OS runtime 调度区间（若采集）。
- CUDA API、同步调用和 launch。
- GPU streams、kernels、CUDA Graph 和 memcpy。
- NVTX、模块和 stage 边界。
- GPU busy/idle、launch gap 和跨设备重叠。

进入正式数据的所有时间均改为相对 inference window 起点；PID、TID、原始 stream ID 和 wall-clock 时间被移除。CPU/GPU lane 使用本次 run 内的顺序匿名 ID，NVTX 和事件名映射到受控 stage/event 枚举。保留脱敏后的相对事件顺序是分析负载结构所必需的数据，但它不能携带原始文本或本机标识。

在一个明确的 inference window 内计算：

- GPU busy union 占比。
- 应用 CPU 线程与 GPU busy 的时间交集。
- GPU busy 期间应用 CPU 消耗的 core-equivalents。
- 若 telemetry 或 OS runtime 足够，估计整机 CPU idle core-equivalents。
- CPU-only、GPU-only、overlap 和同步等待区间。

“应用没有 CPU 事件”与“系统 CPU 空闲”是两个不同结论。CPU 余量的证据置信度为：

- `high`：包含 OS runtime/thread scheduling 和足够的 per-core 观测。
- `medium`：包含完整 CUDA API、NVTX 和目标进程线程事件。
- `low`：只能从 API 或 stage 间隙间接推断。

缺少调度数据时，网页不能断言 CPU 空闲。CPU 协同可行性只展示计算余量、带宽余量和可能的同步成本，不在本仓库实现 offload。

## 10. NCU 与 kernel 分析

`ncu.py` 只导入目标推理栈真实执行路径产生的 `.ncu-rep` 导出数据。原始报告留在 `.local/raw/ncu`。

提取内容包括：

- duration、calls、grid、block、waves 和 occupancy。
- SM、Tensor、Memory SOL。
- DRAM、L2、L1 吞吐及峰值比例。
- achieved FLOP/s、byte/s 和算术强度。
- 寄存器、shared memory 或 occupancy 约束（报告存在时）。

kernel 名称被规范化为可聚合类型；只保留分析所需的脱敏标签。完整实例名称或编译路径不进入 Git。

算子与 kernel 不是一对一关系。关联表允许 fusion、一个算子多次 launch、一个 kernel 服务多个算子以及 CUDA Graph replay。每条关联必须记录 `mapping_method`（例如 NVTX correlation、runtime correlation 或 shape heuristic）、`confidence`、覆盖率和来源 run。仅靠名称或 shape 猜测的关联不得显示为确定归因；无法判定时保留 `unknown/ambiguous`。

每个 kernel 分开展示：

- roofline 预测的限制侧：compute 或 memory。
- 相对理论 ceiling 与经验 ceiling 的 headroom。
- NCU 实测饱和度。
- 根因提示：`compute_bound | memory_bound | latency_tail | occupancy_limited | unknown`。

分类规则和阈值必须版本化并显示在页面中。缺少 DRAM 指标时保持 `null`，不能用 L2 或笼统的 Memory SOL 代替 LPDDR/HBM 饱和度结论。NCU replay 是独立测量，不能与端到端采样直接相加。

`roofline_limiter` 只表示算术强度下更低的理论/经验 ceiling；`observed_bottleneck` 还必须有对应 NCU 饱和度证据。仅看到低 SM 或低带宽不能判为 compute-bound 或 memory-bound。证据不足时默认 `unknown`。

## 11. 浮点与量化 Roofline

每个设备、数据类型、量化方式和执行路径拥有独立 roofline。每条 ceiling 标记来源：

- `vendor_theoretical`
- `measured_empirical`
- `reported_external`
- `analytical_assumption`

主要规则：

1. BF16、FP16、FP8、INT8 和 INT4 使用各自适用的计算峰值。
2. W8A16/W4A16 默认仍受实际 activation/execution dtype 的计算路径约束，除非 NCU 或实现证据确认使用其他指令路径。
3. 权重、激活、输出、scale、zero-point 和临时 buffer 都进入 bytes 估算。
4. 非融合 dequant 作为独立算子和 kernel 展示；融合方案按完整 fused 工作量和真实访存建模。
5. 一个量化算子图可以同时展示 GEMM roofline 与包含 dequant/packing 的 composite lower bound。
6. 主 roofline 使用设备 DRAM/系统内存带宽；有数据时增加 L2 roofline，但二者不能混用。

VLA-Perf 导入结果标记为 `analytical`，并保留其模型、算子、shape、精度和并行假设。Pi0.5 proxy 或自定义 SmolVLA operator list 必须显式标记，不能伪装成原生模型支持。

## 12. 工作点、Telemetry 与 Throttle

每个本地 run 记录声明工作点：

- `power_mode`
- `power_limit_w`
- `clock_policy`
- `jetson_clocks`
- `fan_mode`
- warmup iterations/duration 和是否预热稳定

记录观察摘要：

- GPU、EMC/内存和 CPU 时钟。
- GPU、CPU 和内存利用率。
- 温度 start/max/end。
- board/GPU/CPU 功耗。

正式 telemetry 只允许上述数值字段和 schema 中声明的 throttle 标记。时间轴相对 run 起点，记录 `sampling_period_ms`，并按固定窗口降采样；不保留 wall-clock、进程/主机标识、网络接口或采集工具附带的任意扩展文本。

`throttle_status` 使用：

- `none`
- `suspected`
- `confirmed_thermal`
- `confirmed_power`
- `confirmed_voltage`
- `unknown`

默认比较要求相同功耗与时钟策略。MAXN dynamic 与 MAXN locked 是不同工作点。确认 throttle 或正确性失败的记录保留用于诊断，但不进入默认排名。外部报告只声明 MAXN 而没有观察频率时，状态为 `unknown`。

NCU replay、Nsys trace 和纯 wall-clock benchmark 是不同 run，通过共同配置关联，但不假设它们在同一热状态下完成。

## 13. 外部报告

外部声称允许进入仓库，但必须手工整理为规范化记录，并包含：

- 来源 URL、标题、发布日期和访问日期。
- 报告声称的模型、设备、runtime、精度和 workload。
- 原报告 timing boundary、统计方法和已知缺失条件。
- `evidence = reported_external`。

外部结果使用独立视觉样式，不与本地测量合并成同一分布。只有完整满足可比性规则时才允许显示数值 speedup，否则仅并排展示。

## 14. 页面与可视化

网页使用仓库内 vendored ECharts，数据嵌入静态 HTML，不请求 CDN 或 API。

### 14.1 覆盖首页 `index.html`

- 模型 × runtime × device 覆盖矩阵。
- 本地实测、外部报告、理论分析和 Nsys/NCU/telemetry/roofline 覆盖状态。
- model type、设备、精度、views、prompt/context、NFE/horizon 和功耗模式过滤。
- “未测量”“不适用”“采集失败”和“被比较规则阻止”明确区分。

### 14.2 模型页 `models/<model>.html`

- 模块 DAG、数据流、shape 和模块执行次数。
- context、iterative generation、rollout、planning 等边界。
- workload 参数变化如何改变 shape 与执行次数。
- 该模型在各 runtime/device 上的全部有效测量。

### 14.3 算子页 `operators.html`

- GEMM、attention、convolution、normalization、sampling 等算子。
- shape、调用次数、FLOPs、bytes、算术强度和来源模块。
- VLA-Perf/分析 roofline，以及模型模块到真实 kernel 的链接。

### 14.4 性能页 `performance.html`

- 端到端延迟、分布、阶段堆叠、吞吐、功耗和单位输出能耗。
- 随模型特有 workload 参数和精度变化的曲线。
- 分析下界、kernel critical path 和 E2E 的分层差距。
- 跨 runtime 的瓶颈矩阵。
- 外部报告独立样式和不可比提示。

### 14.5 Timeline 页 `timelines/<run>.html`

- CPU threads、CUDA API、GPU streams、CUDA Graph、kernels 和 memcpy。
- NVTX/stages、同步等待、CPU/GPU overlap 和 GPU 空洞。
- telemetry overlay、缩放、hover 和阶段聚合。
- 仅使用规范化事件，不内嵌原始 profiler 报告。

### 14.6 Kernel/Roofline 页 `kernels.html`

- kernel 时长、调用次数、E2E 占比、launch geometry 和 waves。
- SM/Tensor/Memory SOL、occupancy、L1/L2/DRAM 指标。
- achieved FLOP/s、GB/s、算术强度和独立精度/量化 roofline。
- compute、memory、latency-tail、occupancy 或 unknown 分类。

视觉约定：本地实测为实线，外部报告为纹理，理论分析为虚线或空心点；不可比和缺失数据为灰色；确认 throttle 或质量失败为红色。

## 15. 提取、脱敏与 Promotion

每台采集机器的本地目录约定：

```text
.local/raw/nsys/
.local/raw/ncu/
.local/raw/benchmarks/
.local/raw/telemetry/
.local/raw/external/
.local/staging/
```

提取器只能产生 staging JSON。`promote.py` 使用字段白名单，将通过 schema 和隐私检查的记录移入 `data/`。promotion 前输出可读 diff，供人工确认新增与修改内容。

允许进入 Git：

- 真实设备型号、公开模型/runtime 名称和版本。
- 结构化 profiler 指标、workload、统计结果和功耗工作点。
- 公开来源链接和分析假设。

禁止进入 Git：

- 用户名、hostname、IP、绝对路径和本地目录布局。
- 环境变量、完整命令行和未经筛选的 profiler 字符串。
- 原始 prompt、错误堆栈和私有 checkpoint 名称。
- 原始报告路径或文件 SHA256。

公开 checkpoint 使用公开模型 ID；非公开 checkpoint 使用仓库内匿名标签。prompt 只保留 token 数、模板类别等结构化信息。

正式 schema 是闭合白名单：对象拒绝未知字段，每个自由文本字段都有明确用途和长度限制。`run_id`、`measurement_id` 与匿名 checkpoint 标签使用仓库内顺序 ID，不从路径、报告 hash、wall-clock 或私有名称派生。

`.gitignore` 是第一道保护，提交前校验是强制边界：拒绝 `.local/`、符号链接、`.nsys-rep`、`.ncu-rep`、SQLite 导出和未规范化日志出现在待提交文件中。private GitHub 只是访问控制，不替代脱敏。

## 16. 校验、错误处理与构建

`validate.py` 校验：

- schema 类型、必填字段、单位和枚举。
- catalog 引用、run ID 和数据集引用完整性。
- timing boundary、precision、workload 与 `comparison_contract` 一致性，以及派生 comparability group 的正确性。
- 绝对路径、敏感字符串和禁止字段。
- throttle/正确性状态对应的比较资格。
- `data/`、生成的 `site/` 和整个 Git staged tree 的发布边界。

失败记录停留在 staging，不部分写入正式数据。缺失指标使用 `null`、`missing_reason` 和可选 `collection_status`。页面对合法缺失显示 `N/A` 或 `unknown`，而不是构建失败或显示零。

`build.py` 仅使用 Python 标准库和 vendored 前端资源。相同输入应生成确定性输出。生成后的 `site/` 可在断网环境中直接打开，并在构建后接受与 `data/` 相同的阻断式隐私扫描。构建器不能读取 `.local/raw` 或 `.local/staging`。

## 17. 测试策略

测试保持轻量，只保护真实工作流中的高风险边界：

- 每种提取器一个小型、脱敏的代表性导出样例，验证主要字段。
- schema、引用、单位和明显隐私泄漏检查。
- 一种缺失指标行为：显示 `N/A/unknown`，不误判为零。
- 一次完整离线构建，检查核心页面和内部链接。

不加入压力测试、fuzz、罕见组合矩阵或大量人为极端数据。真实报告主要通过实际导入和页面人工检查验证。

## 18. 首批数据范围

首批数据以现有 Pi0、Pi0.5 和 SmolVLA 测量为主，但 schema 和页面不受 VLA 限制。候选来源包括：

- FlashRT Pi0/Pi0.5 的 shape、precision、context reuse 和 CPU interference 结果。
- LeRobot SmolVLA 的 shape/prompt 结果。
- vla.cpp 的 Pi0/SmolVLA 浮点与量化结果。
- 其他已经实际运行并具备明确配置的推理栈结果。
- VLA-Perf 的 shape/precision 理论估计。
- 实际推理栈新采集的 Nsys、NCU 和 tegrastats 数据。
- 配置足够完整的公开外部报告。

适用时覆盖 1/2/3 views、prompt/context length、BF16/FP16/FP8/量化配置、NFE 和 action/rollout horizon。当前没有数据的组合显示为未测量，不创建占位数值。

WM、WAM 和 hybrid 模型按同一入口逐步加入。新增模型不要求全量 runtime/device 覆盖，只要求其数据和任务契约完整。

首版实现按三个可独立验收的切片推进，避免先搭建一个没有真实结论的通用平台：

1. **数据基础**：闭合 schema、现有结构化 benchmark/VLA-Perf 导入、覆盖首页和模型/性能/算子/roofline 基础页面。
2. **Profiler 证据链**：至少为 Thor 上一个真实模型配置关联 wall-clock、Nsys、代表性 NCU、telemetry 和分析下界；随后为第二个独立推理栈补充同类证据，才形成跨栈瓶颈结论。不同工具仍是独立 run。
3. **模型类型扩展**：在不改变公共 schema 的前提下加入第一组 WM 或 WAM 数据。没有合格数据时只保留 schema 支持，不发布空洞结论。

切片 1 本身必须产生可浏览的真实数据页面；切片 2 才宣称能够诊断 CPU/GPU 与 kernel 瓶颈；切片 3 才宣称具有 VLA 之外的实测覆盖。

## 19. 成功标准

首版完成后，使用者应能在完全离线环境中：

1. 查看模型模块、执行路径、算子 shape 和 workload 参数变化。
2. 比较合法的端到端结果，并看到不合法比较被阻止的原因。
3. 判断 E2E 与分析下界的差距主要处在哪一层。
4. 查看 GPU 忙时 CPU 的实际重叠和可用余量及其证据置信度。
5. 查看主要 kernel 是否接近对应精度/量化 roofline，以及缺失了哪些关键计数器。
6. 识别跨推理栈重复出现的瓶颈，而不是只针对单一弱基线。
7. 确认每个结果的设备工作点、频率、温度、throttle、证据来源和比较资格。
8. 审计 Git 中的数据，确认没有原始报告和本机敏感信息。

## 20. 发布与维护流程

1. 在任意采集机器上、仓库之外运行目标推理栈并采集报告。
2. 将该机器的原始产物放入它自己的 `.local/raw`。
3. 运行对应提取器生成 `.local/staging`，并绑定匿名 `system_id`。
4. 人工查看 staging 和 promotion diff。
5. 运行校验与隐私检查，promotion 到 `data/`；跨机器只移动这份规范化结果。
6. 在汇总 checkout 中静态构建 `site/` 并离线检查。
7. 提交规范化数据、构建产物和必要的方法说明。

GitHub remote 最终设置为 private。private 状态不改变任何脱敏要求。首版不启用 GitHub Pages、Actions artifact 或 Release 原始附件；仓库不复制既有评测仓库的 Git 历史，也不通过 submodule 或路径引用依赖那些仓库。
