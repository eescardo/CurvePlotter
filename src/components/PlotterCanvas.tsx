"use client";

import type { PointerEvent, RefObject } from "react";
import { POINT_COLOR } from "../lib/constants";
import { buildPath, getBezierGuideContext, isBezierGuideAligned, pointRole } from "../lib/drawing";
import { formatNumber } from "../lib/format";
import type { Curve } from "../lib/types";
import styles from "./PlotterCanvas.module.css";

type PlotterCanvasProps = {
  curves: Curve[];
  selectedCurveId: string | null;
  showPoints: boolean;
  invertYAxis: boolean;
  clampedExtent: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  svgYMin: number;
  xValues: number[];
  yValues: number[];
  xMarkers: number[];
  yMarkers: number[];
  panningActive: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  plotViewportRef: RefObject<HTMLDivElement | null>;
  onCanvasPointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  onCanvasPointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  onCanvasPointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  onPointPointerDown: (curveId: string, pointId: string, event: PointerEvent<SVGCircleElement>) => void;
};

export function PlotterCanvas({
  curves,
  selectedCurveId,
  showPoints,
  invertYAxis,
  clampedExtent,
  xMin,
  xMax,
  yMin,
  yMax,
  svgYMin,
  xValues,
  yValues,
  xMarkers,
  yMarkers,
  panningActive,
  svgRef,
  plotViewportRef,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onPointPointerDown
}: PlotterCanvasProps) {
  return (
    <div className={styles.canvasShell}>
      <div className={styles.plotCard}>
        <div className={`${styles.axisLabelLayer} ${styles.xAxisLabels}`} aria-hidden="true">
          {xMarkers.map((value) => (
            <span
              key={`x-marker-${value}`}
              className={`${styles.axisLabel} ${styles.xAxisLabel}`}
              style={{ left: `${((value - xMin) / (xMax - xMin)) * 100}%` }}
            >
              {formatNumber(value)}
            </span>
          ))}
        </div>
        <div className={`${styles.axisLabelLayer} ${styles.yAxisLabels}`} aria-hidden="true">
          {yMarkers.map((value) => (
            <span
              key={`y-marker-${value}`}
              className={`${styles.axisLabel} ${styles.yAxisLabel}`}
              style={{ top: `${(invertYAxis ? (value - yMin) / (yMax - yMin) : (yMax - value) / (yMax - yMin)) * 100}%` }}
            >
              {formatNumber(value)}
            </span>
          ))}
        </div>
        <div ref={plotViewportRef} className={styles.plotViewport}>
          <svg
            ref={svgRef}
            className={`${styles.plotSvg} ${panningActive ? styles.isPanning : ""}`}
            viewBox={`${xMin} ${svgYMin} ${clampedExtent * 2} ${clampedExtent * 2}`}
            aria-label="Curve plotting grid"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
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
                  {showPoints &&
                    curve.points.map((point, index) => {
                      const role = pointRole(curve, index);
                      const radius = clampedExtent * (role === "anchor" ? 0.025 : 0.019);

                      return (
                        <circle
                          key={point.id}
                          className={styles.point}
                          cx={point.x}
                          cy={point.y}
                          r={radius}
                          fill={POINT_COLOR}
                          stroke={POINT_COLOR}
                          strokeWidth={role === "anchor" ? 3 : 2}
                          opacity={0.3}
                          vectorEffect="non-scaling-stroke"
                          onPointerDown={(event) => onPointPointerDown(curve.id, point.id, event)}
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
  );
}
