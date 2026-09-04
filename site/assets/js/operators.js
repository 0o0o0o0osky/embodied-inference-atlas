(function () {
  "use strict";

  const pageData = Atlas.readPageData();
  const counts = Atlas.groupBy(pageData.operators, (row) => `${row.model_name} · ${row.module_id}`);
  document.getElementById("operator-summary").appendChild(Atlas.element("p", {
    className: "summary-line",
    text: `${pageData.operators.length} analytical components across ${Object.keys(counts).length} model/module groups. No kernel mapping is claimed in this data slice.`,
  }));
  Atlas.renderTable(document.getElementById("operator-table"), [
    { label: "Model", value: "model_name" }, { label: "Module", value: "module_id" },
    { label: "Granularity", value: "granularity" }, { label: "GFLOP", value: "work_gflop" },
    { label: "GiB", value: "traffic_gib" }, { label: "Arithmetic intensity (FLOP/byte)", value: "arithmetic_intensity_flop_per_byte" },
    { label: "Execution count", value: "execution_count" }, { label: "Evidence", value: "evidence" },
  ], pageData.operators);
}());
