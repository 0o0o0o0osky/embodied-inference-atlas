import type { CSSProperties } from 'react';
import './pi0PerformanceOverviewChart.css';

export interface RuntimePerformanceColumn {
  id: string;
  runtimeId: string;
  runtimeLabel: string;
  precisionLabel: string;
  latencyMs: number | null;
  statistic: string | null;
  missing: string;
  selected?: boolean;
  contractLabel?: string;
  title?: string;
  onSelect?: () => void;
  onInspect?: () => void;
  inspectLabel?: string;
}
export const performanceStatisticLabel = (value: string) => ({ mean: '均值', p50: '中位数' }[value] ?? value);
const formatValue = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function chartCeiling(value: number) {
  if (value <= 0) return 200;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude / .5) * magnitude * .5;
}
export function RuntimePerformanceChart({ columns, label, note }: {
  columns: readonly RuntimePerformanceColumn[];
  label: string;
  note?: string;
}) {
  const measured = columns.filter(column => column.latencyMs != null);
  const maximum = chartCeiling(Math.max(0, ...measured.map(column => column.latencyMs!)));
  const statistics = [...new Set(measured.map(column => column.statistic))];
  const statistic = statistics.length === 1 && statistics[0] ? performanceStatisticLabel(statistics[0]) : '各列标注统计量';
  return <figure className="pi0-runtime-chart" aria-label={label}>
    <figcaption><span>推理耗时 / ms{measured.length ? ` · ${statistic}` : ''}</span><span>越低越快</span></figcaption>
    <div className="pi0-runtime-plot">
      <div className="pi0-runtime-grid" aria-hidden="true">{[1, .75, .5, .25, 0].map(fraction => <div key={fraction} style={{ top: `${(1-fraction)*100}%` }}><span>{formatValue(maximum*fraction)}</span></div>)}</div>
      <div className="pi0-runtime-columns" style={{ '--pi0-column-count': columns.length || 1 } as CSSProperties}>
        {columns.map(column => <div key={column.id} className="pi0-runtime-column" data-runtime={column.runtimeId}>
          <div className="pi0-runtime-column-plot">{column.latencyMs != null ? <button type="button" className={`pi0-runtime-bar${column.selected ? ' is-selected' : ''}`} style={{ height: `${column.latencyMs/maximum*100}%` }} onClick={column.onSelect} aria-label={`${column.runtimeLabel} ${column.precisionLabel}，${performanceStatisticLabel(column.statistic ?? '未记录统计量')} ${formatValue(column.latencyMs)} ms，查看推理栈`} title={column.title}><strong>{formatValue(column.latencyMs)}</strong></button> : <span className="pi0-runtime-missing">{column.missing}</span>}</div>
          <div className="pi0-runtime-column-label"><strong>{column.runtimeLabel}</strong><span>{column.precisionLabel}</span>{column.contractLabel ? <small>{column.contractLabel}</small> : null}{statistics.length > 1 && column.latencyMs != null ? <small>{performanceStatisticLabel(column.statistic ?? '未记录统计量')}</small> : null}</div>
          {column.onInspect ? <button type="button" className="pi0-runtime-source-link" onClick={column.onInspect}>{column.inspectLabel ?? '查看推理栈'}</button> : null}
        </div>)}
      </div>
    </div>
    {note ? <p className="pi0-runtime-chart-note">{note}</p> : null}
  </figure>;
}
