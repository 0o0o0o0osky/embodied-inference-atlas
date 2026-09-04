# 模型算子工作台设计规格

状态：对话设计已批准，等待书面规格审阅

日期：2026-09-04

仓库：`embodied-inference-atlas`

## 1. 目的

本设计将 Atlas 的主入口从“模型与 runtime 覆盖列表”调整为“模型优先的交互式分析工作台”。它首先解释模型本身如何计算，再把具体推理栈、硬件、实测与理论分析叠加到同一套逻辑结构上。

首期完整覆盖 Pi0 与 Pi0.5，回答以下问题：

1. 模型由哪些阶段、重复模块和原子算子组成，tensor 如何流动？
2. 在给定 camera views、prompt length、action chunk 和 denoise steps 时，每个算子的实际 shape、执行次数、FLOPs 和理论流量是什么？
3. 某个推理栈如何融合、拆分、折叠或回退这些逻辑算子？
4. 在某个硬件和执行配置上，端到端时间、CPU/GPU 时间线及 kernel 指标如何对应回模型图？
5. 一个 kernel 是计算吞吐、内存带宽、延迟隐藏、占用率、工作量分布还是调度发射受限？
6. 浮点和量化情景各自的 roofline 上限是什么，哪些只是理论假设，哪些有真实实现与测量支撑？

本设计是现有 Atlas 基础设计的增量规格。现有证据类型、比较不变量、隐私规则、promotion 流程和离线构建约束继续生效。

## 2. 范围

### 2.1 首期范围

- Pi0 与 Pi0.5 的手工策展、结构化逻辑算子图。
- 可复用的 Transformer、ViT、Attention、MLP、MoE/action-expert 和 flow-step 模板。
- 可展开的 operator 详情、结构化 shape、公式、计算量、流量和动态图。
- runtime-specific graph realization：融合、拆分、消除、回退和 kernel 映射。
- 模型、runtime 与 hardware 的组合选择及证据状态。
- 实际执行精度与可任选 roofline 精度/量化情景的双轨展示。
- 脱敏的 Nsys 时间线和分层 NCU kernel 画像。
- 继续支持完全离线的静态 HTML 和 `file://` 浏览。

### 2.2 后续扩展

SmolVLA、其他 VLA、WM、WAM 与 Hybrid 模型复用同一套数据契约，但不要求在首期补齐完整逻辑图。非 Transformer 模块通过新增少量 operator 或 block template 扩展，不改变核心分层。

### 2.3 非目标

- 不自动下载模型、安装 runtime 或运行推理。
- 不把 tracing、FX、HLO、TensorRT engine 或 profiler 输出直接当作模型事实。
- 不在仓库中实现或优化 kernel。
- 不把分析精度情景描述成 runtime 已支持的配置。
- 不保存原始 `.nsys-rep`、`.ncu-rep` 或完整系统 trace。
- 不为缺失的 mapping、metric 或 hardware ceiling 生成零值或估计值。
- 不构建全组合 benchmark、stress、fuzz 或 profiler 测试体系。

## 3. 核心设计决定

### 3.1 统一逻辑 DAG 与执行覆盖层

每个模型 artifact 拥有一套框架无关的逻辑 DAG。runtime 不复制模型图，而是向同一 DAG 叠加 execution realization。

```text
逻辑模型 DAG
    + runtime realization（fold / fuse / split / fallback）
    + hardware execution evidence（run / Nsys / NCU）
    + analytical scenario（precision / quantization / roofline）
```

这样可以逐算子比较多个推理栈，同时避免把某个框架的 tracing 粒度误认为模型结构。

### 3.2 手工策展、结构化模板

模型图由人工依据官方模型定义、配置和可信实现装配。自动 tracing 可以作为核对或录入辅助，但不能覆盖人工确认的逻辑语义。

“手工”不表示逐层重复编写上千节点。基础 operator 只定义一次，Transformer 等重复结构通过可参数化 block template 实例化，模型文件只负责阶段装配、参数绑定、特殊连接和重复次数。

### 3.3 三层折叠粒度

模型图采用三级浏览：

1. 阶段：Vision Encoder、VLM、Action Expert 等。
2. 模块：ViT block、Transformer block、Attention、Gated MLP 等，重复结构显示 `×N`。
3. 原子 operator：GEMM、RoPE、Softmax、RMSNorm、Residual、Concat、Reshape、Activation 等。

默认不铺开所有层实例。用户可以进入某个模板，再选择一个具体重复实例查看 workload binding 和 execution evidence。

