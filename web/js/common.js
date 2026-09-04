(function () {
  "use strict";

  function readPageData() {
    const node = document.getElementById("page-data");
    return node ? JSON.parse(node.textContent) : {};
  }

  function element(tag, options) {
    const node = document.createElement(tag);
    const values = options || {};
    if (values.className) node.className = values.className;
    if (values.text !== undefined && values.text !== null) node.textContent = String(values.text);
    if (values.id) node.id = values.id;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function format(value, digits) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: digits === undefined ? 2 : digits });
    return String(value);
  }

  function groupBy(values, keyFunction) {
    return values.reduce((groups, value) => {
      const key = keyFunction(value);
      (groups[key] = groups[key] || []).push(value);
      return groups;
    }, {});
  }

  function renderTable(target, columns, rows) {
    clear(target);
    const wrapper = element("div", { className: "table-scroll" });
    const table = element("table", { className: "data-table" });
    const head = element("thead");
    const headerRow = element("tr");
    columns.forEach((column) => headerRow.appendChild(element("th", { text: column.label })));
    head.appendChild(headerRow);
    table.appendChild(head);
    const body = element("tbody");
    rows.forEach((row) => {
      const tr = element("tr");
      columns.forEach((column) => {
        const td = element("td");
        const value = typeof column.value === "function" ? column.value(row) : row[column.value];
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = format(value, column.digits);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    target.appendChild(wrapper);
  }

  function chart(target, option) {
    if (!window.echarts) {
      target.appendChild(element("p", { className: "empty-state", text: "Chart library unavailable." }));
      return null;
    }
    const instance = window.echarts.init(target, null, { renderer: "svg" });
    instance.setOption(option);
    window.addEventListener("resize", () => instance.resize());
    return instance;
  }

  function addEmptyState(target, message) {
    target.appendChild(element("p", { className: "empty-state", text: message }));
  }

  function renderProfilerCoverage(target, coverage) {
    clear(target);
    if (!coverage.nsys) addEmptyState(target, "Nsys evidence: not collected in this data slice");
    if (!coverage.ncu) addEmptyState(target, "NCU evidence: not collected in this data slice");
  }

  window.Atlas = Object.freeze({
    readPageData,
    element,
    clear,
    format,
    groupBy,
    renderTable,
    chart,
    addEmptyState,
    renderProfilerCoverage,
  });
}());
