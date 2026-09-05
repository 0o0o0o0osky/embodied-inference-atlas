import { useEffect, useState } from "react";

import { AtlasHeader } from "../components/AtlasHeader";
import { ModelCatalog } from "../features/catalog/ModelCatalog";
import { Workbench } from "../features/workbench/Workbench";
import type { AtlasData } from "../types/atlas";
import { loadAtlasData } from "./data";
import { useRouteState } from "./routes";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AtlasData }
  | { kind: "error"; message: string };

export function AtlasApp() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [route, navigate] = useRouteState();

  useEffect(() => {
    let active = true;
    loadAtlasData()
      .then((data) => {
        if (active) {
          setLoadState({ kind: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadState({ kind: "error", message });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (route.model === "pi0" && route.tab === "logical") {
      document.title = "Pi0 模型结构 — Atlas";
      return;
    }
    if (route.model === "pi0" && route.tab === "runtime") {
      document.title = "Pi0 推理栈实现 — Atlas";
      return;
    }
    const view = route.model ? `${route.model} / ${route.tab}` : "Model register";
    document.title = `${view} — Embodied Inference Atlas`;
  }, [route.model, route.tab]);

  if (loadState.kind === "loading") {
    return <main className="boot-state">Reading the validated Atlas snapshot…</main>;
  }

  if (loadState.kind === "error") {
    return (
      <main className="load-failure">
        <p className="failure-code">Snapshot unavailable</p>
        <h1>The generated data could not be opened.</h1>
        <p>{loadState.message}</p>
        <p>
          Serve the <code>site/</code> directory with the documented local-only
          command and reload this address. Browsers commonly block JSON
          requests from a direct <code>file://</code> page.
        </p>
      </main>
    );
  }

  const selectedModel = loadState.data.datasets.models.find(
    (model) => model.model_id === route.model,
  );

  return (
    <div className={`atlas-frame${route.model === "pi0" && (route.tab === "logical" || route.tab === "runtime") ? " atlas-frame--pi0" : ""}`}>
      <AtlasHeader data={loadState.data} route={route} navigate={navigate} />
      {route.model && selectedModel ? (
        <Workbench
          data={loadState.data}
          model={selectedModel}
          route={route}
          navigate={navigate}
        />
      ) : (
        <ModelCatalog
          data={loadState.data}
          route={route}
          navigate={navigate}
          missingModelId={route.model && !selectedModel ? route.model : null}
        />
      )}
    </div>
  );
}
