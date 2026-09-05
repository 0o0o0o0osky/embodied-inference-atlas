import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { expressionLabel } from "../domain/expression";
import type { MaterializedPort, OperatorDetail } from "../domain/types";
import { OperatorVisualizer } from "../visualizers/OperatorVisualizer";
import { useModelText } from "../presentation/ModelDisplay";

const tabs = [
  { id: "overview", label: "概览" },
  { id: "calculation", label: "计算过程" },
  { id: "roofline", label: "Roofline" },
  { id: "kernel", label: "实测 Kernel" },
] as const;

export type OperatorDrawerTab = (typeof tabs)[number]["id"];

export interface OperatorDrawerProps {
  operator: OperatorDetail;
  resetKey: string;
  onClose: () => void;
  evidenceLinks?: { roofline: ReactNode; kernel: ReactNode };
}

function ShapeRows({ ports, symbolic = false }: { ports: readonly MaterializedPort[]; symbolic?: boolean }) {
  const t = useModelText();
  return ports.length ? ports.map((port) => (
    <span className="drawer-shape" key={port.port}>
      <span>{t(port.port)}</span>
      <code>[{port.tensor
        ? (symbolic
          ? port.tensor.axes.map((axis) => expressionLabel(axis.expression))
          : port.tensor.shape.map((value) => value?.toLocaleString() ?? "?"))
          .join(" × ")
        : t("unresolved")}]</code>
    </span>
  )) : <span>无已声明张量</span>;
}

function OperatorOverview({ operator }: { operator: OperatorDetail }) {
  const t = useModelText();
  return (
    <>
      <dl className="drawer-facts">
        <div><dt>公式</dt><dd><code>{operator.formula}</code></dd></div>
        <div>
          <dt>重复</dt>
          <dd>
            {operator.stageRepeat ?? "?"} 阶段 × ({operator.moduleRepeat ?? "?"} 完整块
            {operator.tailRepeat ? ` + ${operator.tailRepeat} 必需尾段` : ""}) × {operator.intrinsicRepeat ?? "?"} 算子内重复
            <span className="drawer-repeat-total">共 {operator.effectiveRepeat?.toLocaleString() ?? "?"} 次逻辑调用</span>
            {operator.tailRepeat ? <p>L18 尾段仅执行生成 K/V 所需的算子，不执行注意力、输出投影或 FFN。</p> : null}
            {operator.operatorId === "select-action-rows" ? <p>逻辑行选择：保留末尾动作词元行供速度投影使用，无算术计算。</p> : null}
          </dd>
        </div>
        <div><dt>输入</dt><dd><ShapeRows ports={operator.inputs} /></dd></div>
        <div><dt>输出</dt><dd><ShapeRows ports={operator.outputs} /></dd></div>
      </dl>
      <details className="drawer-technical-details">
        <summary>符号、定义来源与分析</summary>
        <p>逻辑定义：{t(operator.definitionLabel)} · <code>{operator.definitionId}</code></p>
        <p><code>{operator.ref}</code></p>
        <p>类别：{t(operator.category)}</p>
        <h3>符号形状</h3>
        <ShapeRows ports={operator.inputs} symbolic />
        <ShapeRows ports={operator.outputs} symbolic />
        <h3>算子参数</h3>
        <p><code>{Object.entries(operator.bindings).map(([symbol, value]) => `${symbol} = ${value ?? "?"}`).join(" · ") || "无已声明参数"}</code></p>
        {operator.unresolvedSymbols.length ? <p>未解析符号：{operator.unresolvedSymbols.join(", ")}</p> : null}
        <h3>逻辑分析</h3>
        {operator.analysis.length ? operator.analysis.map((metric) => (
          <p key={metric.metric}>
            <strong>{t(metric.metric)}</strong><br />
            单次：{metric.value?.toLocaleString() ?? t("unresolved")} {t(metric.unit)}；
            图内总计：{metric.value === null || operator.effectiveRepeat === null
              ? t("unresolved") : (metric.value * operator.effectiveRepeat).toLocaleString()} {t(metric.unit)}<br />
            {t(metric.scope)}
          </p>
        )) : <p>此算子没有已声明的分析计数。</p>}
        <p>以上为逻辑图计数。运行时可能增加或消除工作；这些计数不代表实测耗时。</p>
      </details>
    </>
  );
}

// Controlled presentation keeps panel selection testable without a browser environment.
export function OperatorDrawerView({
  operator, resetKey, onClose, evidenceLinks, activeTab, onTabChange,
}: OperatorDrawerProps & {
  activeTab: OperatorDrawerTab;
  onTabChange: (tab: OperatorDrawerTab) => void;
}) {
  const t = useModelText();
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
      : event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : null;
    if (nextIndex === null) return;
    event.preventDefault();
    onTabChange(tabs[nextIndex]!.id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  }

  return (
    <aside className="operator-inspector operator-drawer" aria-labelledby="operator-title">
      <header>
        <button type="button" className="operator-inspector-close" onClick={onClose}>返回完整模型</button>
        <h2 id="operator-title">{t(operator.label)}</h2>
      </header>
      <div className="operator-drawer-tabs" role="tablist" aria-label="算子详情">
        {tabs.map((tab, index) => (
          <button
            type="button" role="tab" key={tab.id} id={`operator-tab-${tab.id}`}
            aria-selected={activeTab === tab.id} aria-controls={`operator-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)} onKeyDown={(event) => moveTab(event, index)}
          >{tab.label}</button>
        ))}
      </div>
      <section
        className="operator-drawer-panel" role="tabpanel" id={`operator-panel-${activeTab}`}
        aria-labelledby={`operator-tab-${activeTab}`} data-panel={activeTab} tabIndex={0}
      >
        {activeTab === "overview" ? <OperatorOverview operator={operator} />
          : activeTab === "calculation" ? <OperatorVisualizer operator={operator} resetKey={resetKey} />
          : activeTab === "roofline" ? (
            <div className="drawer-availability">
              <h3>当前抽屉未绑定精确 Roofline 证据</h3>
              <p>逻辑公式不能单独确定 Roofline 点位。前往分析页核对工作负载、精度、硬件与统计口径。</p>
              {evidenceLinks?.roofline}
            </div>
          ) : (
            <div className="drawer-availability">
              <h3>当前抽屉未绑定精确实测 Kernel</h3>
              <p>逻辑算子不等同于单个 Kernel。前往性能页检查运行时映射与采集证据；保留当前逻辑选择不代表已匹配观测。</p>
              {evidenceLinks?.kernel}
            </div>
          )}
      </section>
    </aside>
  );
}

export function OperatorDrawer(props: OperatorDrawerProps) {
  const [activeTab, setActiveTab] = useState<OperatorDrawerTab>("overview");
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props.onClose]);
  return <OperatorDrawerView {...props} activeTab={activeTab} onTabChange={setActiveTab} />;
}