## 4. 四个数据平面

### 4.1 模型定义平面

模型定义与 runtime/hardware 无关，包含：

- `operator_definitions`：端口、公式、shape 约束、FLOP/Bytes 表达式和 visualizer 类型。
- `block_templates`：由 operator、tensor 和嵌套模板组成的参数化子图。
- `model_graphs`：模型阶段、模板实例、重复次数、残差/跨阶段连接、输入输出和来源。
- `shape_symbols`：符号、语义、约束和默认展示值。

逻辑 tensor 是一等对象，至少包含 tensor ID、producer port、consumer ports、axis 列表、shape expression、semantic role，以及在适用时的 layout/dtype 约束。边通过 tensor 连接，不再只保存不可解析的展示字符串。

### 4.2 Runtime realization 平面

`runtime_realizations` 由模型 artifact、runtime/version、适用 hardware 条件和实际 execution configuration 共同确定。它描述：

- 哪些逻辑 operator 保持独立；
- 哪些被 `runtime_fused` 或 `compiler_fused`；
- 哪些被拆成多个 execution group；
- 哪些被 constant-fold、预计算或消除；
- 哪些走 fallback 或只能作为 opaque group 观察；
- 实际逐 operator/group 的 weight、activation、accumulation 和 output dtype。

`execution_groups` 与逻辑 operator 是多对多关系。一个 group 可以产生多个 kernel signature/launch；一个 kernel 也可以覆盖多个逻辑步骤。所有确定 mapping 必须有 profiler、runtime instrumentation 或代码证据。仅凭名字或 shape 的猜测保留为 ambiguous，不显示为确定映射。

融合 group 的耗时和 NCU 指标只归属于 group。除非存在直接证据，否则不能按 FLOPs、Bytes 或其他比例分摊到内部逻辑 operator。

### 4.3 Execution evidence 平面

该平面保存 run、capture、timeline、kernel observation 和设备工作点：

- 模型、runtime、hardware、system、workload 和 execution configuration；
- Nsys、NCU、wall-clock、telemetry 等各自独立的 run；
- 功耗模式、时钟策略、观测频率、温度和 throttle 状态；
- 脱敏后的 timeline events、kernel launch 和规范化指标；
- 证据来源、采集窗口、工具版本和缺失原因。

跨工具 run 只能关联为同一 configuration 下的证据，不能声称来自同一个热状态或同一次执行样本。

### 4.4 Analytical scenario 平面

`roofline_scenarios` 定义可任选的浮点或量化情景。它依赖 model/operator 与 hardware ceiling，但不代表 runtime 已实现该配置。

情景结果分为：

- `ideal_analytical`：算法级最小流量与理想计算路径；
- `implementation_modeled`：计入已知中间 tensor、metadata、转换和 fusion；
- `measured`：来自匹配实际执行配置的 NCU 观测。

当情景与实际 execution configuration 不一致时，只显示 what-if 结果，不绘制虚假的 measured-to-roof ratio。

## 5. Transformer 规范分解流程

每个模型按以下步骤建模：

1. 锁定官方模型 artifact、配置与来源，Pi0/Pi0.5 分别建图。
2. 定义 image、prompt、state、action/noise token，以及 `per_view`、`per_layer`、`per_denoise_step` 等 multiplicity。
3. 使用 block template 装配阶段、重复模块、残差和跨模块连接。
4. 从输入开始传播结构化 shape expression。
5. 为每个原子 operator 绑定公式、参数 shape、FLOP/Bytes 模型和 visualizer。
6. 使用一个代表 workload 做轻量一致性核对：端口 shape 可连接、重复次数明确、关键参数量数量级一致。

形状同时保留模型公式与本次实例值。例如：

```text
context: [B, S_context, H]
S_context = V * N_image_tokens + L_prompt

当前 workload:
V = 3
L_prompt = 32
H = 2048
```

camera views、prompt length、action chunk 和 denoise steps 由 workload 提供 binding。改变 binding 重新计算实际 shape、执行次数、FLOPs、Bytes、算术强度和理论下界，但不修改逻辑图。

Shape 和 cost expression 使用受控语法/AST，前端不得使用任意代码求值。公式的展示形式与计算表达式分开保存，确保可读性与可验证性。

## 6. 模型优先页面结构

### 6.1 模型首页

首页首先展示模型卡片，而不是 runtime 覆盖表。卡片包含：

- 参数量与架构族；
- 视觉、语言和动作组件；
- 默认输入/输出契约；
- 已有 measured、analytical 和 reported evidence 覆盖度。

