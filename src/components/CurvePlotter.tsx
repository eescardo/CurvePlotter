"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CurveSidebar } from "./CurveSidebar";
import { PlotterCanvas } from "./PlotterCanvas";
import { PlotterHeader } from "./PlotterHeader";
import { COLORS, MAX_HISTORY_STEPS } from "../lib/constants";
import { curveToCsv, parseImportedPoints } from "../lib/csv";
import { createInitialState, makeId, makePoint } from "../lib/curveFactory";
import { gridValues, magnetizeGuide, markerValues, nextPointForCurve } from "../lib/drawing";
import { clamp } from "../lib/format";
import { applyPointSnapshot, pointSnapshotsEqual, snapshotPoints } from "../lib/history";
import { deletePersistedState, loadPersistedState, savePersistedState } from "../lib/persistence";
import type { Curve, CurveType, PendingImport, Point, PointHistorySnapshot } from "../lib/types";
import styles from "./CurvePlotter.module.css";

export function CurvePlotter() {
  const initialState = useMemo(() => createInitialState(), []);
  const [curves, setCurves] = useState<Curve[]>(initialState.curves);
  const [selectedCurveId, setSelectedCurveId] = useState<string | null>(initialState.selectedCurveId);
  const [extent, setExtent] = useState(initialState.extent);
  const [centerX, setCenterX] = useState(initialState.centerX);
  const [centerY, setCenterY] = useState(initialState.centerY);
  const [minExtent, setMinExtent] = useState(initialState.minExtent);
  const [maxExtent, setMaxExtent] = useState(initialState.maxExtent);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [showPoints, setShowPoints] = useState(initialState.showPoints);
  const [invertYAxis, setInvertYAxis] = useState(initialState.invertYAxis);
  const [undoStack, setUndoStack] = useState<PointHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<PointHistorySnapshot[]>([]);
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false);
  const [dragging, setDragging] = useState<{ curveId: string; pointId: string; startSnapshot: PointHistorySnapshot } | null>(null);
  const [panning, setPanning] = useState<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotViewportRef = useRef<HTMLDivElement | null>(null);
  const curvesRef = useRef(curves);

  const selectedCurve = curves.find((curve) => curve.id === selectedCurveId) ?? null;
  const effectiveMinExtent = Math.max(0.1, minExtent);
  const effectiveMaxExtent = Math.max(effectiveMinExtent + 0.1, maxExtent);
  const clampedExtent = clamp(extent, effectiveMinExtent, effectiveMaxExtent);
  const xMin = centerX - clampedExtent;
  const xMax = centerX + clampedExtent;
  const yMin = centerY - clampedExtent;
  const yMax = centerY + clampedExtent;
  const svgYMin = invertYAxis ? yMin : -yMax;
  const xValues = useMemo(() => gridValues(xMin, xMax), [xMax, xMin]);
  const yValues = useMemo(() => gridValues(yMin, yMax), [yMax, yMin]);
  const xMarkers = useMemo(() => markerValues(xMin, xMax), [xMax, xMin]);
  const yMarkers = useMemo(() => markerValues(yMin, yMax), [yMax, yMin]);

  useEffect(() => {
    curvesRef.current = curves;
  }, [curves]);

  useEffect(() => {
    setSelectedCurveId((current) => (current && curves.some((curve) => curve.id === current) ? current : curves[0]?.id ?? null));
  }, [curves]);

  useEffect(() => {
    if (extent !== clampedExtent) setExtent(clampedExtent);
  }, [clampedExtent, extent]);

  useEffect(() => {
    let cancelled = false;

    loadPersistedState()
      .then((state) => {
        if (cancelled) return;
        if (state) {
          setCurveState(state.curves);
          setSelectedCurveId(state.curves.some((curve) => curve.id === state.selectedCurveId) ? state.selectedCurveId : state.curves[0]?.id ?? null);
          setExtent(state.extent);
          setCenterX(state.centerX);
          setCenterY(state.centerY);
          setMinExtent(state.minExtent);
          setMaxExtent(state.maxExtent);
          setShowPoints(state.showPoints);
          setInvertYAxis(state.invertYAxis);
          setUndoStack([]);
          setRedoStack([]);
        }
      })
      .catch(() => {
        // Persistence is helpful, not required for editing.
      })
      .finally(() => {
        if (!cancelled) setHasLoadedPersistedState(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedState) return;

    const timeout = window.setTimeout(() => {
      savePersistedState({
        curves,
        selectedCurveId,
        extent,
        centerX,
        centerY,
        minExtent,
        maxExtent,
        showPoints,
        invertYAxis
      }).catch(() => {
        // Nothing in the UI should fail just because local persistence did.
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [centerX, centerY, curves, extent, hasLoadedPersistedState, invertYAxis, maxExtent, minExtent, selectedCurveId, showPoints]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isUndoRedoKey = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey);
      if (!isUndoRedoKey) return;

      event.preventDefault();
      if (event.shiftKey) {
        redoPointEdit();
      } else {
        undoPointEdit();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    const plotViewport = plotViewportRef.current;
    if (!plotViewport) return;

    function handleNativeWheel(event: WheelEvent) {
      zoomAroundPointer(event);
    }

    plotViewport.addEventListener("wheel", handleNativeWheel, { capture: true, passive: false });
    return () => plotViewport.removeEventListener("wheel", handleNativeWheel, { capture: true });
  });

  function setCurveState(nextCurves: Curve[]) {
    curvesRef.current = nextCurves;
    setCurves(nextCurves);
  }

  function setCurveStateFrom(updater: (current: Curve[]) => Curve[]) {
    setCurveState(updater(curvesRef.current));
  }

  function setCurveStateWithPointHistory(updater: (current: Curve[]) => Curve[]) {
    const previousCurves = curvesRef.current;
    const previousSnapshot = snapshotPoints(previousCurves);
    const nextCurves = updater(previousCurves);
    const nextSnapshot = snapshotPoints(nextCurves);

    if (pointSnapshotsEqual(previousSnapshot, nextSnapshot)) return;

    setUndoStack((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), previousSnapshot]);
    setRedoStack([]);
    setCurveState(nextCurves);
  }

  function undoPointEdit() {
    const snapshot = undoStack.at(-1);
    if (!snapshot) return;

    setRedoStack((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), snapshotPoints(curvesRef.current)]);
    setUndoStack((current) => current.slice(0, -1));
    setCurveState(applyPointSnapshot(curvesRef.current, snapshot));
  }

  function redoPointEdit() {
    const snapshot = redoStack.at(-1);
    if (!snapshot) return;

    setUndoStack((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), snapshotPoints(curvesRef.current)]);
    setRedoStack((current) => current.slice(0, -1));
    setCurveState(applyPointSnapshot(curvesRef.current, snapshot));
  }

  function clearState() {
    const nextState = createInitialState();
    setCurveState(nextState.curves);
    setSelectedCurveId(nextState.selectedCurveId);
    setExtent(nextState.extent);
    setCenterX(nextState.centerX);
    setCenterY(nextState.centerY);
    setMinExtent(nextState.minExtent);
    setMaxExtent(nextState.maxExtent);
    setShowPoints(nextState.showPoints);
    setInvertYAxis(nextState.invertYAxis);
    setUndoStack([]);
    setRedoStack([]);
    setPendingImport(null);
    setDragging(null);
    setPanning(null);
    deletePersistedState().catch(() => {
      // The debounce save will restore the cleared state if delete fails.
    });
  }

  function addCurve(type: CurveType, points?: Point[]) {
    const curveNumber = curves.length + 1;
    const nextCurve: Curve = {
      id: makeId(),
      name: `Curve ${curveNumber}`,
      type,
      color: COLORS[curves.length % COLORS.length],
      expanded: true,
      points: points ?? [makePoint(0, 0)]
    };

    setCurveStateFrom((current) => [...current, nextCurve]);
    setSelectedCurveId(nextCurve.id);
  }

  function deleteSelectedCurve() {
    if (!selectedCurveId) return;

    setCurveStateFrom((current) => {
      const selectedIndex = current.findIndex((curve) => curve.id === selectedCurveId);
      const next = current.filter((curve) => curve.id !== selectedCurveId);
      const nextSelected = next[Math.max(0, selectedIndex - 1)] ?? next[0] ?? null;
      setSelectedCurveId(nextSelected?.id ?? null);
      return next;
    });
  }

  function updateCurve(curveId: string, updater: (curve: Curve) => Curve) {
    setCurveStateFrom((current) => current.map((curve) => (curve.id === curveId ? updater(curve) : curve)));
  }

  function updatePoint(curveId: string, pointId: string, updates: Partial<Pick<Point, "x" | "y">>, recordHistory = true) {
    const update = (current: Curve[]) =>
      current.map((curve) =>
        curve.id === curveId
          ? {
              ...curve,
              points: curve.points.map((point) => (point.id === pointId ? { ...point, ...updates } : point))
            }
          : curve
      );

    if (recordHistory) {
      setCurveStateWithPointHistory(update);
      return;
    }

    setCurveStateFrom(update);
  }

  function svgPointFromEvent(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };

    const rect = svg.getBoundingClientRect();
    return {
      x: centerX + ((event.clientX - rect.left) / rect.width) * (clampedExtent * 2) - clampedExtent,
      y: invertYAxis
        ? centerY + ((event.clientY - rect.top) / rect.height) * (clampedExtent * 2) - clampedExtent
        : centerY + clampedExtent - ((event.clientY - rect.top) / rect.height) * (clampedExtent * 2)
    };
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (panning) {
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const deltaX = ((event.clientX - panning.startClientX) / rect.width) * (clampedExtent * 2);
      const deltaY = ((event.clientY - panning.startClientY) / rect.height) * (clampedExtent * 2);

      setCenterX(panning.startCenterX - deltaX);
      setCenterY(panning.startCenterY + (invertYAxis ? -deltaY : deltaY));
      return;
    }

    if (!dragging) return;

    const curve = curvesRef.current.find((item) => item.id === dragging.curveId);
    const pointIndex = curve?.points.findIndex((point) => point.id === dragging.pointId) ?? -1;
    if (!curve || pointIndex < 0) return;

    const rawPoint = svgPointFromEvent(event);
    const nextPoint = magnetizeGuide(curve, pointIndex, { ...curve.points[pointIndex], ...rawPoint }, clampedExtent);
    updatePoint(curve.id, dragging.pointId, { x: nextPoint.x, y: nextPoint.y }, false);
  }

  function startPanning(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || dragging) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCenterX: centerX,
      startCenterY: centerY
    });
  }

  function finishPanning(event?: PointerEvent<SVGSVGElement>) {
    if (panning && event?.currentTarget.hasPointerCapture(panning.pointerId)) {
      event.currentTarget.releasePointerCapture(panning.pointerId);
    }
    setPanning(null);
  }

  function finishDragging() {
    if (!dragging) return;

    const currentSnapshot = snapshotPoints(curvesRef.current);
    if (!pointSnapshotsEqual(dragging.startSnapshot, currentSnapshot)) {
      setUndoStack((current) => [...current.slice(-(MAX_HISTORY_STEPS - 1)), dragging.startSnapshot]);
      setRedoStack([]);
    }

    setDragging(null);
  }

  function finishPointerInteraction(event: PointerEvent<SVGSVGElement>) {
    finishDragging();
    finishPanning(event);
  }

  function startPointDrag(curveId: string, pointId: string, event: PointerEvent<SVGCircleElement>) {
    event.stopPropagation();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedCurveId(curveId);
    setDragging({ curveId, pointId, startSnapshot: snapshotPoints(curvesRef.current) });
  }

  function zoomAroundPointer(event: WheelEvent) {
    event.preventDefault();

    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const likelyTrackpadPan = !event.ctrlKey && event.deltaMode === 0 && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 50);

    if (likelyTrackpadPan) {
      const deltaX = (event.deltaX / rect.width) * (clampedExtent * 2);
      const deltaY = (event.deltaY / rect.height) * (clampedExtent * 2);

      setCenterX((current) => current + deltaX);
      setCenterY((current) => current + (invertYAxis ? deltaY : -deltaY));
      return;
    }

    const normalizedX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const normalizedY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const worldX = centerX + (normalizedX * 2 - 1) * clampedExtent;
    const worldY = invertYAxis
      ? centerY + (normalizedY * 2 - 1) * clampedExtent
      : centerY + (1 - normalizedY * 2) * clampedExtent;
    const zoomScale = Math.exp(event.deltaY * 0.001);
    const nextExtent = clamp(clampedExtent * zoomScale, effectiveMinExtent, effectiveMaxExtent);

    setExtent(nextExtent);
    setCenterX(worldX - (normalizedX * 2 - 1) * nextExtent);
    setCenterY(invertYAxis ? worldY - (normalizedY * 2 - 1) * nextExtent : worldY - (1 - normalizedY * 2) * nextExtent);
  }

  function addPoint(curveId: string) {
    setCurveStateWithPointHistory((current) =>
      current.map((curve) =>
        curve.id === curveId
          ? {
              ...curve,
              points: [...curve.points, nextPointForCurve(curve)]
            }
          : curve
      )
    );
  }

  function removePoint(curveId: string, pointId: string) {
    setCurveStateWithPointHistory((current) =>
      current.map((curve) =>
        curve.id === curveId
          ? {
              ...curve,
              points: curve.points.filter((point) => point.id !== pointId)
            }
          : curve
      )
    );
  }

  function handleImportedPoints(points: Point[]) {
    if (points.length === 0) return;

    if (selectedCurve) {
      setPendingImport({ points });
      return;
    }

    addCurve("linear", points);
  }

  function importPoints(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    file.text().then((text) => {
      handleImportedPoints(parseImportedPoints(text));
    });
  }

  function importFromClipboard() {
    navigator.clipboard
      .readText()
      .then((text) => {
        handleImportedPoints(parseImportedPoints(text));
      })
      .catch(() => {
        // Clipboard permissions can fail without affecting file import.
      });
  }

  function replaceSelectedWithImport() {
    if (!selectedCurve || !pendingImport) return;

    setCurveStateWithPointHistory((current) =>
      current.map((curve) => (curve.id === selectedCurve.id ? { ...curve, points: pendingImport.points } : curve))
    );
    setPendingImport(null);
  }

  function createImportedCurve() {
    if (!pendingImport) return;

    addCurve("linear", pendingImport.points);
    setPendingImport(null);
  }

  function exportSelectedCurveToFile() {
    if (!selectedCurve) return;

    const csv = curveToCsv(selectedCurve);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedCurve.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "curve"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportSelectedCurveToClipboard() {
    if (!selectedCurve) return;
    navigator.clipboard.writeText(curveToCsv(selectedCurve)).catch(() => {
      // Export-to-file remains available if clipboard write is denied.
    });
  }

  return (
    <main className={styles.app}>
      <section className={styles.plotRegion}>
        <PlotterHeader
          clampedExtent={clampedExtent}
          effectiveMinExtent={effectiveMinExtent}
          effectiveMaxExtent={effectiveMaxExtent}
          minExtent={minExtent}
          maxExtent={maxExtent}
          showPoints={showPoints}
          invertYAxis={invertYAxis}
          onClear={clearState}
          onExtentChange={setExtent}
          onMinExtentChange={setMinExtent}
          onMaxExtentChange={setMaxExtent}
          onShowPointsChange={setShowPoints}
          onInvertYAxisChange={setInvertYAxis}
        />
        <PlotterCanvas
          curves={curves}
          selectedCurveId={selectedCurveId}
          showPoints={showPoints}
          invertYAxis={invertYAxis}
          clampedExtent={clampedExtent}
          xMin={xMin}
          xMax={xMax}
          yMin={yMin}
          yMax={yMax}
          svgYMin={svgYMin}
          xValues={xValues}
          yValues={yValues}
          xMarkers={xMarkers}
          yMarkers={yMarkers}
          panningActive={Boolean(panning)}
          svgRef={svgRef}
          plotViewportRef={plotViewportRef}
          onCanvasPointerDown={startPanning}
          onCanvasPointerMove={handlePointerMove}
          onCanvasPointerUp={finishPointerInteraction}
          onPointPointerDown={startPointDrag}
        />
      </section>

      <CurveSidebar
        curves={curves}
        selectedCurveId={selectedCurveId}
        selectedCurveExists={Boolean(selectedCurve)}
        pendingImport={pendingImport}
        onAddCurve={addCurve}
        onDeleteSelectedCurve={deleteSelectedCurve}
        onSelectCurve={setSelectedCurveId}
        onUpdateCurve={updateCurve}
        onUpdatePoint={updatePoint}
        onAddPoint={addPoint}
        onRemovePoint={removePoint}
        onImportFile={importPoints}
        onImportClipboard={importFromClipboard}
        onCreateImportedCurve={createImportedCurve}
        onReplaceSelectedWithImport={replaceSelectedWithImport}
        onExportFile={exportSelectedCurveToFile}
        onExportClipboard={exportSelectedCurveToClipboard}
      />
    </main>
  );
}
