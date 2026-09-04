import { createRoot } from "react-dom/client";

import { AtlasApp } from "./app/AtlasApp";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/model-graph.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Atlas application root is missing");
}

createRoot(root).render(<AtlasApp />);
