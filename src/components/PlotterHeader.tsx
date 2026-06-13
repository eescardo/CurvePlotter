"use client";

import { formatNumber } from "../lib/format";
import styles from "./PlotterHeader.module.css";

type PlotterHeaderProps = {
  clampedExtent: number;
  effectiveMinExtent: number;
  effectiveMaxExtent: number;
  minExtent: number;
  maxExtent: number;
  showPoints: boolean;
  invertYAxis: boolean;
  onClear: () => void;
  onExtentChange: (value: number | ((current: number) => number)) => void;
  onMinExtentChange: (value: number) => void;
  onMaxExtentChange: (value: number) => void;
  onShowPointsChange: (value: boolean) => void;
  onInvertYAxisChange: (value: boolean) => void;
};

export function PlotterHeader({
  clampedExtent,
  effectiveMinExtent,
  effectiveMaxExtent,
  minExtent,
  maxExtent,
  showPoints,
  invertYAxis,
  onClear,
  onExtentChange,
  onMinExtentChange,
  onMaxExtentChange,
  onShowPointsChange,
  onInvertYAxisChange
}: PlotterHeaderProps) {
  return (
    <div className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.brandTitle}>Curve Plotter</div>
        <div className={styles.brandSubtitle}>XY grid drawing for linear and cubic Bezier curves</div>
      </div>
      <div className={styles.zoomControls}>
        <button className={styles.actionButton} onClick={onClear}>
          Clear
        </button>
        <label className={styles.checkOption}>
          <input type="checkbox" checked={showPoints} onChange={(event) => onShowPointsChange(event.target.checked)} />
          Show points
        </label>
        <label className={styles.checkOption}>
          <input type="checkbox" checked={invertYAxis} onChange={(event) => onInvertYAxisChange(event.target.checked)} />
          Invert Y
        </label>
        <button
          className={styles.iconButton}
          aria-label="Zoom out"
          onClick={() => onExtentChange((current) => Math.min(effectiveMaxExtent, Math.max(effectiveMinExtent, current * 1.25)))}
        >
          -
        </button>
        <button
          className={styles.iconButton}
          aria-label="Zoom in"
          onClick={() => onExtentChange((current) => Math.min(effectiveMaxExtent, Math.max(effectiveMinExtent, current / 1.25)))}
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
          onChange={(event) => onExtentChange(Number(event.target.value))}
        />
        <span className={styles.extentPill}>extent +/- {formatNumber(clampedExtent)}</span>
        <div className={styles.rangeFields}>
          <label>
            min
            <input
              aria-label="Minimum zoom extent"
              type="number"
              min="0.1"
              step="0.1"
              value={minExtent}
              onChange={(event) => onMinExtentChange(Number(event.target.value))}
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
              onChange={(event) => onMaxExtentChange(Number(event.target.value))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
