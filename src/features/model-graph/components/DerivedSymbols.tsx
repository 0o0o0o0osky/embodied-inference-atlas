import type { DerivedSymbol } from "../domain/types";

export function DerivedSymbols({ symbols }: { symbols: readonly DerivedSymbol[] }) {
  return (
    <dl className="derived-symbols" aria-label="Derived sequence lengths">
      {symbols.map((symbol) => (
        <div key={symbol.symbol}>
          <dt>{symbol.symbol}</dt>
          <dd>{symbol.value === null ? "unresolved" : symbol.value.toLocaleString()}</dd>
          <span>{symbol.label}</span>
        </div>
      ))}
    </dl>
  );
}
