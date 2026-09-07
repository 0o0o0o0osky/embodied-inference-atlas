import { createRoot } from "react-dom/client";

import { AtlasApp } from "./app/AtlasApp";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/model-graph.css";
import "./styles/runtime.css";
import "./styles/roofline.css";
import "./styles/timeline.css";
import "./styles/performance.css";
import "./features/runtime/components/analysisNavigation.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Atlas application root is missing");
}

createRoot(root).render(<AtlasApp />);
