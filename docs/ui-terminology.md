# 界面术语

三个模型的理论 DAG、执行 DAG 和算子详情共用
[`terminology.ts`](../src/features/model-graph/presentation/terminology.ts)。
模型配置补充结构差异和参数，公共名词从这份词表读取。
`ModelDisplay` 将外源记录中的不同叫法映射到同一显示名称。

| 对象 | 显示名称 | 使用范围 |
| --- | --- | --- |
| 图像输入 | 图像 | 分辨率在输入 shape 和计算详情中列出 |
| 多模态前缀阶段 | 前缀编码器 | 对应三个模型的 prefix encoder / VLM 阶段 |
| 文本输入 | prompt | token 数在场景参数中列出 |
| 数值状态 | state | 投影后的表示写 state token |
| Pi0.5 的文本与状态输入 | prompt + state | 保留 state 编入 prompt token 的结构差异 |
| 动作序列元素 | 动作 token | 场景参数写“动作 token 数” |
| 注意力 | Attention、Self-attention、Cross-attention | DAG 标签、详情标题与说明使用相同拼写 |
| 门控与仿射参数 | gate、bias、scale、shift | bias 表示层的偏置；shift 表示条件化平移参数 |
| 图像分块与嵌入 | patch、embedding | 保留 RMSNorm、LayerNorm、RoPE、GELU、SiLU 等算子名称 |
| 张量布局操作 | reshape、concat、slice | 中文说明可以使用“拼接”“按行选择”等动词 |

界面操作仍用中文，例如“缩放模型图”；内存地址描述仍可用“偏移”。
英文术语与中文之间留一个空格，标点前不加空格。公式、逻辑引用和外源原文保持原有标识。

SmolVLA 的重复单元写为 **Self-attention → Cross-attention ×8**：
每组依次执行两个 expert 层，每层各有自己的 MLP，每步共 16 层。
K/V 按对应层索引显示。新模型的重复次数从模型配置读取。

新增模型或推理栈时，先复用词表，再增加必要的结构说明。
审阅时切换三个模型，核对输入、相同算子、场景参数和详情标题；
英文名称变长后检查节点边界和箭头附近的文字。
