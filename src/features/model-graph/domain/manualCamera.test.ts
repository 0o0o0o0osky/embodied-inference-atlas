import { expect, it } from "vitest";

import * as camera from "./focusViewport";

it("keeps the zoom anchor fixed, clamps manual zoom, and resets panning to the automatic camera", () => {
  // Losing the anchor correction, range clamp, or reset would break this interaction contract.
  expect(camera).toHaveProperty("updateManualCamera");
  const automatic = { zoom: 100, x: 0, y: 0 };
  const zoomed = camera.updateManualCamera(automatic, { type: "zoom", percent: 200, anchor: { x: 200, y: 100 } });
  expect(zoomed).toEqual({ zoom: 200, x: -200, y: -100 });
  const panned = camera.updateManualCamera(zoomed, { type: "pan", x: 40, y: -20 });
  expect(panned).toEqual({ zoom: 200, x: -160, y: -120 });
  expect(camera.updateManualCamera(panned, { type: "zoom", percent: 300, anchor: { x: 200, y: 100 } }))
    .toEqual({ zoom: 250, x: -250, y: -175 });
  expect(camera.updateManualCamera(automatic, { type: "zoom", percent: 10, anchor: { x: 200, y: 100 } }))
    .toEqual({ zoom: 50, x: 100, y: 50 });
  expect(camera.updateManualCamera(automatic, { type: "pan", x: 40, y: -20 })).toEqual(automatic);
  expect(camera.updateManualCamera(panned, { type: "reset" })).toEqual(automatic);
  expect(automatic).toEqual({ zoom: 100, x: 0, y: 0 });
});
