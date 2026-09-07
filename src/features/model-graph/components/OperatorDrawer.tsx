import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { OperatorDetail } from "../domain/types";
import { OperatorVisualizer } from "../visualizers/OperatorVisualizer";
import { OperatorOverview } from "./OperatorOverview";
import { useModelText } from "../presentation/ModelDisplay";

const tabs = [
  { id: "overview", label: "概览" },
  { id: "calculation", label: "计算过程" },
  { id: "roofline", label: "Roofline" },
] as const;

export type OperatorDrawerTab = (typeof tabs)[number]["id"];

export interface OperatorDrawerProps {
  operator: OperatorDetail;
  resetKey: string;
  onClose: () => void;
  rooflineLink?: ReactNode;
  rooflinePanel?: ReactNode;
}

// Controlled presentation keeps panel selection testable without a browser environment.
export function OperatorDrawerView({
  operator, resetKey, onClose, rooflineLink, rooflinePanel, activeTab, onTabChange,
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
          : rooflinePanel ?? (
            <div className="drawer-availability">
              <h3>此算子的 Roofline 待补充</h3>
              <p>需要当前形状的计算量、读写量与硬件上限。</p>
              {rooflineLink}
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
