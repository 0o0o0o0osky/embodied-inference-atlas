import { useState } from 'react';
import type { LogicalDag } from '../../model-graph/domain/types';
import { useModelText } from '../../model-graph/presentation/ModelDisplay';
import type { RuntimeRealizationRecord, RuntimeReuseDescriptor } from '../domain/types';
import './runtimeReuse.css';
const STAGES = ['初始化','单次观测','重复求解步骤','后续观测'] as const;
const LIFETIME = {initialization:'初始化范围',observation:'当前观测范围',solver_step:'单个求解步骤范围',across_observations:'跨观测范围（受失效条件约束）'};
const STATUS = {implemented:'已实现',not_implemented:'未实现',unknown:'待核对'};
const KIND = {computed_result:'计算结果',execution_plan:'执行计划',storage:'存储'};
// Display-only translations of audited evidence; unknown values retain their text.
const EVIDENCE_LABELS: Readonly<Record<string,string>> = {
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
const evidenceLabels = (values:readonly string[]) => values.map(value=>EVIDENCE_LABELS[value] ?? value).join('、');
const scopeStages = (item:RuntimeReuseDescriptor) => item.lifetime === 'initialization' ? [0] : item.lifetime === 'observation' ? [1,2] : item.lifetime === 'solver_step' ? [2] : [1,2,3];

/** Equal-width stages communicate scope, not measured time or cache hit rate. */
export function RuntimeReuseDiagram({dag, realization}: {dag:LogicalDag;realization:RuntimeRealizationRecord}) {
  const t = useModelText();
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [stage,setStage]=useState(0);
  const reuse=realization.reuse ?? [];
  const selected=reuse.find(item=>item.reuseId===selectedId) ?? reuse[0];
  const precomputed = realization.mappings.filter(mapping=>mapping.reasonCode === 'precomputed_outside_prediction');
  const graphReplay = !reuse.length && realization.launch.cudaGraphState === 'present' && realization.launch.submissionMode === 'cuda_graph_replay';
  const evidence = (ids:readonly string[])=>realization.evidence.filter(item=>ids.includes(item.evidenceId)).map(item=><li key={item.evidenceId}>{item.locator ?? item.evidenceId}{item.revision ? ` · ${item.revision.slice(0,12)}` : ''}</li>);
  const refs=(values:readonly string[])=>values.map(ref=>t(dag.nodes.get(ref)?.label ?? ref)).join('、') || '未记录';
  return <section className="runtime-reuse-view" aria-label="计算与复用生命周期">
    <h3>计算与复用</h3>
    <p>等宽阶段表示生命周期，不表示实测耗时。固定串行执行：观测—推理—动作—观测。</p>
    {reuse.length?<nav className="reuse-object-selector" aria-label="选择复用对象">{reuse.map(item=><button type="button" key={item.reuseId} aria-pressed={selected?.reuseId===item.reuseId} onClick={()=>{setSelectedId(item.reuseId);setStage(scopeStages(item)[0]!);}}><strong>{item.label}</strong><span>{STATUS[item.implementationStatus]} · {KIND[item.kind]}</span></button>)}</nav>:null}
    <div className="reuse-stage-grid" aria-label="生命周期阶段">{STAGES.map((label,index)=><button type="button" key={label} aria-pressed={stage===index} data-in-scope={selected ? scopeStages(selected).includes(index) : false} onClick={()=>setStage(index)}><span>{index+1}</span><strong>{label}</strong>{selected&&scopeStages(selected).includes(index)?<small>声明的有效范围</small>:null}</button>)}</div>
    <div className="reuse-stage-controls"><button type="button" disabled={stage===0} onClick={()=>setStage(stage-1)}>上一阶段</button><span>{STAGES[stage]}</span><button type="button" disabled={stage===3} onClick={()=>setStage(stage+1)}>下一阶段</button></div>
    {selected?<article className="reuse-selected-object" aria-label="所选复用对象详情"><h4>{selected.label}</h4><p>{STATUS[selected.implementationStatus]} · {KIND[selected.kind]} · {LIFETIME[selected.lifetime]}</p>
      <div className="reuse-value-flow"><div><small>生产者</small><strong>{refs(selected.producerRefs)}</strong></div><span aria-hidden="true">→</span><div><small>{KIND[selected.kind]}</small><strong>{selected.label}</strong></div><span aria-hidden="true">→</span><div><small>消费者</small><strong>{refs(selected.consumerRefs)}</strong></div></div>
      <p className="reuse-stage-explanation">{stage===0 ? '初始化阶段：请结合生产者与依赖确认准备范围；阶段示意不证明准备耗时。' : stage===1 ? `当前观测：${evidenceLabels(selected.valueDependencies) || '依赖尚未记录'}。` : stage===2 ? `重复范围：${selected.repeatScope || '未记录'}。` : `后续观测：${evidenceLabels(selected.invalidationConditions) || '失效条件尚未记录'}。`}</p>
      <dl><div><dt>重复范围</dt><dd>{selected.repeatScope || '未记录'}</dd></div><div><dt>值依赖</dt><dd>{evidenceLabels(selected.valueDependencies) || '未记录'}</dd></div><div><dt>失效条件</dt><dd>{evidenceLabels(selected.invalidationConditions) || '未记录'}</dd></div>
        <div><dt>存储</dt><dd>{selected.storageBytes===null?'未记录':`${selected.storageBytes.toLocaleString()} B`}</dd></div><div><dt>准备成本</dt><dd>{selected.preparationNs===null?'未记录':`${(selected.preparationNs/1e3).toLocaleString()} μs`}</dd></div><div><dt>读取成本</dt><dd>{selected.readNs===null?'未记录':`${(selected.readNs/1e3).toLocaleString()} μs`}</dd></div></dl>
      {selected.kind==='execution_plan'?<p>复用提交计划；每次输入仍执行计算，不代表复用上次结果。</p>:selected.kind==='computed_result'?<p>有效范围由全部值依赖共同决定；相同文本不代表多模态输入相同。</p>:null}
      <details className="reuse-evidence"><summary>实现证据</summary><ul>{evidence(selected.evidenceIds)}</ul>{!selected.evidenceIds.length?<p>未记录来源引用。</p>:null}</details>
    </article>:null}
    {!reuse.length ? precomputed.map(mapping=><details className="reuse-object" key={mapping.mappingId}>
      <summary><strong>{mapping.logicalTargets.map(target=>t(dag.nodes.get(target.ref)?.label ?? target.ref)).join('、')}</strong><span>已实现 · 计算结果预计算</span></summary>
      <dl><dt>生产与消费</dt><dd>预测前生成，预测内对应逻辑算子使用。</dd><dt>重复范围</dt><dd>对应求解循环的预计算项；当前记录确认已移出预测。</dd><dt>值依赖 / 失效</dt><dd>具体依赖与失效条件尚未结构化记录。</dd><dt>成本</dt><dd>存储、准备与读取成本未记录。</dd></dl>
      <details className="reuse-evidence"><summary>实现证据</summary><ul>{evidence(mapping.evidenceIds)}</ul></details>
    </details>):null}
    {graphReplay ? <details className="reuse-object"><summary><strong>CUDA Graph</strong><span>已实现 · 执行计划复用</span></summary>
      <p>准备时捕获，预测时提交已捕获的执行图；新输入仍执行计算。当前记录尚未结构化给出兼容性约束与成本。</p><details className="reuse-evidence"><summary>实现证据</summary><ul>{evidence(realization.launch.evidenceIds)}</ul></details>
    </details> : null}
    {!precomputed.length && !graphReplay && !reuse.length ? <p>当前栈尚无已确认的预计算或执行计划复用记录。</p> : null}
  </section>;
}
