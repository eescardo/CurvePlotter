import type { Curve, Point, PointHistorySnapshot } from "./types";

export function clonePoints(points: Point[]) {
  return points.map((point) => ({ ...point }));
}

export function snapshotPoints(curves: Curve[]): PointHistorySnapshot {
  return curves.map((curve) => ({
    curveId: curve.id,
    points: clonePoints(curve.points)
  }));
}

export function pointSnapshotsEqual(left: PointHistorySnapshot, right: PointHistorySnapshot) {
  if (left.length !== right.length) return false;

  return left.every((leftCurve, curveIndex) => {
    const rightCurve = right[curveIndex];
    if (!rightCurve || leftCurve.curveId !== rightCurve.curveId || leftCurve.points.length !== rightCurve.points.length) {
      return false;
    }

    return leftCurve.points.every((leftPoint, pointIndex) => {
      const rightPoint = rightCurve.points[pointIndex];
      return rightPoint && leftPoint.id === rightPoint.id && leftPoint.x === rightPoint.x && leftPoint.y === rightPoint.y;
    });
  });
}

export function applyPointSnapshot(curves: Curve[], snapshot: PointHistorySnapshot) {
  return curves.map((curve) => {
    const savedCurve = snapshot.find((item) => item.curveId === curve.id);
    return savedCurve ? { ...curve, points: clonePoints(savedCurve.points) } : curve;
  });
}
