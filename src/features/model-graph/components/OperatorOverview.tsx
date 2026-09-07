import { expressionLabel } from "../domain/expression";
import type { MaterializedPort, OperatorDetail } from "../domain/types";
import { useModelText } from "../presentation/ModelDisplay";
import "./operatorOverview.css";

function TensorShapes({ ports, direction }: { ports: readonly MaterializedPort[]; direction: string }) {
  const t = useModelText();
  return <dl className="operator-tensor-shapes">{ports.map(({ port, tensor }) => <div key={port}>
    <dt className={ports.length === 1 && t(port) === direction ? "visually-hidden" : undefined}>{t(port)}</dt>
    <dd>{tensor ? <code>[{tensor.shape.map((value) => value?.toLocaleString() ?? "?").join(" × ")}]</code> : "形状待补充"}</dd>
  </div>)}</dl>;
}

function compactCount(value: number | null) {
  if (value === null) return "待补充";
  const scale = value >= 1e9 ? [1e9, "G"] as const : value >= 1e6 ? [1e6, "M"] as const
    : value >= 1e3 ? [1e3, "k"] as const : [1, ""] as const;
  return `${(value / scale[0]).toLocaleString(undefined, { maximumFractionDigits: 2 })}${scale[1]}`;
}

export function OperatorOverview({ operator }: { operator: OperatorDetail }) {
  const t = useModelText();
  const bindings = Object.entries(operator.bindings);
  const ports = [...operator.inputs.map((port) => ({ ...port, direction: "输入" })),
    ...operator.outputs.map((port) => ({ ...port, direction: "输出" }))];
  const repeated = (operator.effectiveRepeat ?? 0) > 1;
  return <div className="operator-overview">
    <div className="operator-overview-formula">
      <span>{t(operator.definitionLabel)}</span>
      <code>{operator.formula || "计算公式待补充"}</code>
    </div>
    <div className="operator-tensor-flow">
      <section><h3>输入</h3>{operator.inputs.length ? <TensorShapes ports={operator.inputs} direction="输入" /> : <p>输入形状待补充</p>}</section>
      <span className="operator-tensor-arrow" aria-hidden="true">→</span>
      <section><h3>输出</h3>{operator.outputs.length ? <TensorShapes ports={operator.outputs} direction="输出" /> : <p>输出形状待补充</p>}</section>
    </div>
    <dl className="operator-overview-counts">
      <div><dt>本次推理的逻辑调用</dt><dd>{operator.effectiveRepeat?.toLocaleString() ?? "待补充"}{operator.effectiveRepeat !== null ? " 次" : ""}</dd></div>
      {operator.analysis.map((metric) => <div key={metric.metric}>
        <dt>单次{t(metric.metric) === "FLOPs" ? "计算量" : t(metric.metric)}</dt>
        <dd title={metric.value?.toLocaleString()}>{compactCount(metric.value)}{metric.value !== null ? ` ${t(metric.unit)}` : ""}</dd>
      </div>)}
    </dl>
    {ports.some((port) => port.tensor?.axes.length) || bindings.length ? <details className="operator-overview-detail">
      <summary>形状与参数</summary>
      <table><thead><tr><th>张量</th><th>维度表达式</th></tr></thead><tbody>
        {ports.filter((port) => port.tensor).map(({ port, tensor, direction }) => <tr key={`${direction}/${port}`}>
          <th scope="row">{direction} · {t(port)}</th>
          <td><code>{tensor!.axes.length ? tensor!.axes.map((axis) => expressionLabel(axis.expression)).join(" × ") : "标量"}</code></td>
        </tr>)}
      </tbody></table>
      {bindings.length ? <dl className="operator-symbol-values">{bindings.map(([symbol, value]) => <div key={symbol}>
        <dt><code>{symbol}</code></dt><dd>{value?.toLocaleString() ?? "待补充"}</dd>
      </div>)}</dl> : null}
      {operator.unresolvedSymbols.length ? <p>待填写：{operator.unresolvedSymbols.join("、")}</p> : null}
    </details> : null}
    {repeated ? <details className="operator-overview-detail">
      <summary>调用次数</summary>
      <dl className="operator-repeat-factors">
        <div><dt>阶段重复</dt><dd>{operator.stageRepeat ?? "待补充"}</dd></div>
        <div><dt>完整模块</dt><dd>{operator.moduleRepeat ?? "待补充"}</dd></div>
        {operator.tailRepeat ? <div><dt>含此算子的尾段</dt><dd>{operator.tailRepeat}</dd></div> : null}
        <div><dt>模块内调用</dt><dd>{operator.intrinsicRepeat ?? "待补充"}</dd></div>
      </dl>
      <code>{operator.stageRepeat ?? "?"} × ({operator.moduleRepeat ?? "?"}{operator.tailRepeat ? ` + ${operator.tailRepeat}` : ""}) × {operator.intrinsicRepeat ?? "?"} = {operator.effectiveRepeat?.toLocaleString()}</code>
    </details> : null}
  </div>;
}
