import { expect, it } from "vitest";

import * as camera from "./focusViewport";

it("keeps the zoom anchor fixed, clamps manual zoom, and resets panning to the automatic camera", () => {
  // Losing the anchor correction, range clamp, or reset would break this interaction contract.
  expect(camera).toHaveProperty("updateManualCamera");
  const frame = { x: 100, y: 50, width: 600, height: 300 };
  const automatic = { zoom: 100, x: 0, y: 0 };
  const zoomed = camera.updateManualCamera(automatic, { type: "zoom", percent: 200, anchor: { x: 200, y: 100 } }, frame);
  expect(zoomed).toEqual({ zoom: 200, x: -200, y: -100 });
  const panned = camera.updateManualCamera(zoomed, { type: "pan", x: 40, y: -20 }, frame);
  expect(panned).toEqual({ zoom: 200, x: -160, y: -120 });
  expect(camera.updateManualCamera(panned, { type: "zoom", percent: 300, anchor: { x: 200, y: 100 } }, frame))
    .toEqual({ zoom: 250, x: -250, y: -175 });
  expect(camera.updateManualCamera(automatic, { type: "zoom", percent: 10, anchor: { x: 200, y: 100 } }, frame))
    .toEqual({ zoom: 50, x: 100, y: 50 });
  expect(camera.updateManualCamera(automatic, { type: "pan", x: 40, y: -20 }, frame)).toEqual(automatic);
  expect(camera.updateManualCamera(panned, { type: "reset" }, frame)).toEqual(automatic);
  expect(automatic).toEqual({ zoom: 100, x: 0, y: 0 });
  // A focused frame can have gutters: use its actual edges, not the whole SVG.
  expect(camera.updateManualCamera(zoomed, { type: "pan", x: 10_000, y: 10_000 }, frame))
    .toEqual({ zoom: 200, x: -100, y: -50 });
  expect(camera.updateManualCamera(zoomed, { type: "pan", x: -10_000, y: -10_000 }, frame))
    .toEqual({ zoom: 200, x: -700, y: -350 });
  expect(camera.updateManualCamera(panned, { type: "zoom", percent: 100, anchor: { x: 200, y: 100 } }, frame))
    .toEqual(automatic);
  expect(camera.updateManualCamera(automatic, { type: "zoom", percent: 50, anchor: { x: -1000, y: -1000 } }, frame))
    .toEqual({ zoom: 50, x: 50, y: 25 });
  expect(camera.updateManualCamera(automatic, { type: "zoom", percent: 50, anchor: { x: 1000, y: 1000 } }, frame))
    .toEqual({ zoom: 50, x: 350, y: 175 });
});
