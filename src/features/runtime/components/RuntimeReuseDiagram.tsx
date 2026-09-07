import { AnalysisPlaceholder } from '../../../components/AnalysisPlaceholder';
import type { CanonicalRecord } from '../../../types/atlas';
import type { LogicalDag } from '../../model-graph/domain/types';
import { useModelText } from '../../model-graph/presentation/ModelDisplay';
import type { RuntimeRealizationRecord, RuntimeReuseDescriptor } from '../domain/types';
import { runtimeSourceReferences } from './RuntimeSourceReferences';
import { CudaGraphComparison } from './CudaGraphComparison';
import { TimePrecomputeComparison } from './TimePrecomputeComparison';
import { readableEvidence, repeatedWork, resolveReuseMechanisms } from '../presentation/reuseMechanisms';
import './runtimeReuse.css';
import './optimizationComparison.css';

const STATUS = {implemented:'已实现',not_implemented:'未实现',unknown:'待核对'};
const KIND = {computed_result:'计算结果复用',execution_plan:'执行计划复用',storage:'存储复用'};
export function RuntimeReuseDiagram({dag, realization, sources}: {
  dag: LogicalDag | null; realization: RuntimeRealizationRecord; sources?: readonly CanonicalRecord[] | undefined;
}) {
  const t = useModelText();
  const reuse = realization.reuse ?? [];
  const {items: optimizations, timeConfigurations, graphItems, graphFallback: graphReplay, precomputed} = resolveReuseMechanisms(realization);
  const hasDiagrams = timeConfigurations.size > 0 || graphItems.size > 0 || graphReplay;
  const refs = (values: readonly string[]) => [...new Set(values.map(ref => {
    const label = dag?.nodes.get(ref)?.label ?? realization.executionGroups?.find(group => group.executionGroupId === ref)?.label;
    return label ? t(label) : null;
  }).filter(Boolean))].join('、');
  const revision = /^[a-f0-9]{40}$/i.test(realization.runtimeRevision ?? '') ? realization.runtimeRevision : null;
  const repositories = revision ? runtimeSourceReferences(sources, realization.evidence
    .filter(item => item.kind === 'source_code' && item.revision === revision).map(item => item.sourceId))
    .filter(item => item.github) : [];
  const commitUrl = repositories.length === 1 ? `${repositories[0]!.url}/commit/${revision}` : null;

  const mechanismCard = (item: RuntimeReuseDescriptor) => {
    const timeConfig = timeConfigurations.get(item.reuseId);
    const comparison = timeConfig ? <TimePrecomputeComparison config={timeConfig} />
      : graphItems.has(item.reuseId) ? <CudaGraphComparison /> : null;
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
      {comparison ?? <dl className="optimization-explanation">
        <div><dt>当前做法</dt><dd>{readableEvidence(item.repeatScope)}</dd></div>
        <div className="optimization-effect"><dt>减少的重复工作</dt><dd>{repeatedWork(item, realization)}</dd></div>
      </dl>}
      {comparison || item.invalidationConditions.length || item.valueDependencies.length || producers || consumers || costs.length ? <details className="optimization-detail">
        <summary>重建条件与计算细节</summary>
        <dl>
          {comparison ? <div><dt>当前做法</dt><dd>{readableEvidence(item.repeatScope)}</dd></div> : null}
          {item.invalidationConditions.length ? <div><dt>何时重做</dt><dd><ul>{item.invalidationConditions.map(condition => <li key={condition}>{readableEvidence(condition)}</li>)}</ul></dd></div> : null}
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
    <p className="runtime-reuse-intro">{hasDiagrams ? '流程对照示意：橙色标出重复工作，绿色标出提前准备或复用的部分。' : '当前栈采用的预计算和提交优化，以及它们的有效范围。'}</p>
    <div className="runtime-optimization-grid">
      {optimizations.map(mechanismCard)}
      {!reuse.length ? precomputed.map(mapping => <article className="runtime-optimization" key={mapping.mappingId}>
        <header><h4>{refs(mapping.logicalTargets.map(target => target.ref)) || '预计算'}</h4><span>已实现 · 计算结果预计算</span></header>
        <p>预测前生成结果，预测内直接使用。</p>
      </article>) : null}
      {graphReplay ? <article className="runtime-optimization"><header><h4>CUDA Graph 提交</h4><span>已实现 · 执行计划复用</span></header>
        <CudaGraphComparison />
      </article> : null}
    </div>
    {!optimizations.length && !graphReplay && (!precomputed.length || reuse.length > 0) ? <AnalysisPlaceholder title="优化机制待补充" state="not_recorded" detail="补充当前实现的优化方式、节省的工作与适用条件后显示。" /> : null}
    {revision ? <details className="optimization-version"><summary>实现版本</summary><p>
      {commitUrl ? <a href={commitUrl} target="_blank" rel="noreferrer" title={revision}>commit {revision.slice(0, 7)}</a> : <code title={revision}>commit {revision.slice(0, 7)}</code>}
    </p></details> : null}
  </section>;
}
