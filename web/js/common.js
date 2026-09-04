(function () {
  "use strict";

  function readPageData() {
    const node = document.getElementById("page-data");
    return node ? JSON.parse(node.textContent) : {};
  }

  window.Atlas = Object.freeze({ readPageData });
}());
