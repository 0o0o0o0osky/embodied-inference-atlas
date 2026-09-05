import type { DerivedSymbol } from "../domain/types";

export function DerivedSymbols({ symbols, compact = false }: { symbols: readonly DerivedSymbol[]; compact?: boolean }) {
  return (
    <dl className="derived-symbols" aria-label={compact ? "派生序列长度" : "Derived sequence lengths"}>
      {symbols.map((symbol) => (
        <div key={symbol.symbol}>
          <dt>{symbol.symbol}</dt>
          <dd>{symbol.value === null ? (compact ? "未解析" : "unresolved") : symbol.value.toLocaleString()}</dd>
          {!compact ? <span>{symbol.label}</span> : null}
        </div>
      ))}
    </dl>
  );
}
