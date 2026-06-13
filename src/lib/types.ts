export type CurveType = "linear" | "bezier";

export type Point = {
  id: string;
  x: number;
  y: number;
};

export type Curve = {
  id: string;
  name: string;
  type: CurveType;
  color: string;
  expanded: boolean;
  points: Point[];
};

export type PendingImport = {
  points: Point[];
};

export type PointHistorySnapshot = {
  curveId: string;
  points: Point[];
}[];

export type PersistedCurvePlotterState = {
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
