(function () {
  "use strict";

  const pageData = Atlas.readPageData();
  const statisticLabel = (value) => value === "analytical_estimate" ? "analytical estimate" : value;
  const nodes = pageData.architecture.nodes.map((node) => ({
    id: node.node_id,
    name: node.label,
    value: node.multiplicity,
    symbolSize: node.multiplicity === "per_denoise_step" ? 74 : node.multiplicity === "per_view" ? 66 : 58,
    itemStyle: { borderWidth: 2, borderColor: "#147d76" },
    label: { formatter: `${node.label}\n${node.multiplicity}` },
  }));
  const links = pageData.architecture.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    value: edge.tensor_label,
  }));
  const architectureTarget = document.getElementById("architecture-chart");
  architectureTarget.dataset.comparisonKind = "architecture_flow";
  Atlas.chart(architectureTarget, {
    tooltip: { formatter: (item) => item.dataType === "edge" ? item.data.value : `${item.data.name}<br>multiplicity: ${item.data.value}` },
    series: [{
      type: "graph",
      layout: "circular",
      roam: true,
      data: nodes,
      links,
      edgeLabel: { show: true, formatter: (item) => item.data.value, fontSize: 9 },
      lineStyle: { color: "#78909c", curveness: 0.08 },
      label: { show: true, position: "bottom" },
    }],
  });

  Atlas.renderTable(document.getElementById("architecture-table"), [
    { label: "Module", value: "label" },
    { label: "Semantic role", value: "kind" },
    { label: "Multiplicity", value: "multiplicity" },
  ], pageData.architecture.nodes.map((node) => {
    const row = { ...node };
    row.label = Atlas.element("span", { id: node.dom_id, text: node.label });
    return row;
  }));

  const workloadColumns = [
    ["Runtime", "runtime_name"], ["Evidence", "evidence"], ["Precision", "precision_label"],
    ["Views", "camera_views"], ["Executed prompt tokens", "executed_prompt_tokens"],
    ["Denoise steps", "denoise_steps"], ["Action chunk", "action_chunk"],
    ["Selected latency (ms)", "selected_latency_ms"], ["Selected statistic", "selected_statistic"],
    ["Samples", "sample_count"], ["Warmups", "warmup_iterations"],
    ["Percentile provenance", "percentile_method"],
    ["Mean ms", "mean_ms"], ["p50 ms", "p50_ms"], ["p95 ms", "p95_ms"],
  ].filter(([, key]) => pageData.measurements.some((row) => row[key] !== null && row[key] !== undefined))
    .map(([label, value]) => ({
      label,
      value: value === "selected_statistic" ? (row) => statisticLabel(row[value]) : value,
    }));
  Atlas.renderTable(document.getElementById("workload-table"), workloadColumns, pageData.measurements);

  const curveTarget = document.getElementById("latency-curves");
  pageData.latency_curves.forEach((curve) => {
    curve.groups.forEach((group) => {
      const panel = Atlas.element("article", { className: "chart-card" });
      const heading = Atlas.element("h3", { text: `${curve.axis_label} · ${group.group_id}` });
      const chartNode = Atlas.element("div", { className: "chart" });
      chartNode.dataset.comparisonKind = curve.comparison_kind;
      if (curve.varying_field) chartNode.dataset.varyingField = curve.varying_field;
      panel.append(heading, chartNode);
      curveTarget.appendChild(panel);
      const records = [...group.records].sort((left, right) => String(left[curve.axis]).localeCompare(String(right[curve.axis]), undefined, { numeric: true }));
      const statistics = [...new Set(records.map((row) => row.selected_statistic).filter(Boolean))];
      Atlas.chart(chartNode, {
        tooltip: { trigger: "axis" },
        legend: { data: statistics.map(statisticLabel) },
        xAxis: { type: "category", name: curve.axis_label, data: records.map((row) => row[curve.axis]) },
        yAxis: { type: "value", name: "Latency (ms)" },
        series: statistics.map((statistic) => ({
          type: "line",
          symbol: statistic === "analytical_estimate" ? "emptyCircle" : "circle",
          lineStyle: { type: statistic === "analytical_estimate" ? "dashed" : "solid" },
          data: records.map((row) => row.selected_statistic === statistic ? row.selected_latency_ms : null),
          name: statisticLabel(statistic),
        })),
      });
    });
  });
  if (!curveTarget.children.length) Atlas.addEmptyState(curveTarget, "No multi-point comparison-safe latency curves for this model.");
}());