原有跨模型性能与 coverage 视图保留为二级入口。

### 6.2 模型工作台

```text
模型摘要
模型 × runtime × hardware                    evidence state
workload binding                             execution configuration
roofline precision/quantization scenario
--------------------------------------------------------------------
breadcrumb / graph controls | 逻辑 DAG       | operator/group detail
--------------------------------------------------------------------
E2E / stages / CPU-GPU timeline / kernel summary（有 execution 时）
```

未选择 runtime/hardware 时只显示逻辑 DAG。选择后，在同一图上叠加 fusion boundary、实际 dtype、kernel 数、耗时和 evidence 状态。

模型、runtime 与 hardware 是主要选择空间。数据层区分：

- `measured`
- `analytical_only`
- `supported_unmeasured`
- `unsupported`
- `unknown`

UI 可以将 unsupported/unknown 作为同一类不可执行状态呈现，但原因必须保持不同。不存在的组合仍可见但置灰；只有 measured 或 analytical evidence 能显示数值。

实际 execution configuration 从所选组合及 run 派生。如果只有一种配置，页面只显示摘要；有多种真实配置时才提供 configuration 选择器。

Roofline scenario 是独立控件，允许选择 BF16、FP16、FP8、INT8、INT4 或完整量化方案。它始终显示 evidence label 和 runtime support 状态，不能被误解为实际执行选项。

### 6.3 Operator 与 group 详情

点击图节点打开右侧详情面板，主图保持位置。面板状态拥有可恢复的深链接，包含四个页签：

1. **计算**：输入/输出/参数 shape、公式、multiplicity 和动态可视化。
2. **Roofline**：ideal、implementation-modeled 和 measured 点及假设。
3. **Runtime realization**：独立、融合、拆分、消除、fallback 和 kernel mapping。
4. **Evidence**：run/capture、workload、设备状态、来源及缺失原因。

点击 fused group 时切到执行视角并反向高亮其中的逻辑 operator；点击 kernel 时反向高亮对应 group/operator。

## 7. Operator 动态可视化

动态图按 operator 类型复用，不为每个模型节点手写：

- GEMM/Linear：展示 `D = A * B + C`、矩阵 shape、tile 选择、乘加累积和读写。
- Attention：展示 `QK^T -> scale/mask -> softmax -> P*V`。
- Norm、activation、residual、concat 和 reshape：展示归约、逐元素或数据重排过程。
- Composite/fused group：展示逻辑子图和融合边界，不推测 opaque kernel 内部调度。
- 暂无专用 visualizer 的 operator：仍显示公式、shape、FLOPs、Bytes 和 roofline。

动画用于解释语义，不模拟实际 CUDA block、warp、tile 或 cache 行为。只有 profiler/code 能证明时，执行详情才展示实际 kernel tile、launch 或硬件映射。

## 8. 精度与量化双轨语义

### 8.1 实际执行配置

真实配置至少记录：

- weight、activation、accumulation、execution 和 output dtype；
- quantization scheme；
- weight-only、weight-and-activation 或 mixed precision；
- per-tensor/per-channel/per-group granularity 与 group size；
- scale/zero-point 的 dtype、数量和存储字节；
- pack/unpack、quant/dequant/requant 策略；
- 转换是否融合及其作用范围。

不能用 `FP8` 或 `INT8` 单个标签替代完整配置。Weight-only Q8 不自动使用 INT8 compute ceiling；mixed FP8/FP16 也不能按 uniform FP8 计算。

### 8.2 What-if roofline 情景

用户可以自由选择分析精度，但每个情景明确标记：

- runtime support 是否已证明；
- 使用哪个 compute ceiling 和 bandwidth ceiling；
- 是否包含 metadata、转换、中间 buffer 与 fusion；
- 哪些参数缺失；
- 结果属于 ideal、implementation-modeled 还是 measured。

缺少 scale、group size、转换代价或适用硬件峰值时，只展示仍可证明的理想上限和缺失项。

## 9. Execution 视图

### 9.1 Nsys 与 CPU/GPU 时间线

时间线按相对时间展示 inference CPU threads、CUDA API、NVTX、GPU kernels、memcpy/memset 和 streams。它计算：

- GPU active union；
- inference-thread active；
- CPU/GPU overlap；
- GPU launch gap；
- 同步等待；
- observation-to-action critical path。

“推理线程无事件”“CPU 核心整体空闲”和“CPU 正在等待 GPU”是不同状态。只有具备相应 OS runtime/per-core evidence 时才能声称整机 CPU idle。GPU 忙碌期间且不在关键 CPU 路径上的区间只标记为 potential CPU headroom；页面不自动推断 CPU 协同能获得收益。

