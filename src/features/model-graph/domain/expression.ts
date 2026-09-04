import type { Expr } from "./types";

export class ExpressionError extends Error {
  readonly symbol: string | null;

  constructor(message: string, symbol: string | null = null) {
    super(message);
    this.name = "ExpressionError";
    this.symbol = symbol;
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExpressionError(`${label} must be a finite number`);
  }
  return value;
}

export function nonNegativeInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ExpressionError(`${label} must be a non-negative safe integer`);
  }
  return number;
}

export function evaluateExpression(
  expression: Expr,
  bindings: Readonly<Record<string, number | null>>,
): number {
  if (typeof expression === "number") return finiteNumber(expression, "expression");
  if ("symbol" in expression) {
    const value = bindings[expression.symbol];
    if (value === undefined || value === null) {
      throw new ExpressionError(`unknown symbol: ${expression.symbol}`, expression.symbol);
    }
    return finiteNumber(value, `binding ${expression.symbol}`);
  }
  const values = expression.args.map((argument) => evaluateExpression(argument, bindings));
  let result: number;
  switch (expression.op) {
    case "add":
      if (values.length < 2) throw new ExpressionError("add requires at least two arguments");
      result = values.reduce((total, value) => total + value, 0);
      break;
    case "sub":
      if (values.length !== 2) throw new ExpressionError("sub requires exactly two arguments");
      result = values[0]! - values[1]!;
      break;
    case "mul":
      if (values.length < 2) throw new ExpressionError("mul requires at least two arguments");
      result = values.reduce((total, value) => total * value, 1);
      break;
    case "div":
      if (values.length !== 2) throw new ExpressionError("div requires exactly two arguments");
      if (values[1] === 0) throw new ExpressionError("division by zero");
      result = values[0]! / values[1]!;
      break;
    case "ceil_div":
      if (values.length !== 2) throw new ExpressionError("ceil_div requires exactly two arguments");
      if (values[1] === 0) throw new ExpressionError("division by zero");
      result = Math.ceil(values[0]! / values[1]!);
      break;
  }
  return finiteNumber(result, "expression result");
}

export function expressionSymbols(expression: Expr): readonly string[] {
  if (typeof expression === "number") return [];
  if ("symbol" in expression) return [expression.symbol];
  return [...new Set(expression.args.flatMap(expressionSymbols))];
}

export function expressionLabel(expression: Expr): string {
  if (typeof expression === "number") return String(expression);
  if ("symbol" in expression) return expression.symbol;
  const args = expression.args.map(expressionLabel);
  switch (expression.op) {
    case "add":
      return `(${args.join(" + ")})`;
    case "sub":
      return `(${args[0]} - ${args[1]})`;
    case "mul":
      return `(${args.join(" × ")})`;
    case "div":
      return `(${args[0]} / ${args[1]})`;
    case "ceil_div":
      return `ceil(${args[0]} / ${args[1]})`;
  }
}
