"""Stage compact, source-audited Pi0 process descriptions; never profiler timing."""
from __future__ import annotations
import argparse
from copy import deepcopy
from pathlib import Path
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.runtime_realization import runtime_realization_problems


def node(identifier, label, lane, step, operation, reads, writes, reuse, evidence):
    return dict(node_id=identifier, label=label, lane=lane, step=step, operation=operation,
                reads=reads, writes=writes, reuse=reuse, evidence_ids=evidence)


def evidence(record, identifier, locator):
    item = dict(evidence_id=identifier, kind='source_code', source_id='source-'+record['runtime_id'],
                revision=record['runtime_revision'], locator=locator, run_ids=[], observation_ids=[])
    if not any(e['evidence_id'] == identifier for e in record['evidence']):
        record['evidence'].append(item)
    return identifier


def describe(record):
    record = deepcopy(record)
    steps = record['workload_applicability']['denoise_steps']
    if record['runtime_id'] == 'vla-cpp':
        predict = next(e['evidence_id'] for e in record['evidence'] if e.get('locator') == 'src/models/pi0.cpp#Pi0ModelArch::predict')
        prep = evidence(record, 'vlacpp-pi0-preprocess-source', 'src/modules/preprocess.h#preprocess_image_chw')
        nodes = [
            node('input', '图像 / token / 状态', 'cpu', 0, '调用方提供已满足尺寸的图像、语言 token、状态和可选噪声。预测接口不执行分词。', ['本次观测', '语言 token'], ['预测输入'], None, [predict]),
            node('prepare', '归一化与布局转换', 'cpu', 1, '图像尺寸校验；U8 转浮点、归一化至 [-1,1]，HWC 转 CHW；上传像素。此处不裁剪或缩放。', ['图像像素'], ['CHW 图像'], None, [prep, predict]),
            node('vision', '视觉编码与投影', 'gpu', 2, '逐视角执行 patch 卷积、SigLIP、末端归一化及多模态投影。', ['CHW 图像', '常驻视觉权重'], ['视觉 embedding'], '权重常驻；每次观测重新计算视觉结果。', [predict]),
            node('main-input', '视觉回读与主图准备', 'cpu', 3, '视觉 embedding 回读主机；读取语言 embedding 行，准备状态归一化、位置、mask、初始噪声及每步时间嵌入，再上传主图输入。', ['视觉 embedding', '语言 token', '状态', '初始噪声或随机源'], ['多模态 embedding', '状态 / 位置 / mask', '时间嵌入 / 噪声'], '主图计划按图像 token 数、语言 token 数和步数复用；时间嵌入每次预测重新计算与上传。', [predict]),
            node('prefix', 'VLM / Prefix 编码', 'gpu', 4, '拼接图像与语言 embedding，执行前缀 Transformer，生成每层 K/V。', ['多模态 embedding', '位置', '常驻前缀权重'], ['Prefix K/V'], 'K/V 在本次观测的全部去噪步骤中复用；下一观测重新计算。', [predict]),
            node('action', '动作专家与更新', 'gpu', 5, '每步构造状态与动作/时间输入，执行动作专家和输出投影，再以 FP32 更新动作噪声。状态投影在每步执行，不标为跨步缓存。', ['Prefix K/V', '状态 / 位置 / mask', '时间嵌入 / 噪声', '常驻动作权重'], ['动作块'], '复用本次 Prefix K/V；动作值逐步更新，执行计划可跨兼容观测复用。', [predict]),
            node('output', '下载与反归一化', 'cpu', 6, '下载动作块，在主机反归一化有效动作维度并清零填充维度。', ['动作块'], ['动作输出'], None, [predict]),
        ]
        groups = [dict(label='视觉执行图（后端管理）', kind='backend_graph', node_ids=['vision']),
                  dict(label='主执行图（后端管理）', kind='backend_graph', node_ids=['prefix', 'action'])]
        notes = ['横向位置仅表示处理顺序，不表示耗时或时间占比。',
                 '模型初始化时上传权重并保留缓冲区；逐次预测仍会读取这些权重，不等于免除访存。',
                 '视觉图与主图分开；CPU 准备、上传和回读不属于主图。后端执行图边界不等同于逐节点 CUDA 捕获边界。',
                 '图像须预先满足模型尺寸；裁剪、缩放与文本分词属于调用方，本次固定案例直接提供 token IDs。',
                 'BF16 路径已观测后端 CUDA Graph 使用；Q8 路径的实际 CUDA Graph 启用状态未确认。']
    elif record['runtime_id'] == 'flashrt':
        infer = evidence(record, 'flashrt-pi0-infer-source', 'flash_rt/frontends/torch/pi0_thor.py#infer')
        jax = evidence(record, 'flashrt-pi0-jax-infer-source', 'flash_rt/frontends/jax/pi0_thor.py#infer')
        setup = evidence(record, 'flashrt-pi0-prompt-source', 'flash_rt/frontends/torch/pi0_thor.py#set_prompt')
        visual = evidence(record, 'flashrt-pi0-vision-capture-source', 'flash_rt/frontends/torch/pi0_thor.py#_capture_siglip_graph')
        main = 'flashrt-pi0-torch-capture-source'
        decoder = 'flashrt-pi0-decoder-source'
        nodes = [
            node('input', '图像 / 状态 / 提示', 'cpu', 0, '本次提供已满足尺寸的图像和状态；语言 embedding 在设置提示时准备。', ['本次观测', '已设置提示'], ['预测输入'], '提示不变时复用语言 embedding；这不表示复用整段多模态 Prefix K/V。', [infer, setup]),
            node('prepare', '输入整理与上传', 'cpu', 1, 'NumPy 非 FP16 图像在 CPU 归一化并转 FP16；FP16 图像直接使用。Torch Tensor 输入仅在原设备转 FP16 后回读 CPU，不在此分支归一化，调用方须满足值域。主机堆叠图像并上传；状态按来源复制或置零。此接口无裁剪、缩放。', ['图像像素', '状态'], ['GPU 图像 / 状态'], None, [infer, jax]),
            node('vision', '视觉编码与投影', 'gpu', 2, 'patch embedding、SigLIP、末端归一化与投影，并拼入预备好的语言 embedding。', ['GPU 图像', '常驻视觉权重', '语言 embedding'], ['GPU 多模态 prefix'], '视觉结果留在 GPU；每次观测重新计算。', [visual]),
            node('submit', '提交主图', 'cpu', 3, '顺序提交主图。视觉 embedding 不回读主机。初始噪声在主图外准备：Torch 使用 GPU normal_，JAX 使用 CPU 随机数并上传。', [], ['主图提交'], '复用图提交计划；首次推理的校准与重新捕图属于初始化路径。', [infer, jax]),
            node('prefix', '状态投影与 VLM', 'gpu', 4, '清零 K/V 缓冲区，投影当前状态一次，运行 prefix encoder 生成本次 K/V。', ['GPU 多模态 prefix', 'GPU 状态', '常驻前缀权重'], ['Prefix K/V', '状态 token'], '状态 token 与 Prefix K/V 在本次去噪步骤间复用；下一观测重新生成。', [main]),
            node('action', '动作专家与更新', 'gpu', 5, '各步读取状态 token、Prefix K/V 和预计算时间投影，执行动作专家及融合的动作更新。', ['Prefix K/V', '状态 token', '预计算时间投影', '初始动作噪声', '常驻动作权重'], ['动作块'], '固定时间步的投影在设置提示阶段预计算；依赖时间计划、权重和形状。', [decoder, setup]),
            node('output', '同步 / 下载 / 后处理', 'cpu', 6, '同步 GPU 后下载动作，主机反归一化并选择公开动作维度。', ['动作块'], ['动作输出'], None, [infer, jax]),
        ]
        groups = [dict(label='视觉 CUDA Graph', kind='cuda_graph', node_ids=['vision']),
                  dict(label='Prefix + 动作 CUDA Graph', kind='cuda_graph', node_ids=['prefix', 'action'])]
        notes = ['横向位置仅表示处理顺序，不表示耗时或时间占比；CPU 提交箭头表示源码调用顺序，不表示 GPU 完成触发 CPU 提交。',
                 '初始化上传权重；设置或更新提示时准备语言 embedding、RoPE、全部时间投影、缓冲区及 CUDA Graph。',
                 'Torch 时间投影在 GPU 预计算；JAX 使用 NumPy 在 CPU 计算后上传。前端差异不合并成同一次实测流程。',
                 '首次真实输入可能触发校准与重新捕图；稳定推理图只表达后续路径。',
                 'Prompt embedding、时间投影和执行计划可跨兼容观测复用；多模态 Prefix K/V 每次观测清零重算。',
                 '图像须满足输入尺寸；此 infer 不包含裁剪或缩放。内部 Torch 延时记录不含下载后处理，不替代外部端到端计时。']
    else:
        raise ValueError('Only the source-audited Pi0 implementations are supported')
    def edge(source, target, kind, label):
        return {'from':source, 'to':target, 'kind':kind, 'label':label}
    if record['runtime_id'] == 'vla-cpp':
        edges = [edge('input','prepare','data','原始图像'),
                 edge('prepare','vision','data','像素上传'),
                 edge('vision','main-input','data','视觉 embedding 回读'),
                 edge('main-input','prefix','data','多模态输入上传'),
                 edge('prefix','action','data','逐层 K/V'),
                 edge('action','output','data','动作下载')]
    else:
        edges = [edge('input','prepare','data','原始输入'),
                 edge('prepare','vision','data','图像上传'),
                 edge('prepare','vision','control','提交视觉图'),
                 edge('prepare','submit','control','CPU 顺次提交'),
                 edge('submit','prefix','control','提交主图'),
                 edge('vision','prefix','data','GPU 多模态 embedding'),
                 edge('prefix','action','data','逐层 K/V 与状态 token'),
                 edge('action','output','data','动作下载')]
    edges.append(edge('prefix','action','reuse','同观测 K/V 复用'))
    groups.append(dict(label=f'{steps} 步去噪', kind='repeat', node_ids=['action']))
    record['system_flow'] = dict(semantics='qualitative_order',nodes=nodes,edges=edges,groups=groups,notes=notes)
    return record


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('.local/staging/pi0-system-flow.json'))
    args=parser.parse_args(argv)
    root=Path.cwd()
    if not args.output.resolve().is_relative_to((root/'.local/staging').resolve()):
        raise ValueError('output must remain in local staging')
    graph=load_json(root/'data/model_graphs/pi0.json')['records'][0]
    records=[describe(r) for r in load_json(root/'data/runtime_realizations/pi0.json')['records']]
    for record in records:
        problems=runtime_realization_problems(record,graph)
        if problems: raise ValueError(problems)
    write_json_atomic(args.output,dict(bundle_version='1.0.0',source_label='pi0-source-system-flow',datasets={'runtime_realizations':records}))
    print(f'Staged {len(records)} source-backed qualitative system flows: {args.output}')
    return 0

if __name__=='__main__': raise SystemExit(main())
