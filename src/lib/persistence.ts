import type { PersistedCurvePlotterState } from "./types";

const STATE_DB_NAME = "curve-plotter";
const STATE_DB_VERSION = 1;
const STATE_STORE_NAME = "state";
const STATE_RECORD_KEY = "current";

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

export async function loadPersistedState() {
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

export async function savePersistedState(state: PersistedCurvePlotterState) {
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

export async function deletePersistedState() {
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
