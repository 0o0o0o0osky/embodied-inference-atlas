import type { CanonicalRecord } from '../../../types/atlas';
import type { LogicalDag } from '../../model-graph/domain/types';
import { useModelText } from '../../model-graph/presentation/ModelDisplay';
import type { RuntimeRealizationRecord, RuntimeReuseDescriptor } from '../domain/types';
import { runtimeSourceReferences } from './RuntimeSourceReferences';
import './runtimeReuse.css';

const STATUS = {implemented:'已实现',not_implemented:'未实现',unknown:'待核对'};
const KIND = {computed_result:'计算结果复用',execution_plan:'执行计划复用',storage:'存储复用'};
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
const readableEvidence = (value: string) => (EVIDENCE_LABELS[value] ?? value)
  .replace(/set_prompt\s*时/g, '设置提示词时').replace(/调用 set_prompt/g, '设置提示词')
  .replace(/set_prompt/g, '设置提示词').replace(/replay/g, '执行已捕获的图');

// Explain the recorded mechanism; isolated latency savings require measurements.
function repeatedWork(item: RuntimeReuseDescriptor, realization: RuntimeRealizationRecord) {
  if (item.kind === 'execution_plan') return realization.launch.cudaGraphState === 'present' && (realization.launch.submissionMode === 'cuda_graph_replay' || /CUDA Graph/i.test(item.label))
    ? 'CPU 通过 Graph 提交一组 GPU 计算，减少逐个 Kernel 提交的开销。'
    : '沿用已构建的执行计划，减少重复建图。';
  if (item.kind === 'storage') return '后续计算继续使用已准备的存储空间。';
  if (item.producerRefs.some(ref => ref.startsWith('prefix-encoder/') && ref.endsWith('/key-projection')))
    return '去噪步骤直接读取当前观测的前缀 K/V，省去每步重新计算前缀。';
  if (item.producerRefs.some(ref => ref.endsWith('/time-embedding')))
    return '去噪步骤直接读取准备好的时间特征，省去循环内对应的生成计算。';
  return '后续使用时直接读取已有结果，省去有效范围内的重复计算。';
}

