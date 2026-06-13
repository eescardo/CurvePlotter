"use client";

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type CurveType = "linear" | "bezier";

type Point = {
  id: string;
  x: number;
  y: number;
};

type Curve = {
  id: string;
  name: string;
  type: CurveType;
  color: string;
  expanded: boolean;
  points: Point[];
};

type PendingImport = {
  points: Point[];
};

type PointHistorySnapshot = {
  curveId: string;
  points: Point[];
}[];

type PersistedCurvePlotterState = {
  curves: Curve[];
  selectedCurveId: string | null;
  extent: number;
  centerX: number;
  centerY: number;
  minExtent: number;
  maxExtent: number;
  showPoints: boolean;
  invertYAxis: boolean;
};

const COLORS = ["#2563eb", "#c9353d", "#16865d", "#b56b00", "#7c3aed", "#0f766e"];
const POINT_COLOR = "#69727d";
const DEFAULT_MIN_EXTENT = 1;
const DEFAULT_MAX_EXTENT = 20;
const MAX_HISTORY_STEPS = 200;
const STATE_DB_NAME = "curve-plotter";
const STATE_DB_VERSION = 1;
const STATE_STORE_NAME = "state";
const STATE_RECORD_KEY = "current";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function makePoint(x: number, y: number): Point {
  return { id: makeId(), x, y };
}

