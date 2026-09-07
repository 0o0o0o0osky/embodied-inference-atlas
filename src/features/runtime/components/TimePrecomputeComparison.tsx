import { Fragment } from 'react';
import type { TimePrecomputeConfig } from '../presentation/reuseMechanisms';

/** Boxes represent configured work, not measured durations. */
export function TimePrecomputeComparison({config}: {config: TimePrecomputeConfig}) {
  const actionBranch = <div className="time-comparison-branch">
    <span className="time-comparison-input">当前步动作</span>
    <span className="time-comparison-arrow" aria-hidden="true">↓</span>
    <div className="time-comparison-node">{config.actionOperation}</div>
  </div>;
  const output = <div className="time-comparison-output">
    <div className="time-comparison-merge" aria-hidden="true">↓<span>↓</span></div>
    <div className="time-comparison-tail">{config.outputOperations.map((operation,index)=><Fragment key={operation}>{index ? <b aria-hidden="true">→</b> : null}<span>{operation}</span></Fragment>)}</div>
  </div>;
  return <figure className="optimization-comparison" aria-label="时间预计算前后对照">
    <figcaption>省去每个去噪步骤的时间特征生成与时间投影</figcaption>
    <div className="time-comparison-preparation">
      <strong>当前实现的准备阶段 · {config.preparationDevice}</strong>
      <div className="time-comparison-preparation-flow">
        <span>{config.scheduleLabel}</span><b aria-hidden="true">→</b>
        <span>{config.featureOperation}</span><b aria-hidden="true">→</b>
        <span>{config.projectionOperation}</span><b aria-hidden="true">→</b>
        <span className="time-comparison-table">{config.tableLabel}</span>
      </div>
      <p>{config.preparationScope}</p>
    </div>
    <div className="optimization-comparison-panels">
      <section className="optimization-comparison-panel" aria-label="未预计算的时间分支">
        <h5 className="optimization-comparison-heading">未预计算</h5>
        <p className="time-comparison-repeat">{config.repeatScope} · {config.executionDevice}</p>
        <div className="time-comparison-branches">
          <div className="time-comparison-branch">
            <span className="time-comparison-input">当前时间步</span>
            <span className="time-comparison-arrow" aria-hidden="true">↓</span>
            <div className="time-comparison-node is-repeated">{config.featureOperation}<small>生成时间特征</small></div>
            <span className="time-comparison-arrow" aria-hidden="true">↓</span>
            <div className="time-comparison-node is-repeated">{config.projectionOperation}</div>
          </div>
          {actionBranch}
        </div>
        {output}
      </section>
      <section className="optimization-comparison-panel" aria-label="预计算后的时间分支">
        <h5 className="optimization-comparison-heading">预计算 · 当前实现</h5>
        <p className="time-comparison-repeat">{config.repeatScope} · {config.executionDevice}</p>
        <div className="time-comparison-branches">
          <div className="time-comparison-branch">
            <span className="time-comparison-input">当前步编号</span>
            <span className="time-comparison-arrow" aria-hidden="true">↓</span>
            <div className="time-comparison-node is-prepared">读取当前步结果<small>从准备好的时间表读取</small></div>
          </div>
          {actionBranch}
        </div>
        {output}
      </section>
    </div>
    <p className="optimization-comparison-note">橙色计算移到准备阶段；动作分支、相加、激活与输出投影仍逐步执行。</p>
  </figure>;
}
