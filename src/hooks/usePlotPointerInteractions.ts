"use client";

import { Dispatch, PointerEvent, RefObject, SetStateAction, useCallback, useEffect, useState } from "react";
import { magnetizeGuide } from "../lib/drawing";
import { clamp } from "../lib/format";
import type { Curve, Point, PointHistorySnapshot } from "../lib/types";

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

  const svgPointFromEvent = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };

      const rect = svg.getBoundingClientRect();
      return {
        x: centerX + ((event.clientX - rect.left) / rect.width) * (clampedExtent * 2) - clampedExtent,
        y: invertYAxis
          ? centerY + ((event.clientY - rect.top) / rect.height) * (clampedExtent * 2) - clampedExtent
          : centerY + clampedExtent - ((event.clientY - rect.top) / rect.height) * (clampedExtent * 2)
      };
    },
    [centerX, centerY, clampedExtent, invertYAxis, svgRef]
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
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
    },
    [clampedExtent, curvesRef, dragging, invertYAxis, panning, setCenterX, setCenterY, svgPointFromEvent, svgRef, updatePoint]
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
    },
    [centerX, centerY, clampedExtent, effectiveMaxExtent, effectiveMinExtent, invertYAxis, setCenterX, setCenterY, setExtent, svgRef]
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