### 9.2 Kernel 表

Kernel 表按稳定 signature 聚合，并保留 launch count、单次/累计耗时、shape/dtype、execution group、逻辑 operator 和 mapping evidence。可以展开一个代表 launch 查看 NCU 详情。无法映射的 kernel 保留 `opaque/unmapped`。

## 10. NCU 采集与指标规范

### 10.1 指标分层

每个 kernel 画像包含以下语义组；数据库同时保留 NCU 原始 metric 名称、单位、工具版本和 unavailable reason，以适应架构与版本差异。

| 语义组 | 核心内容 |
|---|---|
| 时间贡献 | NCU 单次 duration、Nsys launch count/累计时长、E2E 占比 |
| Launch/并行度 | grid/block、waves per SM、SM 工作分布、tail effect |
| 资源/Occupancy | theoretical/achieved occupancy、register/thread、shared memory/block、限制资源 |
| Compute | SM throughput、Tensor/FP/INT/LSU/SFU pipeline、IPC、SASS 指令类型 |
| Memory | DRAM 读写/带宽、L2/L1 流量与命中、sectors/request、shared bank conflict、local spill |
| Scheduler/Stall | active/eligible/issued warps、issue-slot、scoreboard、throttle、barrier、branch |
| Roofline | DRAM/L2/L1 arithmetic intensity、适用 dtype/Tensor roof、距 ceiling 的差值 |

Thor 等统一内存设备可以增加 C2C/system-memory 指标，但这些是设备条件字段，不要求所有 GPU 填写。

### 10.2 Long 与 short scoreboard

Scoreboard 只在 scheduler 不能持续 issue 时进入瓶颈判断：

- `long scoreboard` 通常表示等待 L1TEX 路径上的 global/local/texture/surface memory 依赖。它必须结合 L1/L2/DRAM、coalescing、spill、occupancy 和 eligible warps 判断。高带宽可能表示 bandwidth-bound；低带宽但高 long scoreboard 更可能表示 memory latency 或延迟隐藏不足。
- `short scoreboard` 通常表示等待 MIO 路径依赖，常见于 shared memory，也可能来自特殊数学指令或动态分支。它必须结合 shared-memory bank conflict、wavefront、MIO throughput 和 instruction mix 判断。

WarpStateStats 的 aggregate ratio/cycles 与 SourceCounters 的 PC/SASS sampling 分开保存。对短 kernel 使用 sampling 时必须显示 sample count；样本不足时不能产生确定分类。高 stall 指标本身不能推出 memory-bound 或 compute-bound。

### 10.3 简化采集流程

1. 先用 Nsys 按累计耗时识别主要 kernel signature。
2. 每种主要 shape/dtype 选择一个代表 launch，先采集本机 `basic` 等价信息：LaunchStats、Occupancy、SpeedOfLight 和 WorkloadDistribution。
3. 只按已观察到的症状增加一个窄范围采集：
   - memory：MemoryWorkloadAnalysis；
   - compute/tensor：ComputeWorkloadAnalysis；
   - compute 与 memory 都不高：SchedulerStats；
   - scheduler issue 不足：WarpStateStats；
   - 需要代码定位：SourceCounters 或 InstructionStats；
   - 聚合值掩盖阶段/tail 变化：定向 PM Sampling。
4. 不默认运行 `full` 或全量 roofline section set，也不对所有 launch 重复采集。

当前 Thor 环境中的 NCU 2025.3 `basic`、`detailed`、`full` 与 roofline set 只是采集配置参考，schema 不绑定某个工具版本。Section 和 metric 的实际可用性在目标设备上查询并记录。

### 10.4 测量质量

每条 NCU observation 还保存：

- replay mode 与 replay pass count；
- replay memory backup bytes；
- cache-control 与 clock-control；
- kernel launch ordinal/range；
- 指标是否跨 replay pass；
- profiler warning、sample count 和采集完整性。

NCU 可能 replay、序列化 kernel 或改变 cache/clock 条件。NCU duration 与 Nsys duration 分开保存；不能用被 profiler 包围的 host timer 代替 kernel duration，也不能把 NCU isolated duration 直接累加成 E2E。

## 11. 离线提取与隐私

```text
仓库外原始报告
  -> 只读 extractor
  -> .local/staging bundle
  -> schema + semantic + privacy validation
  -> reviewed promotion
  -> canonical data
  -> offline static site
```

