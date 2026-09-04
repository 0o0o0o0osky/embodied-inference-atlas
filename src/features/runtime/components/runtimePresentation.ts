import type { LogicalDag } from "../../model-graph/domain/types";
import type { LogicalTarget, RepeatSelector } from "../domain/types";

export function humanizeRuntime(value: string) {
  return value.replaceAll("_", " ");
}

export function shortLogicalRef(ref: string) {
  const parts = ref.split("/");
  return parts.slice(-2).join(" / ");
}

function selectorLabel(selector: RepeatSelector, dag: LogicalDag) {
  const scope = dag.scopes.find((item) => item.id === selector.scopeRef);
  const repeat = scope?.repeat ?? null;
  const isDenoise = scope?.kind === "denoise" || selector.scopeRef.endsWith("action-flow-loop");
  const noun = isDenoise ? "denoise" : "layers";
  if (selector.selection === "all") return repeat ? `${noun} ×${repeat}` : `${noun}: all`;
  const indices = [...selector.indices].sort((a, b) => a - b);
  if (repeat && indices.length === 1 && indices[0] === repeat - 1) return `L${repeat} only`;
  if (indices.length > 1 && indices.every((value, index) => value === indices[0]! + index)) {
    return `${noun} ${indices[0]}–${indices.at(-1)}`;
  }
  return `${noun} ${indices.join(", ")}`;
}

export function targetRepeatLabel(target: LogicalTarget, dag: LogicalDag) {
  return target.repeatSelectors.map((selector) => selectorLabel(selector, dag)).join(" · ");
}
