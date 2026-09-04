(function () {
  "use strict";

  const pageData = JSON.parse(document.getElementById("page-data").textContent);
  const coverageTarget = document.getElementById("coverage");

  function matchesFilters(row, selected) {
    return Object.entries(selected).every(([key, value]) => !value || String(row[key]) === value);
  }

  function stateChip(row) {
    const chip = Atlas.element("span", { className: `state-chip state-${row.state}` });
    chip.textContent = row.state.replaceAll("_", " ");
    const details = [row.system_label, row.evidence, row.precision_label || row.precision_id].filter(Boolean).join(" · ");
    chip.title = [details, row.reason_code].filter(Boolean).join(" — ");
    return chip;
  }

  function renderCoverage(rows) {
    Atlas.clear(coverageTarget);
    const runtimeIds = pageData.runtimes.map((runtime) => runtime.runtime_id);
    const tableRows = pageData.models.map((model) => ({
      model,
      cells: Object.fromEntries(runtimeIds.map((runtimeId) => [
        runtimeId,
        rows.filter((row) => row.model_id === model.model_id && row.runtime_id === runtimeId),
      ])),
    }));
    const columns = [{ label: "Model", value: (row) => row.model.display_name }].concat(
      pageData.runtimes.map((runtime) => ({
        label: runtime.display_name,
        value: (row) => {
          const box = Atlas.element("div", { className: "state-stack" });
          if (!row.cells[runtime.runtime_id].length) {
            box.appendChild(Atlas.element("span", { className: "state-chip state-unknown", text: "filtered" }));
          } else {
            row.cells[runtime.runtime_id].forEach((item) => box.appendChild(stateChip(item)));
          }
          return box;
        },
      })),
    );
    Atlas.renderTable(coverageTarget, columns, tableRows);
  }

  function applyFilters() {
    const selected = Object.fromEntries(
      [...document.querySelectorAll("[data-filter]")].map((node) => [node.dataset.filter, node.value]),
    );
    renderCoverage(pageData.coverage.filter((row) => matchesFilters(row, selected)));
  }

  document.querySelectorAll("[data-filter]").forEach((node) => node.addEventListener("change", applyFilters));
  applyFilters();
  Atlas.renderProfilerCoverage(document.getElementById("profiler-coverage"), pageData.profiler_coverage);
}());
