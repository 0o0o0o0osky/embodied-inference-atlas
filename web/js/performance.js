(function () {
  "use strict";

  const pageData = Atlas.readPageData();
  const statisticOrder = ["min", "mean", "p50", "p95", "max", "analytical_estimate"];
  const statisticLabel = (value) => value === "analytical_estimate" ? "analytical estimate" : value;

  function ratioLabel(row) {
    if (row.ratio_kind === "validated_speedup" && row.ratio !== undefined) return `${row.ratio.toFixed(2)}× validated speedup`;
    if (row.ratio_kind === "latency_ratio_unvalidated" && row.ratio !== undefined) return `${row.ratio.toFixed(2)}× latency ratio (quality unvalidated)`;
    return `not comparable${row.not_comparable_reason ? ` — ${row.not_comparable_reason}` : ""}`;
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
      const statistics = statisticOrder.filter((statistic) =>
        group.records.some((row) => typeof row.statistics[statistic] === "number")
      );
      Atlas.chart(chartNode, {
        tooltip: { trigger: "axis" },
        legend: { data: statistics.map(statisticLabel) },
        xAxis: { type: "category", data: group.records.map((row) => `${row.runtime_id}\n${row.precision_label}`) },
        yAxis: { type: "value", name: "Latency (ms)" },
        series: statistics.map((statistic) => ({
          name: statisticLabel(statistic),
          type: "bar",
          itemStyle: statistic === "analytical_estimate" ? { color: "transparent", borderColor: "#d8862f", borderWidth: 2 } : undefined,
          data: group.records.map((row) => row.statistics[statistic]),
        })),
      });
    });
    if (!charts.length) Atlas.addEmptyState(target, emptyMessage);
  }

  renderLatencyCharts(document.getElementById("e2e-charts"), pageData.e2e_charts, "No multi-record precision groups are available.");
  renderLatencyCharts(document.getElementById("runtime-charts"), pageData.runtime_charts, "No multi-record runtime groups share an equivalent artifact and context.");
  renderLatencyCharts(document.getElementById("gap-charts"), pageData.analytical_gap_charts, "No measured and analytical records share a comparison-eligible artifact/context group.");

  Atlas.renderTable(document.getElementById("comparison-table"), [
    { label: "Kind", value: "comparison_kind" },
    { label: "Group", value: "group_id" },
    { label: "Baseline", value: "baseline_run_id" },
    { label: "Candidate", value: "candidate_run_id" },
    { label: "Correctness", value: "correctness" },
    { label: "Baseline statistic", value: (row) => statisticLabel(row.baseline_statistic) },
    { label: "Candidate statistic", value: (row) => statisticLabel(row.candidate_statistic) },
    { label: "Interpretation", value: ratioLabel },
  ], pageData.comparisons);

  Atlas.renderTable(document.getElementById("e2e-provenance-table"), [
    { label: "Model", value: "model_name" }, { label: "Runtime", value: "runtime_name" },
    { label: "Evidence", value: "evidence" }, { label: "Precision", value: "precision_label" },
    { label: "Selected ms", value: "selected_latency_ms" },
    { label: "Statistic", value: (row) => statisticLabel(row.selected_statistic) },
    { label: "Samples", value: "sample_count" }, { label: "Warmups", value: "warmup_iterations" },
    { label: "Percentile provenance", value: "percentile_method" },
    { label: "Timing boundary", value: "timing_boundary_id" },
    { label: "Operating point", value: "operating_point_id" },
  ], pageData.e2e_records);

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
    const statistics = statisticOrder.filter((statistic) =>
      group.records.some((row) => typeof row.statistics[statistic] === "number")
    );
    Atlas.chart(chartNode, {
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: group.records.map((row) => `${row.run_id}\n${row.stage_id}`) },
      yAxis: { type: "value", name: "Latency (ms)" },
      legend: { data: statistics.map(statisticLabel) },
      series: statistics.map((statistic) => ({
        type: "bar",
        name: statisticLabel(statistic),
        itemStyle: statistic === "analytical_estimate" ? { color: "transparent", borderColor: "#d8862f", borderWidth: 2 } : undefined,
        data: group.records.map((row) => row.statistics[statistic]),
      })),
    });
  });
  Atlas.renderTable(document.getElementById("stage-table"), [
    { label: "Model", value: "model_name" }, { label: "Runtime", value: "runtime_name" },
    { label: "Stage", value: "stage_id" }, { label: "Additive", value: (row) => row.additive ? "yes" : "no" },
    { label: "Selected ms", value: "selected_latency_ms" },
    { label: "Statistic", value: (row) => statisticLabel(row.selected_statistic) },
    { label: "Mean ms", value: "mean_ms" }, { label: "p50 ms", value: "p50_ms" },
    { label: "p95 ms", value: "p95_ms" }, { label: "Samples", value: "sample_count" },
    { label: "Warmups", value: "warmup_iterations" },
    { label: "Percentile provenance", value: "percentile_method" },
    { label: "Evidence", value: "evidence" },
  ], pageData.stages);

  Atlas.renderProfilerCoverage(document.getElementById("profiler-coverage"), pageData.profiler_coverage);
}());
