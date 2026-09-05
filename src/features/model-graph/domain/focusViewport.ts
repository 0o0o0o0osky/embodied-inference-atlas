import type { LogicalDag, LogicalLayout, LogicalRef, ScopeBox } from "./types";

export interface GraphViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scopeId: string | null;
}

export interface ManualCamera {
  zoom: number;
  x: number;
  y: number;
}

export type ManualCameraAction =
  | { type: "zoom"; percent: number; anchor: { x: number; y: number } }
  | { type: "pan"; x: number; y: number }
  | { type: "reset" };

// Coordinates are in the outer SVG frame; the authored layout stays untouched.
export function updateManualCamera(camera: ManualCamera, action: ManualCameraAction): ManualCamera {
  if (action.type === "reset") return { zoom: 100, x: 0, y: 0 };
  if (action.type === "pan") return camera.zoom > 100
    ? { ...camera, x: camera.x + action.x, y: camera.y + action.y }
    : camera;
  const zoom = Math.max(50, Math.min(250, Math.round(action.percent / 10) * 10));
  const ratio = zoom / camera.zoom;
  return {
    zoom,
    x: action.anchor.x - (action.anchor.x - camera.x) * ratio,
    y: action.anchor.y - (action.anchor.y - camera.y) * ratio,
  };
}

const FOCUS_PADDING = 48;

function overview(layout: LogicalLayout): GraphViewport {
  return { x: 0, y: 0, width: layout.width, height: layout.height, scopeId: null };
}

function smallestScope(dag: LogicalDag, layout: LogicalLayout, ref: LogicalRef): ScopeBox | null {
  const scopeBoxes = new Map(layout.scopeBoxes.map((box) => [box.scopeId, box]));
  return dag.scopes
    .filter((scope) => scope.nodeRefs.includes(ref))
    .map((scope) => scopeBoxes.get(scope.id))
    .filter((box): box is ScopeBox => Boolean(box))
    .sort((first, second) => first.width * first.height - second.width * second.height)[0] ?? null;
}

function fitToCanvas(
  bounds: { left: number; top: number; right: number; bottom: number },
  layout: LogicalLayout,
) {
  const aspectRatio = layout.width / layout.height;
  let width = Math.min(layout.width, bounds.right - bounds.left + FOCUS_PADDING * 2);
  let height = Math.min(layout.height, bounds.bottom - bounds.top + FOCUS_PADDING * 2);

  if (width / height < aspectRatio) width = Math.min(layout.width, height * aspectRatio);
  else height = Math.min(layout.height, width / aspectRatio);

  if (width === layout.width) height = layout.height;
  if (height === layout.height) width = layout.width;

  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    x: Math.max(0, Math.min(layout.width - width, centerX - width / 2)),
    y: Math.max(0, Math.min(layout.height - height, centerY - height / 2)),
    width,
    height,
  };
}

export function resolveFocusViewport(
  dag: LogicalDag,
  layout: LogicalLayout,
  selectedRef: LogicalRef | null,
  boundary: "canvas" | "stage" = "canvas",
): GraphViewport {
  if (!selectedRef) return overview(layout);
  const selectedNode = dag.nodes.get(selectedRef);
  if (!selectedNode || selectedNode.kind !== "operator") return overview(layout);

  const scopeBox = smallestScope(dag, layout, selectedRef);
  if (!scopeBox) return overview(layout);

  const contextRefs = dag.edges
    .filter((edge) => edge.source === selectedRef || edge.target === selectedRef)
    .flatMap((edge) => [edge.source, edge.target]);
  const contextBoxes = contextRefs
    .map((ref) => layout.nodeBoxes.get(ref))
    .filter((box): box is NonNullable<typeof box> => Boolean(box));
  const bounds = contextBoxes.reduce(
    (current, box) => ({
      left: Math.min(current.left, box.x),
      top: Math.min(current.top, box.y),
      right: Math.max(current.right, box.x + box.width),
      bottom: Math.max(current.bottom, box.y + box.height),
    }),
    {
      left: scopeBox.x,
      top: scopeBox.y,
      right: scopeBox.x + scopeBox.width,
      bottom: scopeBox.y + scopeBox.height,
    },
  );
  const viewport = fitToCanvas(bounds, layout);
  const stage = layout.stageBoxes.find((box) => box.stageId === selectedNode.stageId);
  // Keep local context inside its stage gutter. Cross-stage dependencies retain
  // the wider camera, and the authored scene/coordinates are never relaid out.
  if (boundary === "stage" && stage && bounds.left >= stage.x && bounds.right <= stage.x + stage.width) {
    const left = Math.max(0, stage.x - 8);
    const right = Math.min(layout.width, stage.x + stage.width + 8);
    viewport.width = Math.min(viewport.width, right - left);
    viewport.x = Math.max(left, Math.min(right - viewport.width, viewport.x));
  }
  return { ...viewport, scopeId: scopeBox.scopeId };
}
