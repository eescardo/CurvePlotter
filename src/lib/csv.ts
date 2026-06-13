import { makePoint } from "./curveFactory";
import { formatNumber } from "./format";
import type { Curve, Point } from "./types";

export function parseImportedPoints(text: string) {
  const matches = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const values = matches.map(Number).filter(Number.isFinite);
  const points: Point[] = [];

  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push(makePoint(values[index], values[index + 1]));
  }

  return points;
}

export function curveToCsv(curve: Curve) {
  return curve.points.map((point) => `(${formatNumber(point.x)},${formatNumber(point.y)})`).join("\n");
}
