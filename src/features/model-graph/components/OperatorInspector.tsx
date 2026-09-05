import { expressionLabel } from "../domain/expression";
import type { MaterializedPort, OperatorDetail } from "../domain/types";
import { OperatorVisualizer } from "../visualizers/OperatorVisualizer";

function symbolicShape(port: MaterializedPort) {
  return port.tensor?.axes.map((axis) => expressionLabel(axis.expression)).join(" × ") ?? "unresolved";
}

function concreteShape(port: MaterializedPort) {
  return port.tensor?.shape.map((value) => value?.toLocaleString() ?? "?").join(" × ") ?? "unresolved";
}

function TensorGroup({ title, ports }: { title: string; ports: readonly MaterializedPort[] }) {
  return (
    <section className="inspector-tensors">
      <h3>{title}</h3>
      {ports.length ? ports.map((port) => (
        <div className="inspector-tensor" key={`${title}-${port.port}`}>
          <strong>{port.port}</strong>
          <span>symbolic [{symbolicShape(port)}]</span>
          <span className="is-concrete">concrete [{concreteShape(port)}]</span>
        </div>
      )) : <p className="inspector-empty">No declared tensors.</p>}
    </section>
  );
}

export function OperatorInspector({
  operator,
  resetKey,
  onClose,
}: {
  operator: OperatorDetail;
  resetKey: string;
  onClose: () => void;
}) {
  return (
    <aside className="operator-inspector" aria-live="polite" aria-labelledby="operator-title">
      <header>
        <p>{operator.category.replaceAll("_", " ")} / {operator.definitionId}</p>
        <button type="button" className="operator-inspector-close" onClick={onClose} aria-label="Close operator inspector">
          Close focus
        </button>
        <h2 id="operator-title">{operator.label}</h2>
        <code>{operator.formula}</code>
      </header>

      {operator.tailRepeat ? (
        <p className="tail-semantics">
          This operator runs in {operator.moduleRepeat ?? "?"} full prefix blocks and the required L18 K/V tail.
          The tail does not run attention, output projection, or feed-forward work.
        </p>
      ) : null}

      {operator.operatorId === "select-action-rows" ? (
        <p className="operator-semantics">
          This is a logical row selection, not arithmetic. It keeps the final action-token rows
          before the velocity projection.
        </p>
      ) : null}

      {operator.unresolvedSymbols.length ? (
        <p className="binding-warning">
          Unresolved symbols: {operator.unresolvedSymbols.join(", ")}.
        </p>
      ) : null}

      <TensorGroup title="Input shapes" ports={operator.inputs} />
      <TensorGroup title="Output shapes" ports={operator.outputs} />

      <section className="inspector-analysis">
        <h3>Logical analysis</h3>
        {operator.analysis.length ? (
          <dl>
            {operator.analysis.map((metric) => {
              const aggregate =
                metric.value === null || operator.effectiveRepeat === null
                  ? null
                  : metric.value * operator.effectiveRepeat;
              return (
                <div key={metric.metric}>
                  <dt>{metric.metric.replaceAll("_", " ")}</dt>
                  <dd>
                    Per invocation: {metric.value?.toLocaleString() ?? "unresolved"} {metric.unit}
                  </dd>
                  <dd>
                    Required graph total: {aggregate?.toLocaleString() ?? "unresolved"} {metric.unit}
                  </dd>
                  <small>{metric.scope}</small>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="inspector-empty">No analytical count is declared for this operator.</p>
        )}
        <p className="repeat-factors">
          Repeat factors: stage {operator.stageRepeat ?? "?"} × {operator.moduleRepeat ?? "?"} full
          {operator.tailRepeat ? ` + ${operator.tailRepeat} required tail` : ""} × intrinsic {operator.intrinsicRepeat ?? "?"}.
          Runtime overlays may record additional or eliminated work later.
        </p>
      </section>

      <OperatorVisualizer operator={operator} resetKey={resetKey} />
    </aside>
  );
}
