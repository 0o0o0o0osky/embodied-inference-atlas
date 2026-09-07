import type { RuntimeRealizationRecord, RuntimeReuseDescriptor } from '../domain/types';

// Display-only translations of audited evidence; unknown values retain their text.
const EVIDENCE_LABELS: Readonly<Record<string,string>> = {
  '再次调用 set_prompt 会重算时间表并替换预计算缓冲区；文本内容本身不是时间投影的值依赖':'重新设置提示词时，会重新准备时间表和缓冲区',
  '拓扑、形状或缓冲区地址改变，或模型实例释放时旧计划不再适用':'计算流程、输入尺寸或缓冲区地址改变时，需要重新捕获执行图',
  'image content':'图像内容', 'prompt tokens':'提示词 token', 'positions':'位置编码输入', 'model weights':'模型权重',
  'new observation executes prefix graph again':'新观测重新执行 Prefix 计算',
  'prefix inputs or model weights change':'Prefix 输入或模型权重变化',
  'image token count':'图像 token 数', 'prompt token count':'提示词 token 数',
  'denoise step count':'去噪步数', 'backend graph topology':'后端执行图结构',
  'MainKey changes rebuild GGML graph':'图像 token 数、提示词 token 数或去噪步数变化时重建执行图',
  'backend graph update or model lifecycle ends':'后端执行图更新或模型对象生命周期结束',
  'timestep schedule':'时间步计划', 'embedding width':'嵌入维度', 'chunk length':'动作块长度',
  'sinusoidal embedding parameters':'正弦时间嵌入参数',
  'next predict recomputes and uploads all timestep embeddings':'下一次预测重新计算并上传全部时间步嵌入',
  'schedule or embedding shape changes':'时间步计划或嵌入形状变化',
};
export const readableEvidence = (value: string) => (EVIDENCE_LABELS[value] ?? value)
  .replace(/set_prompt\s*时/g, '设置提示词时').replace(/调用 set_prompt/g, '设置提示词')
  .replace(/set_prompt/g, '设置提示词').replace(/replay/g, '执行已捕获的图');

// Explain the recorded mechanism; isolated latency savings require measurements.
export function repeatedWork(item: RuntimeReuseDescriptor, realization: RuntimeRealizationRecord) {
  if (item.kind === 'execution_plan') return confirmedGraphReplay(realization)
    ? 'CPU 通过 Graph 提交一组 GPU 计算，减少逐个 Kernel 提交的开销。'
    : '沿用已构建的执行计划，减少重复建图。';
  if (item.kind === 'storage') return '后续计算继续使用已准备的存储空间。';
  if (item.producerRefs.some(ref => ref.startsWith('prefix-encoder/') && ref.endsWith('/key-projection')))
    return '去噪步骤直接读取当前观测的前缀 K/V，省去每步重新计算前缀。';
  if (item.producerRefs.some(ref => ref.endsWith('/time-embedding')))
    return '去噪步骤直接读取准备好的时间特征，省去循环内对应的生成计算。';
  return '后续使用时直接读取已有结果，省去有效范围内的重复计算。';
}

export interface TimePrecomputeConfig {
  preparationDevice: string;
  executionDevice: string;
  scheduleLabel: string;
  tableLabel: string;
  preparationScope: string;
  repeatScope: string;
  featureOperation: string;
  projectionOperation: string;
  actionOperation: string;
  outputOperations: readonly string[];
}

const FLASHRT_TIME = {
  preparationDevice: 'GPU', executionDevice: 'GPU',
  preparationScope: '设置提示词时准备；后续观测继续读取这张表。',
  repeatScope: '每次观测的每个去噪步骤',
  featureOperation: 'sin / cos', projectionOperation: '时间投影 + 偏置',
  actionOperation: '动作分支投影', outputOperations: ['相加', 'SiLU', '输出投影'],
} as const;

export const confirmedGraphReplay = (record: RuntimeRealizationRecord) =>
  record.launch.cudaGraphState === 'present' && record.launch.submissionMode === 'cuda_graph_replay';

export function resolveReuseMechanisms(record: RuntimeRealizationRecord) {
  const items = (record.reuse ?? []).filter(item => !(record.modelId === 'pi0' && item.lifetime === 'observation'
    && item.producerRefs.some(ref => ref.startsWith('prefix-encoder/') && ref.endsWith('/key-projection'))));
  const graph = confirmedGraphReplay(record);
  const timeConfigurations = new Map<string, TimePrecomputeConfig>();
  // This split is audited for this implementation and revision only.
  if (record.modelId === 'pi0'
    && record.runtimeId === 'flashrt' && record.runtimeRevision === '054bea4d02ebc63f6a0c45991c6061b1e1caa46c') {
    const item = items.find(item => item.reuseId === 'flashrt-time-projection' && item.implementationStatus === 'implemented'
      && item.kind === 'computed_result' && item.lifetime === 'across_observations'
      && item.evidenceIds.some(id => record.evidence.some(evidence => evidence.evidenceId === id
        && evidence.kind === 'source_code' && evidence.sourceId === 'source-flashrt'
        && evidence.revision === record.runtimeRevision
        && evidence.locator === 'flash_rt/frontends/torch/pi0_thor.py#set_prompt')));
    const steps = record.workloadApplicability?.denoiseSteps;
    if (item && steps != null && steps > 0) timeConfigurations.set(item.reuseId, {
      ...FLASHRT_TIME, scheduleLabel: `固定 ${steps} 步时间表`, tableLabel: `存好 ${steps} 步结果`,
    });
  }
  const graphItems = new Set(items.filter(item => graph && item.kind === 'execution_plan' && item.implementationStatus === 'implemented').map(item => item.reuseId));
  return {items, timeConfigurations, graphItems, graphFallback: graph && !graphItems.size,
    precomputed: record.mappings.filter(mapping => mapping.reasonCode === 'precomputed_outside_prediction')};
}
