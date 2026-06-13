import { niceStep } from "./format";
import { makePoint } from "./curveFactory";
import type { Curve, Point } from "./types";

export function pointRole(curve: Curve, index: number) {
  if (curve.type === "linear") return "anchor";
  return index % 3 === 0 ? "anchor" : "guide";
}

export function nextPointForCurve(curve: Curve) {
  const last = curve.points.at(-1);
  if (!last) return makePoint(0, 0);

  if (curve.type === "linear") {
    return makePoint(last.x + 1, last.y + 1);
  }

  const nextIndex = curve.points.length;
  if (nextIndex % 3 === 0) {
    return makePoint(last.x + 1, last.y);
  }

  return makePoint(last.x + 0.8, last.y + (nextIndex % 3 === 1 ? 0.5 : -0.5));
}

export function buildPath(curve: Curve) {
  const { points } = curve;
  if (points.length === 0) return "";

  if (curve.type === "linear") {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index + 3 < points.length; index += 3) {
    const c1 = points[index + 1];
    const c2 = points[index + 2];
    const end = points[index + 3];
    path += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
  }

  return path;
}

export function isBezierGuideAligned(anchor: Point, opposite: Point, guide: Point) {
  const ax = opposite.x - anchor.x;
  const ay = opposite.y - anchor.y;
  const bx = guide.x - anchor.x;
  const by = guide.y - anchor.y;
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);

  if (aLength === 0 || bLength === 0) return false;

  const cross = Math.abs(ax * by - ay * bx) / (aLength * bLength);
  const dot = ax * bx + ay * by;
  return cross < 0.035 && dot < 0;
}

export function getBezierGuideContext(curve: Curve, pointIndex: number) {
  if (curve.type !== "bezier" || pointIndex % 3 === 0) return null;

  const anchorIndex = pointIndex % 3 === 1 ? pointIndex - 1 : pointIndex + 1;
  const oppositeIndex = pointIndex % 3 === 1 ? anchorIndex - 1 : anchorIndex + 1;
  const anchor = curve.points[anchorIndex];
  const opposite = curve.points[oppositeIndex];

  if (!anchor || !opposite) return null;
  return { anchor, opposite };
}

export function magnetizeGuide(curve: Curve, pointIndex: number, candidate: Point, extent: number) {
  const context = getBezierGuideContext(curve, pointIndex);
  if (!context) return candidate;

  const { anchor, opposite } = context;
  const ox = opposite.x - anchor.x;
  const oy = opposite.y - anchor.y;
  const lineLength = Math.hypot(ox, oy);
  const candidateLength = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);

  if (lineLength === 0 || candidateLength === 0) return candidate;

  const distanceFromLine = Math.abs(ox * (candidate.y - anchor.y) - oy * (candidate.x - anchor.x)) / lineLength;
  const dot = ox * (candidate.x - anchor.x) + oy * (candidate.y - anchor.y);
  const threshold = extent * 0.018;

  if (distanceFromLine > threshold || dot >= 0) return candidate;

  return {
    ...candidate,
    x: anchor.x - (ox / lineLength) * candidateLength,
    y: anchor.y - (oy / lineLength) * candidateLength
  };
}

export function gridValues(min: number, max: number) {
  const step = niceStep((max - min) / 12);
  const start = Math.ceil(min / step) * step;
  const values: number[] = [];

  for (let value = start; value <= max + step / 2; value += step) {
    values.push(Number(value.toFixed(8)));
  }

  return values;
}

export function markerValues(min: number, max: number) {
  const markers: number[] = [];
  const divisions = 7;

  for (let index = 0; index <= divisions; index += 1) {
    markers.push(min + ((max - min) / divisions) * index);
  }

  return markers;
}
