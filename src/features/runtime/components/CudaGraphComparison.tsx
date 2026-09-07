import { useId } from 'react';
import './cudaGraphComparison.css';

// A symbolic sequence, not sampled durations or the complete Kernel inventory.
const KERNELS = ['V₁', 'V₂', '…', 'M₁', 'M₂', '…'] as const;
const xAt = (index: number) => 148 + index * 174;

/** Compare host launch work; the same GPU nodes appear in both rows. */
export function CudaGraphComparison() {
  const uid = useId().replace(/:/g, '');
  return <figure className="optimization-comparison graph-comparison" aria-label="CUDA Graph 提交前后对照">
    <figcaption>CPU 提交：逐个 Kernel launch → 视觉图、主推理图各 launch 一次</figcaption>
    <div className="graph-comparison-scroll" tabIndex={0} role="region" aria-label="Kernel launch 对照时间线，可横向滚动">
      <svg viewBox="0 0 1280 552" role="img" aria-label="上方逐个 Kernel launch，下方两次 Graph launch；CPU 提交减少，GPU Kernel 保留">
        <defs>
          <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#718797" /></marker>
          <pattern id={`${uid}-saved`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="10" stroke="#dbe9e2" strokeWidth="2" /></pattern>
        </defs>
        {([false, true] as const).map(graph => <g key={String(graph)} transform={`translate(0 ${graph ? 282 : 0})`} className="graph-comparison-panel" data-mode={graph ? 'graph' : 'individual'}>
          <text x="18" y="26" className="graph-comparison-title">{graph ? 'CUDA Graph · 当前实现' : '逐个 Kernel launch'}</text>
          <text x="1250" y="26" textAnchor="end" className="graph-comparison-count">{graph ? '图内任务：2 次 Graph launch' : '图内任务：N 次 Kernel launch'}</text>
          <rect x="112" y="50" width="1138" height="57" rx="4" className="graph-comparison-cpu-lane" />
          <rect x="112" y="158" width="1138" height="57" rx="4" className="graph-comparison-gpu-lane" />
          <text x="20" y="85" className="graph-comparison-lane-label">CPU</text>
          <text x="20" y="192" className="graph-comparison-lane-label">GPU</text>
          {graph ? <>
            <rect x="493" y="59" width="739" height="39" rx="3" fill={`url(#${uid}-saved)`} className="graph-comparison-saved" />
            <rect x="682" y="66" width="359" height="26" rx="3" fill="#f3f8f5" />
            <text x="862" y="84" textAnchor="middle" className="graph-comparison-saved-label">省去逐 Kernel launch 的 CPU 开销</text>
            {['视觉 Graph launch', '主图 Graph launch'].map((label,index) => <g key={label} className="graph-comparison-host-launch">
              <rect x={xAt(index)} y="59" width="147" height="39" rx="3" className="graph-comparison-launch is-graph" />
              <text x={xAt(index)+73.5} y="83" textAnchor="middle" className="graph-comparison-launch-label is-graph">{label}</text>
            </g>)}
            <path d={`M ${xAt(0)+74} 101 V 163`} className="graph-comparison-link" markerEnd={`url(#${uid}-arrow)`} />
            <path d={`M ${xAt(1)+74} 101 V 126 H ${xAt(3)+74} V 163`} className="graph-comparison-link" markerEnd={`url(#${uid}-arrow)`} />
          </> : KERNELS.map((kernel,index) => <g key={index} className="graph-comparison-host-launch">
            <rect x={xAt(index)} y="59" width="112" height="39" rx="3" className={`graph-comparison-launch${kernel==='…'?' is-more':''}`} />
            <text x={xAt(index)+56} y="83" textAnchor="middle" className="graph-comparison-launch-label">{kernel==='…'?'…':'Kernel launch'}</text>
            <path d={`M ${xAt(index)+56} 101 V 133 H ${xAt(index)+74} V 163`} className="graph-comparison-link" markerEnd={`url(#${uid}-arrow)`} />
          </g>)}
          {KERNELS.map((kernel,index) => <g key={index} className="graph-comparison-kernel" data-kernel={kernel}>
            <rect x={xAt(index)+12} y="166" width="124" height="39" rx="3" />
            <text x={xAt(index)+74} y="191" textAnchor="middle">{kernel}</text>
          </g>)}
          <text x="385" y="234" textAnchor="middle" className="graph-comparison-stage">视觉计算的 Kernel</text>
          <text x="906" y="234" textAnchor="middle" className="graph-comparison-stage">主推理计算的 Kernel</text>
          <line x1="112" y1="254" x2="1208" y2="254" className="graph-comparison-axis" markerEnd={`url(#${uid}-arrow)`} />
          <text x="1250" y="257" textAnchor="end" className="graph-comparison-time">时间</text>
        </g>)}
      </svg>
    </div>
    <p className="optimization-comparison-note">时间线示意。橙色为逐次 launch 开销，斜线区域为省去的 CPU 提交工作。准备时捕获两张图，后续推理重复使用。</p>
  </figure>;
}