export function RuntimeReuseDiagram({dag, realization, sources}: {
  dag: LogicalDag; realization: RuntimeRealizationRecord; sources?: readonly CanonicalRecord[] | undefined;
}) {
  const t = useModelText();
  const reuse = realization.reuse ?? [];
  const isBaselinePrefix = (item: RuntimeReuseDescriptor) => realization.modelId === 'pi0' && item.lifetime === 'observation'
    && item.producerRefs.some(ref => ref.startsWith('prefix-encoder/') && ref.endsWith('/key-projection'));
  const baseline = reuse.filter(isBaselinePrefix);
  const optimizations = reuse.filter(item => !isBaselinePrefix(item));
  const precomputed = realization.mappings.filter(mapping => mapping.reasonCode === 'precomputed_outside_prediction');
  const graphReplay = !reuse.length && realization.launch.cudaGraphState === 'present' && realization.launch.submissionMode === 'cuda_graph_replay';
  const refs = (values: readonly string[]) => [...new Set(values.map(ref => {
    const label = dag.nodes.get(ref)?.label ?? realization.executionGroups?.find(group => group.executionGroupId === ref)?.label;
    return label ? t(label) : null;
  }).filter(Boolean))].join('、');
  const revision = /^[a-f0-9]{40}$/i.test(realization.runtimeRevision ?? '') ? realization.runtimeRevision : null;
  const repositories = revision ? runtimeSourceReferences(sources, realization.evidence
    .filter(item => item.kind === 'source_code' && item.revision === revision).map(item => item.sourceId))
    .filter(item => item.github) : [];
  const commitUrl = repositories.length === 1 ? `${repositories[0]!.url}/commit/${revision}` : null;

  const mechanismCard = (item: RuntimeReuseDescriptor) => {
    const producers = refs(item.producerRefs);
    const consumers = refs(item.consumerRefs);
    const costs = [
      item.storageBytes != null ? `存储：${item.storageBytes.toLocaleString()} B` : null,
      item.preparationNs != null ? `准备：${(item.preparationNs / 1e3).toLocaleString()} μs` : null,
      item.readNs != null ? `读取：${(item.readNs / 1e3).toLocaleString()} μs` : null,
    ].filter(Boolean);
    return <article className="runtime-optimization" key={item.reuseId} aria-label={item.label}>
      <header><h4>{item.label}</h4><span>{STATUS[item.implementationStatus]} · {KIND[item.kind]}</span>
        <strong className="optimization-scope">{item.lifetime === 'across_observations'
          ? item.kind === 'execution_plan' ? '后续观测沿用计划' : '后续观测继续使用'
          : item.lifetime === 'observation' ? '每次观测重新准备' : item.lifetime === 'solver_step' ? '单个求解步骤内使用' : '初始化时使用'}</strong></header>
      <dl className="optimization-explanation">
        <div><dt>当前做法</dt><dd>{readableEvidence(item.repeatScope)}</dd></div>
        <div className="optimization-effect"><dt>减少的重复工作</dt><dd>{repeatedWork(item, realization)}</dd></div>
        {item.invalidationConditions.length ? <div><dt>何时重做</dt><dd><ul>{item.invalidationConditions.map(condition => <li key={condition}>{readableEvidence(condition)}</li>)}</ul></dd></div> : null}
      </dl>
      {item.valueDependencies.length || producers || consumers || costs.length ? <details className="optimization-detail">
        <summary>依赖与相关计算</summary>
        <dl>
          {item.valueDependencies.length ? <div><dt>依赖</dt><dd>{item.valueDependencies.map(readableEvidence).join('；')}</dd></div> : null}
          {producers ? <div><dt>生成结果</dt><dd>{producers}</dd></div> : null}
          {consumers ? <div><dt>使用结果</dt><dd>{consumers}</dd></div> : null}
          {costs.length ? <div><dt>已记录成本</dt><dd>{costs.join('；')}</dd></div> : null}
        </dl>
      </details> : null}
    </article>;
  };
  return <section className="runtime-reuse-view" aria-label="执行优化">
    <h3>执行优化</h3>
    <p className="runtime-reuse-intro">当前栈采用的预计算和提交优化：减少哪些重复工作，哪些内容能留到下一次观测。</p>
    <div className="runtime-optimization-grid">
      {optimizations.map(mechanismCard)}
      {!reuse.length ? precomputed.map(mapping => <article className="runtime-optimization" key={mapping.mappingId}>
        <header><h4>{refs(mapping.logicalTargets.map(target => target.ref)) || '预计算'}</h4><span>已实现 · 计算结果预计算</span></header>
        <p>预测前生成结果，预测内直接使用。</p>
      </article>) : null}
      {graphReplay ? <article className="runtime-optimization"><header><h4>CUDA Graph 提交</h4><span>已实现 · 执行计划复用</span></header>
        <p>准备时捕获执行图，预测时由 CPU 提交整张图，GPU 执行其中的计算。</p>
      </article> : null}
    </div>
    {baseline.length ? <details className="optimization-baseline"><summary>基础计算机制：前缀 K/V 在本次观测内共享</summary>
      <p>这里共享的是本次观测算出的 K/V，下一次观测会重新生成。</p>
      {baseline.map(mechanismCard)}
    </details> : null}
    {!precomputed.length && !graphReplay && !reuse.length ? <p>当前栈尚无已确认的预计算或执行计划复用记录。</p> : null}
    {revision ? <details className="optimization-version"><summary>实现版本</summary><p>
      {commitUrl ? <a href={commitUrl} target="_blank" rel="noreferrer" title={revision}>commit {revision.slice(0, 7)}</a> : <code title={revision}>commit {revision.slice(0, 7)}</code>}
    </p></details> : null}
  </section>;
}
