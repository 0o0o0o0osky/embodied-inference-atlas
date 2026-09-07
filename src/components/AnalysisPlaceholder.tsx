import './analysisPlaceholder.css';

export type AnalysisAbsence = 'not_recorded' | 'not_collected' | 'no_match' | 'unlinked' | 'unsupported' | 'unverified';
export interface AnalysisPlaceholderProps {
  title: string;
  state: AnalysisAbsence;
  detail: string;
}
const labels: Record<AnalysisAbsence, string> = {
  not_recorded: '未填写', not_collected: '未采集', no_match: '无匹配数据',
  unlinked: '待关联', unsupported: '不支持', unverified: '待核验',
};

/** A missing capability keeps its place in the shared page without an empty chart. */
export function AnalysisPlaceholder({title, state, detail}: AnalysisPlaceholderProps) {
  return <div className="analysis-placeholder" data-analysis-state={state}>
    <div><strong>{title}</strong>{title.includes(labels[state]) ? null : <span>{labels[state]}</span>}</div>
    <p>{detail}</p>
  </div>;
}
