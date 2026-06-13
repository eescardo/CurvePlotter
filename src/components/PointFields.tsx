"use client";

import { useEffect, useRef, useState } from "react";
import { formatNumber } from "../lib/format";
import type { Point } from "../lib/types";

type PointFieldsProps = {
  point: Point;
  onChange: (updates: Partial<Pick<Point, "x" | "y">>) => void;
};

export function PointFields({ point, onChange }: PointFieldsProps) {
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
