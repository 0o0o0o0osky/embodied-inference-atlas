(function () {
  "use strict";

  const pageData = Atlas.readPageData();

  function ratioLabel(row) {
    if (row.ratio_kind === "validated_speedup") return `${row.ratio.toFixed(2)}× validated speedup`;
    if (row.ratio_kind === "latency_ratio_unvalidated") return `${row.ratio.toFixed(2)}× latency ratio (quality unvalidated)`;
    return "not comparable";
  }

  Atlas.renderTable(document.getElementById("evidence-classes"), [
    { label: "Evidence", value: "evidence" },
    { label: "Numeric records", value: "numeric_records" },
    { label: "Status sources", value: "status_sources" },
    { label: "Scope", value: (row) => row.numeric_scope ? "numeric evidence" : "status metadata only" },
  ], pageData.evidence_classes);

  function renderLatencyCharts(target, charts, emptyMessage) {
    charts.forEach((group) => {
      const card = Atlas.element("article", { className: "chart-card" });
      card.appendChild(Atlas.element("h3", { text: `${group.comparison_kind} · ${group.group_id}` }));
      const chartNode = Atlas.element("div", { className: "chart" });
      chartNode.dataset.comparisonKind = group.comparison_kind;
      chartNode.dataset.groupId = group.group_id;
      card.appendChild(chartNode);
      target.appendChild(card);
      Atlas.chart(chartNode, {
        tooltip: { trigger: "axis" },
        legend: { data: ["p50", "mean", "p95"] },
        xAxis: { type: "category", data: group.records.map((row) => `${row.runtime_id}\n${row.precision_id}`) },
        yAxis: { type: "value", name: "Latency (ms)" },
        series: ["p50", "mean", "p95"].map((statistic) => ({
          name: statistic,
          type: "bar",
          data: group.records.map((row) => row[`${statistic}_ms`]),
        })),
      });
    });
    if (!charts.length) Atlas.addEmptyState(target, emptyMessage);
  }

  renderLatencyCharts(document.getElementById("e2e-charts"), pageData.e2e_charts, "No multi-record precision groups are available.");
  renderLatencyCharts(document.getElementById("gap-charts"), pageData.analytical_gap_charts, "No measured and analytical records share a comparison-eligible artifact/context group.");

  Atlas.renderTable(document.getElementById("comparison-table"), [
    { label: "Kind", value: "comparison_kind" },
    { label: "Group", value: "group_id" },
    { label: "Baseline", value: "baseline_run_id" },
    { label: "Candidate", value: "candidate_run_id" },
    { label: "Correctness", value: "correctness" },
    { label: "Interpretation", value: ratioLabel },
  ], pageData.comparisons);

  const stageTarget = document.getElementById("stage-charts");
  pageData.stage_charts.forEach((group) => {
    const card = Atlas.element("article", { className: "chart-card" });
    card.appendChild(Atlas.element("h3", { text: `${group.comparison_kind} · ${group.group_id}` }));
    if (group.notice) card.appendChild(Atlas.element("p", { className: "notice", text: group.notice }));
    const chartNode = Atlas.element("div", { className: "chart" });
    chartNode.dataset.comparisonKind = group.comparison_kind;
    chartNode.dataset.groupId = group.group_id;
    chartNode.dataset.stacked = "false";
    card.appendChild(chartNode);
    stageTarget.appendChild(card);
    Atlas.chart(chartNode, {
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: group.records.map((row) => `${row.run_id}\n${row.stage_id}`) },
      yAxis: { type: "value", name: "Mean latency (ms)" },
      series: [{ type: "bar", name: "independent mean", data: group.records.map((row) => row.mean_ms) }],
    });
  });
  Atlas.renderTable(document.getElementById("stage-table"), [
    { label: "Model", value: "model_name" }, { label: "Runtime", value: "runtime_name" },
    { label: "Stage", value: "stage_id" }, { label: "Additive", value: (row) => row.additive ? "yes" : "no" },
    { label: "Mean ms", value: "mean_ms" }, { label: "p50 ms", value: "p50_ms" },
    { label: "p95 ms", value: "p95_ms" }, { label: "Evidence", value: "evidence" },
  ], pageData.stages);

  Atlas.renderProfilerCoverage(document.getElementById("profiler-coverage"), pageData.profiler_coverage);
}());
