import './cudaGraphComparison.css';

const GROUPS = [
  { name: '视觉计算', submission: '提交视觉图' },
  { name: '主推理计算', submission: '提交主图' },
] as const;

/** Submission mechanism only: both sides retain the same GPU computation. */
export function CudaGraphComparison() {
  return <figure className="optimization-comparison graph-comparison" aria-label="CUDA Graph 提交前后对照">
    <figcaption>省去 CPU 逐个 Kernel 提交的重复开销</figcaption>
    <div className="optimization-comparison-panels">
      {([false, true] as const).map(graph => <section className="optimization-comparison-panel" key={String(graph)}
        aria-label={graph ? 'CUDA Graph 当前实现' : '逐个 Kernel 提交'}>
        <h5 className="optimization-comparison-heading">{graph ? 'CUDA Graph · 当前实现' : '逐个 Kernel 提交'}</h5>
        <p className="graph-comparison-lane">CPU <span>提交 GPU 任务</span></p>
        <div className="graph-comparison-groups">
          {GROUPS.map(group => <div className="graph-comparison-submit-group" key={group.name} aria-label={`${group.name}的 CPU 提交`}>
            {graph ? <span className="graph-comparison-submit is-graph">{group.submission}</span>
              : <div className="graph-comparison-submissions"><span className="graph-comparison-submit">提交</span><span aria-hidden="true">→</span><span className="graph-comparison-submit">提交</span><span className="graph-comparison-more" aria-label="继续提交其余 Kernel">…</span></div>}
          </div>)}
        </div>
        <div className="graph-comparison-groups graph-comparison-links" aria-hidden="true">
          {GROUPS.map(group => <div className="graph-comparison-arrow" key={group.name} />)}
        </div>
        <p className="graph-comparison-lane">GPU <span>执行计算</span></p>
        <div className="graph-comparison-groups">
          {GROUPS.map(group => <div className="graph-comparison-gpu-group" key={group.name}>
            <strong>{group.name}</strong>
            <div className="graph-comparison-kernels" aria-label="多个 Kernel 的计算序列">
              <span>Kernel</span><span aria-hidden="true">→</span><span>Kernel</span><span aria-label="其余 Kernel">…</span>
            </div>
          </div>)}
        </div>
        <p className="graph-comparison-order">视觉计算 → 主推理计算</p>
        {graph ? <aside className="graph-comparison-preparation">
          <strong>准备期</strong><span>先捕获视觉图和主图，后续预测复用。</span>
        </aside> : null}
      </section>)}
    </div>
    <p className="optimization-comparison-note graph-comparison-result">绿色部分复用提交计划；下方两组 GPU 计算照常执行。</p>
  </figure>;
}
