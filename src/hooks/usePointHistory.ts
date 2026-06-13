"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_HISTORY_STEPS } from "../lib/constants";
import { applyPointSnapshot, pointSnapshotsEqual, snapshotPoints } from "../lib/history";
import type { Curve, PointHistorySnapshot } from "../lib/types";

type UsePointHistoryOptions = {
  initialCurves: Curve[];
  maxHistorySteps?: number;
};

export function usePointHistory({ initialCurves, maxHistorySteps = MAX_HISTORY_STEPS }: UsePointHistoryOptions) {
  const [curves, setCurves] = useState<Curve[]>(initialCurves);
  const [undoStack, setUndoStack] = useState<PointHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<PointHistorySnapshot[]>([]);
  const curvesRef = useRef(curves);

  useEffect(() => {
    curvesRef.current = curves;
  }, [curves]);

  const trimAndAppendSnapshot = useCallback(
    (current: PointHistorySnapshot[], snapshot: PointHistorySnapshot) => [...current.slice(-(maxHistorySteps - 1)), snapshot],
    [maxHistorySteps]
  );

  const setCurveState = useCallback((nextCurves: Curve[]) => {
    curvesRef.current = nextCurves;
    setCurves(nextCurves);
  }, []);

  const setCurveStateFrom = useCallback(
    (updater: (current: Curve[]) => Curve[]) => {
      setCurveState(updater(curvesRef.current));
    },
    [setCurveState]
  );

  const snapshotCurrentPoints = useCallback(() => snapshotPoints(curvesRef.current), []);

  const resetPointHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const recordPointSnapshot = useCallback(
    (snapshot: PointHistorySnapshot) => {
      const currentSnapshot = snapshotPoints(curvesRef.current);
      if (pointSnapshotsEqual(snapshot, currentSnapshot)) return false;

      setUndoStack((current) => trimAndAppendSnapshot(current, snapshot));
      setRedoStack([]);
      return true;
    },
    [trimAndAppendSnapshot]
  );

  const setCurveStateWithPointHistory = useCallback(
    (updater: (current: Curve[]) => Curve[]) => {
      const previousCurves = curvesRef.current;
      const previousSnapshot = snapshotPoints(previousCurves);
      const nextCurves = updater(previousCurves);
      const nextSnapshot = snapshotPoints(nextCurves);

      if (pointSnapshotsEqual(previousSnapshot, nextSnapshot)) return false;

      setUndoStack((current) => trimAndAppendSnapshot(current, previousSnapshot));
      setRedoStack([]);
      setCurveState(nextCurves);
      return true;
    },
    [setCurveState, trimAndAppendSnapshot]
  );

  const undoPointEdit = useCallback(() => {
    const snapshot = undoStack.at(-1);
    if (!snapshot) return false;

    setRedoStack((current) => trimAndAppendSnapshot(current, snapshotPoints(curvesRef.current)));
    setUndoStack((current) => current.slice(0, -1));
    setCurveState(applyPointSnapshot(curvesRef.current, snapshot));
    return true;
  }, [setCurveState, trimAndAppendSnapshot, undoStack]);

  const redoPointEdit = useCallback(() => {
    const snapshot = redoStack.at(-1);
    if (!snapshot) return false;

    setUndoStack((current) => trimAndAppendSnapshot(current, snapshotPoints(curvesRef.current)));
    setRedoStack((current) => current.slice(0, -1));
    setCurveState(applyPointSnapshot(curvesRef.current, snapshot));
    return true;
  }, [redoStack, setCurveState, trimAndAppendSnapshot]);

  return {
    curves,
    curvesRef,
    setCurveState,
    setCurveStateFrom,
    setCurveStateWithPointHistory,
    snapshotCurrentPoints,
    recordPointSnapshot,
    resetPointHistory,
    undoPointEdit,
    redoPointEdit
  };
}
