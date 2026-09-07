import { useId } from 'react';
import './cudaGraphComparison.css';

// Qualitative launch-bound example, following the official PyTorch Figure 1.
// The omitted middle of the sequence is symbolic; dimensions are not timings.
const KERNELS = ['K₁', 'K₂', 'K₃', '…', 'Kₙ'] as const;
const kernelWidth = 118;
const launchX = (index: number) => 160 + index * 180;
const kernelX = (graph: boolean, index: number) => graph ? 420 + index * 126 : 380 + index * 180;

export function CudaGraphComparison() {
  const uid = useId().replace(/:/g, '');
  return <figure className="optimization-comparison graph-comparison" aria-label="CUDA Graph 提交前后对照">
    <figcaption>一张 Graph 内的短 Kernel：逐次提交与整图重放</figcaption>
    <div className="graph-comparison-scroll" tabIndex={0} role="region" aria-label="Kernel launch 对照时间线，可横向滚动">
      <svg viewBox="0 0 1280 568" role="img" aria-label="短 Kernel 受提交开销限制的机制示意；CPU 连续提交并与 GPU 执行重叠，Graph 减少重复提交与等待">
        <defs>
          <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#718797" /></marker>
          <pattern id={`${uid}-wait`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d4b589" strokeWidth="2" /></pattern>
        </defs>
        {([false, true] as const).map(graph => <g key={String(graph)} transform={`translate(0 ${graph ? 288 : 0})`} className="graph-comparison-panel" data-mode={graph ? 'graph' : 'individual'}>
          <text x="20" y="28" className="graph-comparison-title">{graph ? 'CUDA Graph 重放' : '逐个 Kernel launch'}</text>
          <text x="1250" y="28" textAnchor="end" className="graph-comparison-count">{graph ? '整图提交 1 次' : '逐个提交 N 次'}</text>
          <rect x="148" y="60" width="1102" height="56" rx="3" className="graph-comparison-cpu-lane" />
          <rect x="148" y="174" width="1102" height="56" rx="3" className="graph-comparison-gpu-lane" />
          <text x="20" y="93" className="graph-comparison-lane-label">CPU 提交</text>
          <text x="20" y="207" className="graph-comparison-lane-label">GPU 执行</text>
          {graph ? <>
            <g className="graph-comparison-host-launch">
              <rect x="160" y="69" width="220" height="38" rx="3" className="graph-comparison-launch is-graph" />
              <text x="270" y="94" textAnchor="middle" className="graph-comparison-launch-label is-graph">cudaGraphLaunch</text>
            </g>
            <text x="420" y="93" className="graph-comparison-saved-label">整段工作已提交，省去逐 Kernel launch</text>
          </> : KERNELS.map((kernel,index) => <g key={index} className="graph-comparison-host-launch">
            <rect x={launchX(index)} y="69" width="168" height="38" className="graph-comparison-launch" />
            <text x={launchX(index)+84} y="94" textAnchor="middle" className="graph-comparison-launch-label">{kernel==='…'?'…':`提交 ${kernel}`}</text>
          </g>)}
          <text x={graph ? 420 : 380} y="149" className="graph-comparison-explanation">{graph ? 'GPU 按图中依赖推进整段计算' : 'CPU 提交 K₂ 时，GPU 已可执行 K₁'}</text>
          {KERNELS.map((kernel,index) => <g key={index} className="graph-comparison-kernel" data-kernel={kernel}>
            <rect x={kernelX(graph,index)} y="183" width={kernelWidth} height="38" rx="2" />
            <text x={kernelX(graph,index)+kernelWidth/2} y="208" textAnchor="middle">{kernel}</text>
          </g>)}
          {!graph ? KERNELS.slice(1).map((_,index)=><rect key={index} className="graph-comparison-wait" x={kernelX(false,index)+kernelWidth} y="183" width={180-kernelWidth} height="38" fill={`url(#${uid}-wait)`} />) : null}
          <text x={graph ? 420 : 380} y="251" className="graph-comparison-explanation">{graph ? '窄间隙：图内启动／调度开销' : '斜线间隙：逐次提交／启动带来的等待'}</text>
          <line x1="148" y1="270" x2="1208" y2="270" className="graph-comparison-axis" markerEnd={`url(#${uid}-arrow)`} />
          <text x="1250" y="274" textAnchor="end" className="graph-comparison-time">时间</text>
        </g>)}
      </svg>
    </div>
    <p className="optimization-comparison-note">机制示意：短 Kernel 受提交开销限制；相同 Kernel 用相同宽度表示计算，间隙表示等待。</p>
  </figure>;
}