Canonical timeline 只保存目标 observation-to-action range 及必要上下文，并使用相对时间。CPU lane 使用受控角色名，kernel 使用脱敏 signature/label。

不进入 Git 的信息包括：

- 原始 profiler 文件和完整 trace；
- 主机名、用户名、PID/TID、绝对时间；
- 本机路径、命令行和环境变量；
- 设备 UUID、序列号和资产信息；
- 模型权重与私有 runtime 源码；
- inference range 外的无关进程事件。

设备公开型号、公开软件版本、功耗模式、频率、温度和 throttle evidence 可以进入 canonical data。外部报告只记录公开来源明确声称的事实，并标记为 reported evidence。

## 12. 缺失与错误处理

- Shape 无法绑定：保留符号 shape，并列出缺少的 workload symbol。
- Runtime mapping 不完整：逻辑图继续可用，覆盖层标记 partial/unmapped。
- NCU metric 不支持或未采集：分别标记 unsupported/not_collected，不写零。
- Hardware ceiling 或量化开销不完整：只显示可证明的 roofline 和缺失假设。
- Nsys/NCU duration 不一致：分别展示并说明测量语义。
- Operating point 未知或发生 throttle：保留数据，但阻止不满足不变量的 ratio。
- Fused group 无逐 operator timing：只显示 group timing。
- Analytical scenario 与 runtime configuration 不匹配：只显示 hypothetical 结果。

## 13. 现有数据迁移

迁移采用增量方式：

1. 现有高层 `architectures` 暂时作为 legacy summary 保留。
2. 现有 `operators` 与 `rooflines` 继续标记为 analytical component aggregates，不自动拆分或关联到新逻辑 operator。
3. 新增 operator definition、block template、model graph、runtime realization、execution group、kernel mapping 和 profiler observation 数据集。
4. Pi0/Pi0.5 结构化图完成后，模型工作台成为对应模型的主视图；旧 performance/operator/roofline 页面保留为二级证据入口。
5. 未采集到的 FlashRT 或其他 runtime kernel evidence 保持为空，不根据论文表格、kernel 名称或 VLA-Perf aggregate 补齐。

## 14. 最小验证范围

只保留三类必要验证：

1. **契约与语义验证**：ID 引用、tensor 端口、shape expression、evidence/missing 状态。
2. **一个代表 workload**：绑定一个 Pi0 配置，核对关键 shape、重复次数和 FLOP/Bytes。
3. **一个静态页面 smoke path**：离线构建后可打开模型图、一个逻辑 operator 和一个 fused group 详情。

失效的旧列表测试应被替换，而不是叠加兼容测试。首期不增加 cross-product、random、fuzz、stress、自动 inference、自动 Nsys/NCU 或大规模浏览器 E2E 测试。

## 15. 完成标准

首期实现满足以下条件时完成：

1. 首页以模型为入口，Pi0/Pi0.5 均有可折叠逻辑 DAG。
2. 原子 operator 显示结构化 symbolic/concrete shape、公式、multiplicity、FLOPs 和 Bytes。
3. 1/2/3 views 与 prompt length 等 workload binding 能更新 shape 和分析值。
4. GEMM、Attention 及基础 element/reduction operator 有对应详情可视化或明确 fallback。
5. 至少一个 runtime realization 能展示 fusion/decomposition 语义；没有 kernel evidence 时不伪造 mapping。
6. Runtime × hardware 组合展示明确 evidence 状态和实际 execution configuration。
7. 任意分析精度/量化情景与真实执行配置清楚分离。
8. 有数据时可从逻辑 operator 导航到 execution group、kernel、NCU 和 Nsys timeline，并可反向高亮。
9. 原始 profiler、本机标识和路径不进入 canonical data 或生成站点。
10. 静态站点在无网络条件下通过 `file://` 使用。

## 16. 参考依据

- Realtime-VLA 的 Pi0 计算流图与 grouped GEMM/roofline 表用于视觉层级参考，不作为 Pi0.5 或某 runtime 执行图的替代证据：<https://arxiv.org/pdf/2510.26742#page=4>
- Realtime-VLA 官方代码仓库中的原始计算流图：<https://github.com/dexmal/realtime-vla>
- NVIDIA Nsight Compute metric collection、replay 与 overhead：<https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html#metric-collection>
- NVIDIA Nsight Compute sections 与指标解释：<https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html#sets-and-sections>
- NVIDIA Nsight Compute roofline：<https://docs.nvidia.com/nsight-compute/ProfilingGuide/index.html#roofline-charts>
