export type CrossViewEntityKey =
  | `logical:${string}`
  | `stage:${string}/${string}`
  | `runtime-group:${string}/${string}`
  | `kernel:${string}/${string}`
  | `legacy-component:${string}`;

export type ParsedEntityKey =
  | { kind: "logical"; logicalRef: string }
  | { kind: "stage"; modelGraphId: string; stageId: string }
  | { kind: "runtime-group"; realizationId: string; executionGroupId: string }
  | { kind: "kernel"; captureId: string; kernelObservationId: string }
  | { kind: "legacy-component"; pointId: string };

const encode = encodeURIComponent;

function pair(
  prefix: "stage" | "runtime-group" | "kernel",
  first: string,
  second: string,
): CrossViewEntityKey {
  return `${prefix}:${encode(first)}/${encode(second)}` as CrossViewEntityKey;
}

export function logicalEntity(ref: string): CrossViewEntityKey {
  return `logical:${encode(ref)}`;
}

export function stageEntity(modelGraphId: string, stageId: string): CrossViewEntityKey {
  return pair("stage", modelGraphId, stageId);
}

export function runtimeGroupEntity(realizationId: string, executionGroupId: string): CrossViewEntityKey {
  return pair("runtime-group", realizationId, executionGroupId);
}

export function kernelEntity(captureId: string, kernelObservationId: string): CrossViewEntityKey {
  return pair("kernel", captureId, kernelObservationId);
}

export function legacyComponentEntity(pointId: string): CrossViewEntityKey {
  return `legacy-component:${encode(pointId)}`;
}

export function parseEntityKey(entity: string | null): ParsedEntityKey | null {
  if (!entity) return null;
  if (!entity.includes(":")) return { kind: "logical", logicalRef: entity };
  const split = entity.indexOf(":");
  const prefix = entity.slice(0, split);
  const payload = entity.slice(split + 1);
  try {
    if (prefix === "logical") return { kind: "logical", logicalRef: decodeURIComponent(payload) };
    if (prefix === "legacy-component") {
      return { kind: "legacy-component", pointId: decodeURIComponent(payload) };
    }
    if (prefix === "stage" || prefix === "runtime-group" || prefix === "kernel") {
      const slash = payload.indexOf("/");
      if (slash < 1 || slash === payload.length - 1) return null;
      const first = decodeURIComponent(payload.slice(0, slash));
      const second = decodeURIComponent(payload.slice(slash + 1));
      if (prefix === "stage") return { kind: prefix, modelGraphId: first, stageId: second };
      if (prefix === "runtime-group") {
        return { kind: prefix, realizationId: first, executionGroupId: second };
      }
      return { kind: prefix, captureId: first, kernelObservationId: second };
    }
  } catch {
    return null;
  }
  return null;
}

export function logicalRefFromEntity(entity: string | null): string | null {
  const parsed = parseEntityKey(entity);
  if (parsed?.kind !== "logical") return null;
  // Task 5 briefly emitted attention component suffixes as if they were
  // logical refs. Accept those old deep links, but resolve them to the real
  // Task 2 operator ref; new links never emit the suffix.
  return parsed.logicalRef.replace(/#(?:score|softmax|value|composite)$/, "");
}
