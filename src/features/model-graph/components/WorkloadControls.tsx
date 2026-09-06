import type { ReactNode } from "react";
import type { EditableSymbol } from "../domain/types";
import { IntegerInput } from "../../../components/IntegerInput";

interface WorkloadControlsProps {
  symbols: readonly EditableSymbol[];
  values: Readonly<Record<string, number>>;
  onChange: (symbol: string, value: number) => void;
  onReset: () => void;
  compact?: boolean;
  children?: ReactNode;
}

const SCENARIO_LABELS: Record<string, string> = {
  V: "相机视角", L_PROMPT: "提示词位置", T_ACTION: "动作词元", N_DENOISE: "去噪步数",
};

export function WorkloadControls({
  symbols,
  values,
  onChange,
  onReset,
  compact = false,
  children,
}: WorkloadControlsProps) {
  const defaults = symbols.every(
    (symbol) => values[symbol.symbol] === symbol.defaultValue,
  );
  const form = (
    <section className="graph-workload" aria-labelledby="graph-workload-title">
      <header>
        <div>
          <h3 id="graph-workload-title">{compact ? "场景参数" : "Workload bindings"}</h3>
          {!compact ? <p>Change shape annotations without changing the logical topology.</p> : null}
        </div>
        <button type="button" onClick={onReset} disabled={defaults}>
          {compact ? "恢复默认" : "Restore defaults"}
        </button>
      </header>
      <div className="graph-workload-grid">
        {symbols.map((symbol) => (
          <label key={symbol.symbol}>
            <span>{compact ? SCENARIO_LABELS[symbol.symbol] ?? symbol.label : symbol.label}</span>
            <IntegerInput
              min={symbol.minimum}
              max={symbol.maximum ?? undefined}
              step={1}
              value={values[symbol.symbol] ?? symbol.defaultValue}
              onValueChange={(value) => onChange(symbol.symbol, value)}
            />
            <small>
              {compact ? <>默认 {symbol.defaultValue}，最小 {symbol.minimum}</> : <><code>{symbol.symbol}</code> · default {symbol.defaultValue} · {symbol.minimum === 0 ? "zero allowed" : `minimum ${symbol.minimum}`}</>}
            </small>
          </label>
        ))}
      </div>
      {children}
    </section>
  );
  return compact ? (
    <details className="graph-scenario-editor">
      <summary>场景</summary>
      {form}
    </details>
  ) : form;
}
