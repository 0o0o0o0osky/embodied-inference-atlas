export type LinearTensorRole = "input" | "weight" | "output" | "internal-read" | "internal-write";

export interface LinearTrafficComponent {
  tensorRef: string;
  byte: number;
  role: LinearTensorRole;
}

export interface InternalExclusion {
  tensorRef: string;
  evidenceRef: string;
}

export function linearBoundaryTraffic(
  components: readonly LinearTrafficComponent[],
  exclusions: readonly InternalExclusion[],
): { totalByte: number; excludedByte: number } {
  const excluded = new Set<string>();
  exclusions.forEach((item) => {
    if (!item.tensorRef || !item.evidenceRef) throw new Error("an internal exclusion requires tensor and evidence refs");
    const roles = new Set(components.filter((component) => component.tensorRef === item.tensorRef).map((item) => item.role));
    if (!roles.has("internal-read") || !roles.has("internal-write")) {
      throw new Error("an excluded internal tensor must have producer-write and consumer-read traffic");
    }
    excluded.add(item.tensorRef);
  });
  let totalByte = 0;
  let excludedByte = 0;
  components.forEach((component) => {
    if (!component.tensorRef || !Number.isFinite(component.byte) || component.byte < 0) {
      throw new Error("traffic components require a tensor ref and finite nonnegative bytes");
    }
    const internal = component.role === "internal-read" || component.role === "internal-write";
    if (internal && excluded.has(component.tensorRef)) excludedByte += component.byte;
    else totalByte += component.byte;
  });
  return { totalByte, excludedByte };
}
