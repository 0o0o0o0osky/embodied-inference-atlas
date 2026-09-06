import type { LogicalDag } from "../../model-graph/domain/types";
import { useModelText } from "../../model-graph/presentation/ModelDisplay";
import type { RuntimeRealizationRecord } from "../domain/types";

/** Execution lifetime is a separate view, never an extra dependency in the model DAG. */
export function RuntimeReuseDiagram({ dag, realization }: { dag: LogicalDag; realization: RuntimeRealizationRecord }) {
  const t = useModelText();
  const precomputed = realization.mappings.filter((mapping) => mapping.reasonCode === "precomputed_outside_prediction");
  const graphReplay = realization.launch.cudaGraphState === "present"
    && realization.launch.submissionMode === "cuda_graph_replay";
  return <section className="runtime-reuse-view" aria-label="计算与复用时序">
    <p>展示计算发生在哪个阶段，不代表实测时长或加速比。</p>
    {precomputed.map((mapping) => <figure key={mapping.mappingId}>
      <figcaption>{mapping.logicalTargets.map((target) => t(dag.nodes.get(target.ref)?.label ?? "预计算项")).join("、")}</figcaption>
      <ol className="runtime-reuse-track">
        <li><span>预测之前</span><strong>预先计算</strong></li>
        <li><span>结果保留</span><strong>供预测使用</strong></li>
        <li><span>预测之内</span><strong>不再独立计算</strong></li>
      </ol>
    </figure>)}
    {graphReplay ? <figure>
      <figcaption>CUDA Graph</figcaption>
      <ol className="runtime-reuse-track">
        <li><span>准备阶段</span><strong>捕获执行图</strong></li>
        <li><span>预测阶段</span><strong>提交已捕获的图</strong></li>
        <li><span>后续预测</span><strong>复用图的提交方式</strong></li>
      </ol>
      <p>复用的是执行图，不表示复用上一次预测的输出。</p>
    </figure> : null}
    {!precomputed.length && !graphReplay ? <p className="pi0-funnel-empty">当前源码记录尚未明确预计算或图复用策略。</p> : null}
    <details><summary>依据与边界</summary><p>仅展示当前推理栈已记录的策略。前缀缓存是否跨去噪步骤或跨观测复用，需要对应证据；不从模型结构推断。</p></details>
  </section>;
}
