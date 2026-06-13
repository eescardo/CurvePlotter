"use client";

import { Dispatch, PointerEvent, RefObject, SetStateAction, useCallback, useEffect, useState } from "react";
import { magnetizeGuide } from "../lib/drawing";
import { clamp } from "../lib/format";
import type { Curve, Point, PointHistorySnapshot } from "../lib/types";

type SvgPoint = {
  x: number;
  y: number;
};

type UsePlotPointerInteractionsOptions = {
  curvesRef: RefObject<Curve[]>;
  svgRef: RefObject<SVGSVGElement | null>;
  plotViewportRef: RefObject<HTMLDivElement | null>;
  centerX: number;
  centerY: number;
  clampedExtent: number;
  effectiveMinExtent: number;
  effectiveMaxExtent: number;
  invertYAxis: boolean;
  setCenterX: Dispatch<SetStateAction<number>>;
  setCenterY: Dispatch<SetStateAction<number>>;
  setExtent: Dispatch<SetStateAction<number>>;
  setSelectedCurveId: Dispatch<SetStateAction<string | null>>;
  updatePoint: (curveId: string, pointId: string, updates: Partial<Pick<Point, "x" | "y">>, recordHistory?: boolean) => void;
  snapshotCurrentPoints: () => PointHistorySnapshot;
  recordPointSnapshot: (snapshot: PointHistorySnapshot) => boolean;
};

function clientToSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): SvgPoint | null {
  const screenMatrix = svg.getScreenCTM();
  if (!screenMatrix) return null;

  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  try {
    return point.matrixTransform(screenMatrix.inverse());
  } catch {
    return null;
  }
}

