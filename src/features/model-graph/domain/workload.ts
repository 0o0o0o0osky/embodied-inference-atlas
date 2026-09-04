import type { EditableSymbol } from "./types";

export function workloadOverrides(
  encoded: string | null,
  symbols: readonly EditableSymbol[],
): Record<string, number> {
  const values = Object.fromEntries(
    symbols.map((symbol) => [symbol.symbol, symbol.defaultValue]),
  );
  if (!encoded) return values;
  const known = new Map(symbols.map((symbol) => [symbol.symbol, symbol]));
  encoded.split(",").forEach((part) => {
    const [rawName, rawValue] = part.split("=", 2);
    const name = rawName?.trim();
    const symbol = name ? known.get(name) : undefined;
    const value = Number(rawValue);
    if (
      symbol &&
      Number.isSafeInteger(value) &&
      value >= symbol.minimum &&
      (symbol.maximum === null || value <= symbol.maximum)
    ) {
      values[symbol.symbol] = value;
    }
  });
  return values;
}

export function encodeWorkload(
  overrides: Readonly<Record<string, number>>,
  symbols: readonly EditableSymbol[],
): string | null {
  const changed = symbols.some(
    (symbol) => overrides[symbol.symbol] !== symbol.defaultValue,
  );
  if (!changed) return null;
  return symbols
    .map((symbol) => `${symbol.symbol}=${overrides[symbol.symbol] ?? symbol.defaultValue}`)
    .join(",");
}
