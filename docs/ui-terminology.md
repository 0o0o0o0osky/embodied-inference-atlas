# 界面术语

三个模型的理论 DAG、执行 DAG 和算子详情共用
[`terminology.ts`](../src/features/model-graph/presentation/terminology.ts)。
模型配置补充结构差异和参数，公共名词从这份词表读取。
[`operatorCatalog.ts`](../src/features/model-graph/presentation/operatorCatalog.ts) 集中算子短名、完整标题和别名；`ModelDisplay` 只保留模型描述。

| 对象 | 显示名称 | 使用范围 |
| --- | --- | --- |
| 图像输入 | 图像 | 分辨率在输入 shape 和计算详情中列出 |
| 多模态前缀阶段 | 前缀编码器 | 对应三个模型的 prefix encoder / VLM 阶段 |
| 文本输入 | Prompt | token 数在场景参数中列出 |
| 数值状态 | State | 投影后的表示写 State token |
| Pi0.5 的文本与状态输入 | Prompt + State | 保留 state 编入 prompt token 的结构差异 |
| 动作序列元素 | 动作 token | 场景参数写“动作 token 数” |
| 注意力 | Attention、Self-attention、Cross-attention | DAG 标签、详情标题与说明使用相同拼写 |
| 计算子层分区 | Attention、MLP | 区域标题同样读取共享词表，不追加“子层”或另用“前馈子层” |
| 投影 | Up、Down、Proj | DAG 的短标签；条件、输入、输出等限定按需保留 |
| 门控与仿射参数 | Gate、Bias、Scale、Shift | bias 表示层的偏置；shift 表示条件化平移参数 |
| 图像分块与嵌入 | Patch、Embedding | 保留 RMSNorm、LayerNorm、RoPE、GELU、SiLU 等算子名称 |
| 张量布局操作 | Reshape、Concat、Slice | 中文说明可以使用“拼接”“按行选择”等动词 |

界面操作仍用中文，例如“缩放模型图”；内存地址描述仍可用“偏移”。
英文术语与中文之间留一个空格，标点前不加空格。公式、逻辑引用和外源原文保持原有标识。

DAG 使用首字母大写的短标签，由共享 `dagLabel` 处理；公式中的变量保持原样。
详情使用完整功能名称。详情标题由
[`operatorCatalog.ts`](../src/features/model-graph/presentation/operatorCatalog.ts)
按算子角色统一生成，例如 Q projection、MLP Up projection、Attention RMSNorm。
时间条件投影与 action/time 混合投影分别命名；Attention 的 mask 语义继续保留。
MLP 输入与输出投影的 DAG 短标签统一为输入 Proj、输出 Proj。
SmolVLA 的 Cross-attention K/V 线性投影在 DAG 中写作 K Proj、V Proj，详情使用
Cross-attention K projection、Cross-attention V projection。公式中的 `gate` 等变量保留原始定义。

Slice 的概览、计算过程和图中提示共用
[`slicePresentation.ts`](../src/features/model-graph/presentation/slicePresentation.ts)。
显示当前轴与范围，例如 `shift = X[:, 1024:2048]`、`Y = X[:, :, 0:6]`。
示例矩阵沿对应方向选行或选列，完整保留的输出显示恒等选择。
选择规则在 canonical 算子 `slice` 声明中提供 `axis/start/stop/step` 表达式，
通过当前 `scopeBindings` 求值；`drop_axis` 指定取单个索引后去轴。前端统一校验
结果形状，不按模型或节点 ID 猜范围。新模型只添加声明；范围缺失或不一致时显示待补充状态。

SmolVLA 的重复单元写为 **Self-attention → Cross-attention ×8**：
每组依次执行两个 expert 层，每层各有自己的 MLP，每步共 16 层。
K/V 按对应层索引显示。新模型的重复次数从模型配置读取。

新增模型或推理栈时，先复用词表，再增加必要的结构说明。
审阅时切换三个模型，核对输入、相同算子、场景参数和详情标题；
英文名称变长后检查节点边界和箭头附近的文字。
