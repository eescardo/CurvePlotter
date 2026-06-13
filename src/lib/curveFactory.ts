import { COLORS, DEFAULT_MAX_EXTENT, DEFAULT_MIN_EXTENT } from "./constants";
import type { Curve, PersistedCurvePlotterState, Point } from "./types";

export function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export function makePoint(x: number, y: number): Point {
  return { id: makeId(), x, y };
}

export function createInitialCurves(): Curve[] {
  return [
    {
      id: makeId(),
      name: "Curve 1",
      type: "bezier",
      color: COLORS[0],
      expanded: true,
      points: [makePoint(0, 0)]
    }
  ];
}

export function createInitialState(): PersistedCurvePlotterState {
  const curves = createInitialCurves();

  return {
    curves,
    selectedCurveId: curves[0]?.id ?? null,
    extent: 8,
    centerX: 0,
    centerY: 0,
    minExtent: DEFAULT_MIN_EXTENT,
    maxExtent: DEFAULT_MAX_EXTENT,
    showPoints: true,
    invertYAxis: false
  };
}
