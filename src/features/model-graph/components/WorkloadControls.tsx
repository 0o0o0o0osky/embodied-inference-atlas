import type { EditableSymbol } from "../domain/types";

interface WorkloadControlsProps {
  symbols: readonly EditableSymbol[];
  values: Readonly<Record<string, number>>;
  onChange: (symbol: string, value: number) => void;
  onReset: () => void;
}

export function WorkloadControls({
  symbols,
  values,
  onChange,
  onReset,
}: WorkloadControlsProps) {
  const defaults = symbols.every(
    (symbol) => values[symbol.symbol] === symbol.defaultValue,
  );
  return (
    <section className="graph-workload" aria-labelledby="graph-workload-title">
      <header>
        <div>
          <h3 id="graph-workload-title">Workload bindings</h3>
          <p>Change shape annotations without changing the logical topology.</p>
        </div>
        <button type="button" onClick={onReset} disabled={defaults}>
          Restore defaults
        </button>
      </header>
      <div className="graph-workload-grid">
        {symbols.map((symbol) => (
          <label key={symbol.symbol}>
            <span>{symbol.label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={symbol.minimum}
              step={1}
              value={values[symbol.symbol] ?? symbol.defaultValue}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isSafeInteger(value) && value >= symbol.minimum) {
                  onChange(symbol.symbol, value);
                }
              }}
            />
            <small>
              <code>{symbol.symbol}</code> · default {symbol.defaultValue} · {symbol.minimum === 0 ? "zero allowed" : `minimum ${symbol.minimum}`}
            </small>
          </label>
        ))}
      </div>
    </section>
  );
}
