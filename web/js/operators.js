(function () {
  "use strict";

  const pageData = Atlas.readPageData();
  const sourceMethodLabel = (value) => ({
    vla_perf_component_reported_v1: "source-reported component (v1)",
    vla_perf_inverse_roofline_v1: "inverse-roofline reconstructed component (v1)",
  }[value] || value);
  const counts = Atlas.groupBy(pageData.operators, (row) => `${row.model_name} · ${row.module_id}`);
  document.getElementById("operator-summary").appendChild(Atlas.element("p", {
    className: "summary-line",
    text: `${pageData.operators.length} analytical components across ${Object.keys(counts).length} model/module groups. No kernel mapping is claimed in this data slice.`,
  }));
  Atlas.renderTable(document.getElementById("operator-table"), [
    { label: "Model", value: "model_name" }, { label: "Module", value: "module_id" },
    { label: "Granularity", value: "granularity" }, { label: "GFLOP", value: "work_gflop" },
    { label: "GiB", value: "traffic_gib" }, { label: "Arithmetic intensity (FLOP/byte)", value: "arithmetic_intensity_flop_per_byte" },
    { label: "Execution count", value: "execution_count" },
    { label: "Source method", value: (row) => sourceMethodLabel(row.source_method) },
    { label: "Evidence", value: "evidence" },
  ], pageData.operators);
}());
