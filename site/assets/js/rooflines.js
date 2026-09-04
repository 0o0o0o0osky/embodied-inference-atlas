(function () {
  "use strict";

  const pageData = Atlas.readPageData();
  const series = Atlas.groupBy(pageData.rooflines, (point) =>
    `${point.device_id}|${point.memory_level}|${point.precision_id}`
  );

  function renderRooflineSeries(seriesId, points) {
    const card = Atlas.element("article", { className: "chart-card" });
    card.appendChild(Atlas.element("h3", { text: seriesId }));
    const chartNode = Atlas.element("div", { className: "chart" });
    chartNode.dataset.comparisonKind = "precision_roofline";
    chartNode.dataset.seriesId = seriesId;
    card.appendChild(chartNode);
    document.getElementById("roofline-charts").appendChild(card);
    const intensities = points.map((point) => point.arithmetic_intensity_flop_per_byte).filter((value) => value > 0);
    const minimum = Math.max(Math.min(...intensities) / 2, 0.01);
    const maximum = Math.max(...intensities) * 2;
    const compute = points[0].compute_peak_gflop_per_s;
    const bandwidth = points[0].bandwidth_gib_per_s;
    const xValues = [minimum, ...intensities, maximum].sort((left, right) => left - right);
    const ceiling = xValues.map((intensity) => [intensity, Math.min(compute, bandwidth * 1.073741824 * intensity)]);
    Atlas.chart(chartNode, {
      tooltip: { trigger: "item" },
      legend: { data: ["ceiling", "analytical points"] },
      xAxis: { type: "log", name: "Arithmetic intensity (FLOP/byte)" },
      yAxis: { type: "log", name: "GFLOP/s" },
      series: [
        { name: "ceiling", type: "line", showSymbol: false, lineStyle: { type: "dashed" }, data: ceiling },
        { name: "analytical points", type: "scatter", symbol: "emptyCircle", data: points.map((point) => ({
          value: [point.arithmetic_intensity_flop_per_byte, point.achieved_gflop_per_s],
          name: `${point.model_name} · ${point.module_id}`,
        })) },
      ],
    });
  }

  for (const [seriesId, points] of Object.entries(series)) {
    renderRooflineSeries(seriesId, points);
  }
  Atlas.renderTable(document.getElementById("precision-table"), [
    { label: "Precision", value: "label" }, { label: "Weights", value: "weight_dtype" },
    { label: "Activations", value: "activation_dtype" }, { label: "Execution", value: "execution_dtype" },
    { label: "E2E records", value: "e2e_records" },
    { label: "Matching operator ceiling", value: (row) => row.has_operator_ceiling ? "yes" : "no — no compute roofline inferred" },
  ], pageData.precision_inventory);
}());