export function usePlotPointerInteractions({
  curvesRef,
  svgRef,
  plotViewportRef,
  centerX,
  centerY,
  clampedExtent,
  effectiveMinExtent,
  effectiveMaxExtent,
  invertYAxis,
  setCenterX,
  setCenterY,
  setExtent,
  setSelectedCurveId,
  updatePoint,
  snapshotCurrentPoints,
  recordPointSnapshot
}: UsePlotPointerInteractionsOptions) {
  const [dragging, setDragging] = useState<{ curveId: string; pointId: string; startSnapshot: PointHistorySnapshot } | null>(null);
  const [panning, setPanning] = useState<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterX: number;
    startCenterY: number;
  } | null>(null);

  const svgPointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;

      return clientToSvgPoint(svg, clientX, clientY);
    },
    [svgRef]
  );

  const plotPointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const svgPoint = svgPointFromClient(clientX, clientY);
      if (!svgPoint) return null;

      return {
        x: svgPoint.x,
        y: invertYAxis ? svgPoint.y : -svgPoint.y
      };
    },
    [invertYAxis, svgPointFromClient]
  );

  const plotDeltaFromClientMovement = useCallback(
    (startClientX: number, startClientY: number, endClientX: number, endClientY: number) => {
      const start = svgPointFromClient(startClientX, startClientY);
      const end = svgPointFromClient(endClientX, endClientY);
      if (!start || !end) return null;

      const rootDeltaY = end.y - start.y;
      return {
        x: end.x - start.x,
        y: invertYAxis ? rootDeltaY : -rootDeltaY
      };
    },
    [invertYAxis, svgPointFromClient]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (panning) {
        const delta = plotDeltaFromClientMovement(panning.startClientX, panning.startClientY, event.clientX, event.clientY);
        if (!delta) return;

        setCenterX(panning.startCenterX - delta.x);
        setCenterY(panning.startCenterY - delta.y);
        return;
      }

      if (!dragging) return;

      const curve = curvesRef.current.find((item) => item.id === dragging.curveId);
      const pointIndex = curve?.points.findIndex((point) => point.id === dragging.pointId) ?? -1;
      if (!curve || pointIndex < 0) return;

      const rawPoint = plotPointFromClient(event.clientX, event.clientY);
      if (!rawPoint) return;

      const nextPoint = magnetizeGuide(curve, pointIndex, { ...curve.points[pointIndex], ...rawPoint }, clampedExtent);
      updatePoint(curve.id, dragging.pointId, { x: nextPoint.x, y: nextPoint.y }, false);
    },
    [clampedExtent, curvesRef, dragging, panning, plotDeltaFromClientMovement, plotPointFromClient, setCenterX, setCenterY, updatePoint]
  );

  const startPanning = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || dragging) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      setPanning({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startCenterX: centerX,
        startCenterY: centerY
      });
    },
    [centerX, centerY, dragging]
  );

  const finishPanning = useCallback(
    (event?: PointerEvent<SVGSVGElement>) => {
      if (panning && event?.currentTarget.hasPointerCapture(panning.pointerId)) {
        event.currentTarget.releasePointerCapture(panning.pointerId);
      }
      setPanning(null);
    },
    [panning]
  );

  const finishDragging = useCallback(() => {
    if (!dragging) return;

    recordPointSnapshot(dragging.startSnapshot);
    setDragging(null);
  }, [dragging, recordPointSnapshot]);

  const finishPointerInteraction = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      finishDragging();
      finishPanning(event);
    },
    [finishDragging, finishPanning]
  );

  const startPointDrag = useCallback(
    (curveId: string, pointId: string, event: PointerEvent<SVGCircleElement>) => {
      event.stopPropagation();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedCurveId(curveId);
      setDragging({ curveId, pointId, startSnapshot: snapshotCurrentPoints() });
    },
    [setSelectedCurveId, snapshotCurrentPoints]
  );

  const zoomAroundPointer = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();

      const svg = svgRef.current;
      if (!svg) return;

      const likelyTrackpadPan = !event.ctrlKey && event.deltaMode === 0 && (Math.abs(event.deltaX) > 0 || Math.abs(event.deltaY) < 50);

      if (likelyTrackpadPan) {
        const delta = plotDeltaFromClientMovement(event.clientX, event.clientY, event.clientX + event.deltaX, event.clientY + event.deltaY);
        if (!delta) return;

        setCenterX((current) => current + delta.x);
        setCenterY((current) => current + delta.y);
        return;
      }

      const svgPoint = clientToSvgPoint(svg, event.clientX, event.clientY);
      if (!svgPoint) return;

      const viewBoxXMin = centerX - clampedExtent;
      const viewBoxYMin = invertYAxis ? centerY - clampedExtent : -(centerY + clampedExtent);
      const normalizedX = clamp((svgPoint.x - viewBoxXMin) / (clampedExtent * 2), 0, 1);
      const normalizedY = clamp((svgPoint.y - viewBoxYMin) / (clampedExtent * 2), 0, 1);
      const worldX = centerX + (normalizedX * 2 - 1) * clampedExtent;
      const worldY = invertYAxis
        ? centerY + (normalizedY * 2 - 1) * clampedExtent
        : centerY + (1 - normalizedY * 2) * clampedExtent;
      const zoomScale = Math.exp(event.deltaY * 0.001);
      const nextExtent = clamp(clampedExtent * zoomScale, effectiveMinExtent, effectiveMaxExtent);

      setExtent(nextExtent);
      setCenterX(worldX - (normalizedX * 2 - 1) * nextExtent);
      setCenterY(invertYAxis ? worldY - (normalizedY * 2 - 1) * nextExtent : worldY - (1 - normalizedY * 2) * nextExtent);
    },
    [
      centerX,
      centerY,
      clampedExtent,
      effectiveMaxExtent,
      effectiveMinExtent,
      invertYAxis,
      plotDeltaFromClientMovement,
      setCenterX,
      setCenterY,
      setExtent,
      svgRef
    ]
  );

  useEffect(() => {
    const plotViewport = plotViewportRef.current;
    if (!plotViewport) return;

    plotViewport.addEventListener("wheel", zoomAroundPointer, { capture: true, passive: false });
    return () => plotViewport.removeEventListener("wheel", zoomAroundPointer, { capture: true });
  }, [plotViewportRef, zoomAroundPointer]);

  const resetPointerInteractions = useCallback(() => {
    setDragging(null);
    setPanning(null);
  }, []);

  return {
    panningActive: Boolean(panning),
    handlePointerMove,
    startPanning,
    finishPointerInteraction,
    startPointDrag,
    resetPointerInteractions
  };
}
