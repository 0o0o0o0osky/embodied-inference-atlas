/** FlashRT's audited time-branch split. Boxes represent work, not durations. */
export function TimePrecomputeComparison() {
  const actionBranch = <div className="time-comparison-branch">
    <span className="time-comparison-input">当前步动作</span>
    <span className="time-comparison-arrow" aria-hidden="true">↓</span>
    <div className="time-comparison-node">动作分支投影</div>
  </div>;
  const output = <div className="time-comparison-output">
    <div className="time-comparison-merge" aria-hidden="true">↓<span>↓</span></div>
    <div className="time-comparison-tail"><span>相加</span><b aria-hidden="true">→</b><span>SiLU</span><b aria-hidden="true">→</b><span>输出投影</span></div>
  </div>;
  return <figure className="optimization-comparison" aria-label="时间预计算前后对照">
    <figcaption>省去每个去噪步骤的时间特征生成与时间投影</figcaption>
    <div className="time-comparison-preparation">
      <strong>当前实现的准备阶段 · GPU</strong>
      <div className="time-comparison-preparation-flow">
        <span>固定 10 步时间表</span><b aria-hidden="true">→</b>
        <span>sin / cos</span><b aria-hidden="true">→</b>
        <span>时间投影 + 偏置</span><b aria-hidden="true">→</b>
        <span className="time-comparison-table">存好 10 步结果</span>
      </div>
      <p>设置提示词时准备；后续观测继续读取这张表。</p>
    </div>
    <div className="optimization-comparison-panels">
      <section className="optimization-comparison-panel" aria-label="未预计算的时间分支">
        <h5 className="optimization-comparison-heading">未预计算</h5>
        <p className="time-comparison-repeat">每次观测的每个去噪步骤 · GPU</p>
        <div className="time-comparison-branches">
          <div className="time-comparison-branch">
            <span className="time-comparison-input">当前时间步</span>
            <span className="time-comparison-arrow" aria-hidden="true">↓</span>
            <div className="time-comparison-node is-repeated">sin / cos<small>生成时间特征</small></div>
            <span className="time-comparison-arrow" aria-hidden="true">↓</span>
            <div className="time-comparison-node is-repeated">时间投影 + 偏置</div>
          </div>
          {actionBranch}
        </div>
        {output}
      </section>
      <section className="optimization-comparison-panel" aria-label="FlashRT 预计算后的时间分支">
        <h5 className="optimization-comparison-heading">预计算 · 当前实现</h5>
        <p className="time-comparison-repeat">每次观测的每个去噪步骤 · GPU</p>
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