function createInitialCurves(): Curve[] {
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

function createInitialState(): PersistedCurvePlotterState {
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

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toFixed(1) : Number(value.toFixed(3)).toString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function niceStep(rawStep: number) {
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / power;

  if (normalized >= 5) return 5 * power;
  if (normalized >= 2) return 2 * power;
  return power;
}

function pointRole(curve: Curve, index: number) {
  if (curve.type === "linear") return "anchor";
  return index % 3 === 0 ? "anchor" : "guide";
}

function nextPointForCurve(curve: Curve) {
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

function parseImportedPoints(text: string) {
  const matches = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const values = matches.map(Number).filter(Number.isFinite);
  const points: Point[] = [];

  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push(makePoint(values[index], values[index + 1]));
  }

  return points;
}

function buildPath(curve: Curve) {
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

function isBezierGuideAligned(anchor: Point, opposite: Point, guide: Point) {
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

function getBezierGuideContext(curve: Curve, pointIndex: number) {
  if (curve.type !== "bezier" || pointIndex % 3 === 0) return null;

  const anchorIndex = pointIndex % 3 === 1 ? pointIndex - 1 : pointIndex + 1;
  const oppositeIndex = pointIndex % 3 === 1 ? anchorIndex - 1 : anchorIndex + 1;
  const anchor = curve.points[anchorIndex];
  const opposite = curve.points[oppositeIndex];

  if (!anchor || !opposite) return null;
  return { anchor, opposite };
}

function magnetizeGuide(curve: Curve, pointIndex: number, candidate: Point, extent: number) {
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

function gridValues(min: number, max: number) {
  const step = niceStep((max - min) / 12);
  const start = Math.ceil(min / step) * step;
  const values: number[] = [];

  for (let value = start; value <= max + step / 2; value += step) {
    values.push(Number(value.toFixed(8)));
  }

  return values;
}

function markerValues(min: number, max: number) {
  const markers: number[] = [];
  const divisions = 7;

  for (let index = 0; index <= divisions; index += 1) {
    markers.push(min + ((max - min) / divisions) * index);
  }

  return markers;
}

function clonePoints(points: Point[]) {
  return points.map((point) => ({ ...point }));
}

function snapshotPoints(curves: Curve[]): PointHistorySnapshot {
  return curves.map((curve) => ({
    curveId: curve.id,
    points: clonePoints(curve.points)
  }));
}

function pointSnapshotsEqual(left: PointHistorySnapshot, right: PointHistorySnapshot) {
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

function applyPointSnapshot(curves: Curve[], snapshot: PointHistorySnapshot) {
  return curves.map((curve) => {
    const savedCurve = snapshot.find((item) => item.curveId === curve.id);
    return savedCurve ? { ...curve, points: clonePoints(savedCurve.points) } : curve;
  });
}

function openStateDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STATE_DB_NAME, STATE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE_NAME)) {
        db.createObjectStore(STATE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadPersistedState() {
  const db = await openStateDb();

  return new Promise<PersistedCurvePlotterState | null>((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE_NAME, "readonly");
    const request = transaction.objectStore(STATE_STORE_NAME).get(STATE_RECORD_KEY);

    request.onsuccess = () => resolve(validatePersistedState(request.result));
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function savePersistedState(state: PersistedCurvePlotterState) {
  const db = await openStateDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE_NAME, "readwrite");
    transaction.objectStore(STATE_STORE_NAME).put(state, STATE_RECORD_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function deletePersistedState() {
  const db = await openStateDb();

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE_NAME, "readwrite");
    transaction.objectStore(STATE_STORE_NAME).delete(STATE_RECORD_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function validatePersistedState(value: unknown): PersistedCurvePlotterState | null {
  if (!value || typeof value !== "object") return null;

  const state = value as Partial<PersistedCurvePlotterState>;
  if (!Array.isArray(state.curves) || state.curves.length === 0) return null;
  if (![state.extent, state.minExtent, state.maxExtent].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const extent = state.extent;
  const centerX = typeof state.centerX === "number" && Number.isFinite(state.centerX) ? state.centerX : 0;
  const centerY = typeof state.centerY === "number" && Number.isFinite(state.centerY) ? state.centerY : 0;
  const minExtent = state.minExtent;
  const maxExtent = state.maxExtent;
  if (typeof extent !== "number" || typeof minExtent !== "number" || typeof maxExtent !== "number") return null;

  const curves = state.curves.filter((curve) => {
    return (
      curve &&
      typeof curve.id === "string" &&
      typeof curve.name === "string" &&
      (curve.type === "linear" || curve.type === "bezier") &&
      typeof curve.color === "string" &&
      typeof curve.expanded === "boolean" &&
      Array.isArray(curve.points) &&
      curve.points.every((point) => typeof point.id === "string" && Number.isFinite(point.x) && Number.isFinite(point.y))
    );
  });

  if (curves.length === 0) return null;

  return {
    curves,
    selectedCurveId: typeof state.selectedCurveId === "string" ? state.selectedCurveId : curves[0].id,
    extent,
    centerX,
    centerY,
    minExtent,
    maxExtent,
    showPoints: state.showPoints !== false,
    invertYAxis: state.invertYAxis === true
  };
}

function PointFields({
  point,
  onChange
}: {
  point: Point;
  onChange: (updates: Partial<Pick<Point, "x" | "y">>) => void;
}) {
  const [xText, setXText] = useState(formatNumber(point.x));
  const [yText, setYText] = useState(formatNumber(point.y));
  const focusedField = useRef<"x" | "y" | null>(null);

  useEffect(() => {
    if (focusedField.current !== "x") setXText(formatNumber(point.x));
    if (focusedField.current !== "y") setYText(formatNumber(point.y));
  }, [point.x, point.y]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextX = Number(xText);
      const nextY = Number(yText);

      if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
        onChange({ x: nextX, y: nextY });
      }
    }, 360);

    return () => window.clearTimeout(timeout);
  }, [xText, yText, onChange]);

  return (
    <>
      <input
        aria-label="X coordinate"
        inputMode="decimal"
        value={xText}
        onBlur={() => {
          focusedField.current = null;
          setXText(formatNumber(point.x));
        }}
        onChange={(event) => setXText(event.target.value)}
        onFocus={() => {
          focusedField.current = "x";
        }}
      />
      <input
        aria-label="Y coordinate"
        inputMode="decimal"
        value={yText}
        onBlur={() => {
          focusedField.current = null;
          setYText(formatNumber(point.y));
        }}
        onChange={(event) => setYText(event.target.value)}
        onFocus={() => {
          focusedField.current = "y";
        }}
      />
    </>
  );
}

export default function Home() {
  const initialState = useMemo(() => createInitialState(), []);
  const [curves, setCurves] = useState<Curve[]>(initialState.curves);
  const [selectedCurveId, setSelectedCurveId] = useState<string | null>(initialState.selectedCurveId);
  const [extent, setExtent] = useState(initialState.extent);
  const [centerX, setCenterX] = useState(initialState.centerX);
  const [centerY, setCenterY] = useState(initialState.centerY);
  const [minExtent, setMinExtent] = useState(initialState.minExtent);
  const [maxExtent, setMaxExtent] = useState(initialState.maxExtent);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [hoverReadyId, setHoverReadyId] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
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
    setAddMenuOpen(false);
    setImportMenuOpen(false);
    setExportMenuOpen(false);
    setEditingNameId(null);
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
    setAddMenuOpen(false);
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
      setImportMenuOpen(false);
    });
  }

  function importFromClipboard() {
    navigator.clipboard
      .readText()
      .then((text) => {
        handleImportedPoints(parseImportedPoints(text));
        setImportMenuOpen(false);
      })
      .catch(() => {
        setImportMenuOpen(false);
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

  function selectedCurveCsv() {
    if (!selectedCurve) return "";
    return selectedCurve.points.map((point) => `(${formatNumber(point.x)},${formatNumber(point.y)})`).join("\n");
  }

  function exportSelectedCurveToFile() {
    if (!selectedCurve) return;

    const csv = selectedCurveCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedCurve.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "curve"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  }

  function exportSelectedCurveToClipboard() {
    if (!selectedCurve) return;

    navigator.clipboard
      .writeText(selectedCurveCsv())
      .finally(() => setExportMenuOpen(false));
  }

  function startHoverTimer(curveId: string) {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHoverReadyId(curveId), 800);
  }

  function clearHoverTimer() {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverReadyId(null);
  }

  return (
    <main className="app">
      <section className="plot-region">
        <div className="topbar">
          <div className="brand">
            <div className="brand-title">Curve Plotter</div>
            <div className="brand-subtitle">XY grid drawing for linear and cubic Bezier curves</div>
          </div>
          <div className="zoom-controls">
            <button className="action-button" onClick={clearState}>
              Clear
            </button>
            <label className="check-option">
              <input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />
              Show points
            </label>
            <label className="check-option">
              <input type="checkbox" checked={invertYAxis} onChange={(event) => setInvertYAxis(event.target.checked)} />
              Invert Y
            </label>
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => setExtent((current) => clamp(current * 1.25, effectiveMinExtent, effectiveMaxExtent))}
            >
              -
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => setExtent((current) => clamp(current / 1.25, effectiveMinExtent, effectiveMaxExtent))}
            >
              +
            </button>
            <input
              aria-label="Zoom extent"
              type="range"
              min={effectiveMinExtent}
              max={effectiveMaxExtent}
              step={(effectiveMaxExtent - effectiveMinExtent) / 160}
              value={clampedExtent}
              onChange={(event) => setExtent(Number(event.target.value))}
            />
            <span className="extent-pill">extent +/- {formatNumber(clampedExtent)}</span>
            <div className="range-fields">
              <label>
                min
                <input
                  aria-label="Minimum zoom extent"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={minExtent}
                  onChange={(event) => setMinExtent(Number(event.target.value))}
                />
              </label>
              <label>
                max
                <input
                  aria-label="Maximum zoom extent"
                  type="number"
                  min="0.2"
                  step="0.5"
                  value={maxExtent}
                  onChange={(event) => setMaxExtent(Number(event.target.value))}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="canvas-shell">
          <div className="plot-card">
            <div className="axis-label-layer x-axis-labels" aria-hidden="true">
              {xMarkers.map((value) => (
                <span
                  key={`x-marker-${value}`}
                  className="axis-label x-axis-label"
                  style={{ left: `${((value - xMin) / (xMax - xMin)) * 100}%` }}
                >
                  {formatNumber(value)}
                </span>
              ))}
            </div>
            <div className="axis-label-layer y-axis-labels" aria-hidden="true">
              {yMarkers.map((value) => (
                <span
                  key={`y-marker-${value}`}
                  className="axis-label y-axis-label"
                  style={{ top: `${(invertYAxis ? (value - yMin) / (yMax - yMin) : (yMax - value) / (yMax - yMin)) * 100}%` }}
                >
                  {formatNumber(value)}
                </span>
              ))}
            </div>
            <div ref={plotViewportRef} className="plot-viewport">
            <svg
              ref={svgRef}
              className={`plot-svg ${panning ? "is-panning" : ""}`}
              viewBox={`${xMin} ${svgYMin} ${clampedExtent * 2} ${clampedExtent * 2}`}
              aria-label="Curve plotting grid"
              onPointerDown={startPanning}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointerInteraction}
              onPointerCancel={finishPointerInteraction}
            >
              <g transform={`scale(1 ${invertYAxis ? 1 : -1})`}>
                <rect x={xMin} y={yMin} width={clampedExtent * 2} height={clampedExtent * 2} fill="#fbfcfe" />
                {xValues.map((value) => (
                  <line
                    key={`x-${value}`}
                    x1={value}
                    y1={yMin}
                    x2={value}
                    y2={yMax}
                    stroke={Math.abs(value) < 0.00001 ? "#16202a" : "#d8dee6"}
                    strokeWidth={Math.abs(value) < 0.00001 ? clampedExtent * 0.006 : clampedExtent * 0.002}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {yValues.map((value) => (
                  <line
                    key={`y-${value}`}
                    x1={xMin}
                    y1={value}
                    x2={xMax}
                    y2={value}
                    stroke={Math.abs(value) < 0.00001 ? "#16202a" : "#d8dee6"}
                    strokeWidth={Math.abs(value) < 0.00001 ? clampedExtent * 0.006 : clampedExtent * 0.002}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {curves.map((curve) => (
                  <g key={curve.id}>
                    {showPoints &&
                      curve.type === "bezier" &&
                      curve.points.map((point, index) => {
                        if (index % 3 === 0) return null;
                        const context = getBezierGuideContext(curve, index);
                        if (!context) return null;
                        const aligned = isBezierGuideAligned(context.anchor, context.opposite, point);

                        return (
                          <line
                            key={`guide-${point.id}`}
                            x1={context.anchor.x}
                            y1={context.anchor.y}
                            x2={point.x}
                            y2={point.y}
                            stroke={aligned ? "#16865d" : curve.color}
                            strokeWidth={1.2}
                            strokeDasharray={aligned ? "10 7" : "1 7"}
                            strokeLinecap="round"
                            opacity={aligned ? 0.88 : 0.56}
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    <path
                      d={buildPath(curve)}
                      fill="none"
                      stroke={curve.color}
                      strokeWidth={2}
                      opacity={curve.id === selectedCurveId ? 1 : 0.72}
                      vectorEffect="non-scaling-stroke"
                    />
                    {showPoints && curve.points.map((point, index) => {
                      const role = pointRole(curve, index);
                      const radius = clampedExtent * (role === "anchor" ? 0.025 : 0.019);

                      return (
                        <circle
                          key={point.id}
                          className="point"
                          cx={point.x}
                          cy={point.y}
                          r={radius}
                          fill={POINT_COLOR}
                          stroke={POINT_COLOR}
                          strokeWidth={role === "anchor" ? 3 : 2}
                          opacity={0.3}
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            if (document.activeElement instanceof HTMLElement) {
                              document.activeElement.blur();
                            }
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setSelectedCurveId(curve.id);
                            setDragging({ curveId: curve.id, pointId: point.id, startSnapshot: snapshotPoints(curvesRef.current) });
                          }}
                        />
                      );
                    })}
                  </g>
                ))}
              </g>
            </svg>
            </div>
          </div>
        </div>
      </section>

      <aside className="sidebar" aria-label="Curve controls">
        <div className="sidebar-toolbar">
          <div className="actions">
            <div className="menu-wrap">
              <button
                className="action-button primary"
                onClick={() => {
                  setAddMenuOpen((open) => !open);
                  setImportMenuOpen(false);
                  setExportMenuOpen(false);
                }}
              >
                + Add
              </button>
              {addMenuOpen && (
                <div className="menu" role="menu">
                  <button onClick={() => addCurve("linear")}>Linear</button>
                  <button onClick={() => addCurve("bezier")}>Bezier</button>
                </div>
              )}
            </div>
            <button className="action-button danger" disabled={!selectedCurve} onClick={deleteSelectedCurve}>
              x Delete
            </button>
            <div className="import-wrap">
              <button
                className="action-button"
                onClick={() => {
                  setImportMenuOpen((open) => !open);
                  setAddMenuOpen(false);
                  setExportMenuOpen(false);
                }}
              >
                Import
              </button>
              <input ref={fileInputRef} className="hidden-input" type="file" accept=".csv,text/csv,text/plain" onChange={importPoints} />
              {importMenuOpen && !pendingImport && (
                <div className="menu" role="menu">
                  <button onClick={() => fileInputRef.current?.click()}>File</button>
                  <button onClick={importFromClipboard}>Clipboard</button>
                </div>
              )}
              {pendingImport && selectedCurve && (
                <div className="popover">
                  <div className="popover-title">Do you want to replace current curve points?</div>
                  <div className="popover-actions">
                    <button onClick={createImportedCurve}>No</button>
                    <button className="primary" onClick={replaceSelectedWithImport}>
                      Yes
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="import-wrap">
              <button
                className="action-button"
                disabled={!selectedCurve}
                onClick={() => {
                  setExportMenuOpen((open) => !open);
                  setAddMenuOpen(false);
                  setImportMenuOpen(false);
                }}
              >
                Export
              </button>
              {exportMenuOpen && selectedCurve && (
                <div className="menu" role="menu">
                  <button onClick={exportSelectedCurveToFile}>File</button>
                  <button onClick={exportSelectedCurveToClipboard}>Clipboard</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="curve-list">
          {curves.length === 0 ? (
            <div className="empty">No curves</div>
          ) : (
            curves.map((curve) => (
              <div key={curve.id} className={`curve-item ${curve.id === selectedCurveId ? "selected" : ""}`}>
                <div className="curve-header" onClick={() => setSelectedCurveId(curve.id)}>
                  <button
                    className="icon-button"
                    aria-label={curve.expanded ? "Collapse curve" : "Expand curve"}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateCurve(curve.id, (current) => ({ ...current, expanded: !current.expanded }));
                    }}
                  >
                    {curve.expanded ? "-" : "+"}
                  </button>
                  {editingNameId === curve.id ? (
                    <input
                      className="rename-input"
                      value={curve.name}
                      autoFocus
                      onBlur={() => setEditingNameId(null)}
                      onChange={(event) => updateCurve(curve.id, (current) => ({ ...current, name: event.target.value }))}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape") {
                          setEditingNameId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="curve-name"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedCurveId(curve.id);
                        if (hoverReadyId === curve.id) setEditingNameId(curve.id);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        setEditingNameId(curve.id);
                      }}
                      onMouseEnter={() => startHoverTimer(curve.id)}
                      onMouseLeave={clearHoverTimer}
                    >
                      <span className="color-dot" style={{ backgroundColor: curve.color }} />
                      <span className="name-text">{curve.name || "Untitled curve"}</span>
                    </button>
                  )}
                  <span className="curve-kind">{curve.type}</span>
                </div>

                {curve.expanded && (
                  <div className="points">
                    {curve.points.map((point, index) => (
                      <div className="point-row" key={point.id}>
                        <span className="point-role">{pointRole(curve, index)}</span>
                        <PointFields point={point} onChange={(updates) => updatePoint(curve.id, point.id, updates)} />
                        <button className="remove-point" aria-label="Remove point" onClick={() => removePoint(curve.id, point.id)}>
                          x
                        </button>
                      </div>
                    ))}
                    <button className="add-point" aria-label="Add point" onClick={() => addPoint(curve.id)}>
                      +
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </main>
  );
}
