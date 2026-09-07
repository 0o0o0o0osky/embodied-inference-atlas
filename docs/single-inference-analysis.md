# 单次推理分析：从证据到可交互页面

先回答一个具体问题：固定输入下，一次推理做了什么，主要时间花在哪里，哪些
计算与提交已经复用？先贯通一个实例，再扩输入或实现。页面保留总体中位数、
一个稳定代表 trace 和必要 Kernel 指标；原始报告、其余样本及审阅日志保存在 `.local/`。
时间与精度定义见 [methodology.md](methodology.md)，现成渲染入口见
[analysis-components.md](analysis-components.md)。

新增模型、推理栈或硬件先对照 [页面接入契约](analysis-components.md#新页面接入契约)：
填 catalog 身份、当前模型的输入与设备基础规格，绑定共享壳、上下文和导航。
系统、DAG/热点、优化、Roofline/计数器能力缺失时保留明确缺省状态，不为补齐页面
伪造 run、规格或图表。agent 最小交付是已确认事实、来源与适用范围的结构化描述；
标签、空态和机制布局交给共享 presentation。具体矩阵和状态定义只维护在组件目录。

## 1. 检查环境、输入与已有证据

**问题**：现有数据能回答什么，缺少的证据是否可以取得？

记录模型/权重、实现版本、设备、实际精度、输入内容配方与 shape、初始化和输出
边界。图像、token、状态、初始噪声都属于输入；只固定 shape 不等于固定内容。
将具体样本与路径留本机，发布稳定的 input-case 标识和脱敏配方。有限输出检查
只证明数值有限；比较任务质量需要另行验证。

先查本机报告、源码、采集脚本和环境，查询安装版本与支持能力：

```bash
python --version
node --version
nsys --version
nsys status --environment
nsys profile --help
nsys export --help
ncu --version
ncu --help
ncu --list-sections
ncu --query-metrics
```

记录 CPU 调度、调用栈、OS runtime、CUDA 关联事件和 GPU 计数器能否采到。
无计数器权限时继续用有效的 E2E/Nsys；NCU 保留缺失原因，不填零，不借其他设备
的计数器冒充。不要为了填满页面修改库版本、推理行为、功耗或锁频。

## 2. 建立有界批次，选择一个真实实例

**最小方法**：项目默认每个独立批次完整预热 5 次、测量 10 次。计时包住声明的
请求边界，异步 GPU 工作在结束前完成；同步应满足正确计时，避免为拆阶段加入
额外同步。准备固定输入、恢复随机状态的位置也要写进边界契约。

总体指标取该批次中位数。用全部 10 个值计算样本标准差/均值，即 CV；本项目
稳定阈值为 5%。不稳定最多重测一批，两批独立保存，不删除首样本或混批过关。

节点 trace 另成批次。若启用 profiler 产生启动瞬态，可在同样 5 次预热前开启
采集，仅为 10 次测量窗加标记。工具的代表选择还检查已分类主要 GEMM 与非 GEMM
类别的调用数一致、累计时长 CV，并要求代表的墙钟与这些热点接近各自中位数。
当前规则位于 `tools/lib/representative_data.py::_batch_summary`：最多前两个 GEMM
和一个已分类非 GEMM，偏差均不超过 5%，再选墙钟最靠近中位数的真实窗口。
这不是“全部 Kernel 都稳定”的证明；未分类热点仍保留耗时并由分析者检查。

**输出解释**：E2E 中位数来自无 profiler 批次；Kernel 累计、调用次数和选中调用
来自同一个代表 trace。单次详情默认选择该类别中接近中位数的实际调用，而不是
合成一条平均事件。未通过检查就保留未验证状态。

## 3. 用 Nsys 看 CPU/GPU 执行

**问题**：CPU 准备、提交、等待、拷贝和 GPU 工作如何分布？

下面是命令骨架。`ADAPTER` 是本机审阅过的可执行 harness，`ADAPTER_ARGS` 和
`CPU_OPTIONS` 是 Bash 数组，按本机帮助和采集问题填写；不在公共教程中固定某个栈。

```bash
nsys profile --trace=cuda,nvtx,osrt --cuda-graph-trace=node \
  --capture-range=cudaProfilerApi "${CPU_OPTIONS[@]}" \
  --output "$TRACE_PREFIX" "$ADAPTER" "${ADAPTER_ARGS[@]}"
nsys export --type sqlite --output "$TRACE_SQLITE" "$TRACE_REPORT"
```

需要逐 Kernel 时选 node；graph 只记录整图范围，可用于较粗问题。函数采样由
本机支持的 `--sample` 等选项配置，调度能力以环境检查和实际导出表为准。
Harness 应提供独立样本范围及 profiler start/stop，保留原生实现路径。

**解释与限制**：

- 请求墙钟是整个窗口；CPU core-time 是线程运行区间累计；GPU 活动是已记录
  Kernel/拷贝的区间并集；API 和系统调用是主机调用持续时间，可含等待。
  这些可重叠，仅互斥完整阶段才能组成请求延时堆叠。
- 用真实 TID、线程名及调用关联确认职责，再脱敏；同线程的调度、采样和 API
  可为不同轨道。排除采集器线程，保留后台线程未知职责；轨道序号不代表线程号。
- 长 poll 表示等待 I/O 事件，具体对象需描述符或栈证据；裁剪到窗口的片段仅为
  该窗口覆盖。函数样本比例不是精确函数耗时；只有 other/unresolved 时不画 100% 榜。
- 保存事件身份、区间、覆盖率及明确依赖。时间重叠本身不能生成 launch 因果箭头。

## 4. 对必要热点采集独立 NCU

**问题**：选中 Kernel 的计算、访存和执行资源能否解释其耗时？

先从代表 trace 选主要热点，核查已有匹配报告。按本机 sections/metrics 选择
计算、内存域、launch 与 occupancy 的最小集合。以下策略沿用当前固定场景导入
契约；其他策略应在 adapter 中显式记录后再导入：

```bash
ncu --config-file off --replay-mode kernel --clock-control none --cache-control none \
  --kernel-name-base demangled --kernel-name "$EXACT_KERNEL" --launch-count 1 \
  "${COUNTER_OPTIONS[@]}" --export "$COUNTER_PREFIX" \
  "$ADAPTER" "${REPLAY_ARGS[@]}" > "$COUNTER_LOG" 2>&1
ncu --import "$COUNTER_REPORT" --csv --page raw > "$COUNTER_CSV"
```

默认只补一个能回答当前问题的 launch；同符号有多种工作量时，还要限定并核实
具体调用顺序。保存回放策略、缓存/时钟条件、pass 数与原始 counter 名和单位。
NCU 的多个 pass 是为一次选中 launch 收集不同计数器；回放耗时属于 profiler
采集，不是无 profiler 请求时间，也不是各 pass 的总时间。

关联检查覆盖输入配方、实现、shape、输入/累加/输出精度与完整 launch 配置。
同名同 grid 不证明矩阵维度。只有源码与固定输入顺序都核对时才保存次序关联，
并保留未取得独立 work-ID 的限制。低 occupancy 或单个 pipe 指标不足以独立
断言瓶颈；真实零值与缺失是不同状态。

## 5. 解析、脱敏、校验与留存

**工具入口**：先运行帮助，再按 adapter 契约传入本机文件。

```bash
python -m extractors.fixed_case --help
python -m extractors.fixed_case_ncu --help
python -m tools.promote --help
python -m tools.archive_analysis --help
python -m tools.build --help
python -m tools.validate --help
```

`fixed_case` 是现有固定场景 adapter，并非任意模型的零配置接口：当前 marker
命名和 ID namespace 仍绑定既有模型。新增模型先补审阅过的 adapter，复用
`extractors.nsys`、`extractors.ncu` 和 `_batch_summary`，不要套用旧形状/精度。
其结果 JSON 需要 `runtime, warmup, profiled, samples_ms, finite, output_shape,
input_case_id, batch_id, input_recipe`；run-template 另存完整工作负载、权重、
实际精度和运行条件。NVTX 名称、profile API 边界与 parser 必须一致。

```bash
python -m extractors.fixed_case --results "$RESULTS" --run-template "$RUN_TEMPLATE" \
  --sqlite "$TRACE_SQLITE" --signature-rules "$SIGNATURE_RULES" \
  --local-evidence-dir "$LOCAL_EVIDENCE" --output .local/staging/case.json
```

无 profiler 的 E2E 导入省略 sqlite、signature-rules 和 local-evidence-dir。
节点导入输出一个代表及紧凑稳定摘要；完整本地批次和原始符号 manifest 留本机。
精确符号加完整 launch 资源划分执行类别，未知形状也保留有效时间。

```bash
python -m extractors.fixed_case_ncu --case-bundle "$CASE_BUNDLE" \
  --manifest "$SIGNATURE_MANIFEST" --report "$COUNTER_REPORT" --log "$COUNTER_LOG" \
  --native-results "$NATIVE_RESULTS" --replay-results "$REPLAY_RESULTS" \
  --signature "$SIGNATURE_ID" --output .local/staging/replay.json
python -m tools.promote .local/staging/case.json
python -m tools.promote .local/staging/case.json --apply
python -m tools.validate --all
python -m tools.archive_analysis
```

NCU adapter 还要求两份结果的 `views, prompt, chunk, denoise, input_hashes` 等输入字段一致；数据中不导出原始符号、机器路径和敏感输入。
候选经过 schema、引用、语义及脱敏检查后才 promote。重叠/采样单位、独立采集
身份及来源需保留。现有 profiler ID 是 append-only：真实解析纠错使用有备份、
候选完整校验的显式维护，不伪造一次新采集，也不放宽日常导入保护。
归档先 dry-run 检查引用闭包，再用 `tools.archive_analysis --apply` 保留必要记录。

## 6. 绑定 DAG、计算与 Roofline

**最小方法**：agent 阅读对应 revision 的实现，确认逻辑算子到执行组再到 launch
的证据。保留融合、量化和共享 Kernel 的多对多关系；没有精确来源时不按名称或
次数分摊耗时。层号可以来自显式 marker 或源码顺序关联，两者分别标注。

为选中对象记录 shape、实际精度和计算公式；GEMM 主乘加常用 `2MNK`，其他
操作与融合边界逐项确认。Kernel 边界字节按输入/权重读、输出写等假设计算，
显式说明转换和 epilogue 是否建模；这些估算不是 DRAM 实测。NCU 内存域计数器
留在自己的采集，不能配 Nsys 时间冒充实测带宽。

Roofline 使用同一对象、工作量与强度。设备峰值、带宽、频率条件分别解析；
条件不足时展示参考曲线，canonical matched efficiency 保持缺失。参考达成比
的分母是该算术强度下曲线上的理论点，不是硬件峰值；局部差距不等于总加速比。
保存场景、公式与少量默认回归点，其余精度按需 materialize。

## 7. 渲染与 agent 分析分工

| 确定性工具负责 | agent authoring 负责 |
| --- | --- |
| 单位转换、区间并集、统计和代表选择 | 检查输入边界、实现行为与证据完整性 |
| 已确认公式、Roofline 场景、共享布局与选择 | 确认 shape/精度/融合/复用语义和多对多关联 |
| 已审机制配置的相同图形表达 | 新机制配置、瓶颈解释及需要何种证据验证 |

Python 管解析/验证/构建；Node 和 TypeScript 管类型与前端；React 组件承载共享
选择，SVG 画 DAG/机制/图表，Vite 提供本机开发服务。配置传入模型、输入、设备、
操作与生命周期，通用组件不写死某一模型或设备。相同实现换设备可沿用已证机制，
但重新核查能力、实际路径和硬件上限。机制图只解释减少哪种重复工作，不生成收益。

按问题串起比较→系统→DAG/热点→计算/资源/Roofline；CPU 未映射算子的工作仍可
在时间线定位。页面显示必要定义与实际结论，长来源审阅、内部 ID 和重复免责声明
不成为主内容。版本需要时集中显示一次。

## 8. 浏览器、离线与体积验收

```bash
npm run typecheck
python -m tools.build --check
npm run dev -- --port 4186
# 另一个终端：URL 应包含本次选中对象的实际路由
node tools/render_review.mjs --url "$REVIEW_URL" --output .local/review \
  --viewport 1440x1000 --selector "$REVIEW_SELECTOR"
```

`tools/render_review.mjs --help` 查看参数；selector 可省略，browser 可指定已有
Chromium，`--playwright-module` 可指定已有 Playwright 模块。Playwright 驱动本机浏览器，不自动下载浏览器。检查截图和实际点击、
返回、滚动/缩放；改布局才补一个窄屏，修发现的问题后复查相关路径。

Perfetto 使用固定版本的本地资产，经本机 HTTP 和就绪握手载入脱敏 trace。
数据/资产变更时检查断网的新浏览器环境冷加载、切换/定位窗口及远端请求记录，
不依赖旧缓存或 file://。记录首屏 payload 与构建体积，检查重复 trace、理论
快照和无关资产。`tools.build --check` 不替换 site；发布本机页面使用
`python -m tools.build`。截图、日志和试验输出仍留 `.local/`。

## 9. 扩展与停点

先交付一个可解释的单实例：总体中位数、代表 trace、必要 CPU/GPU 证据、至少
一个有依据的热点详情与浏览器核验。缺失计数器不会阻塞其他已具备的分析。
再按新问题改变一个输入维度，各 case 独立检查支持范围与稳定性；最后比较多个
栈，展示真实权重、输入、精度与计时边界。不同 chunk 或内容不能作为同一工作量
直接排名；跨栈只作条件清楚的比较，不搬用另一栈的 trace/指标。

问题已能回答就停止采样。交付简短结论、关键证据和当前限制，以及可复现的本机
解析/渲染命令；新增文件只服务这条工作流。
