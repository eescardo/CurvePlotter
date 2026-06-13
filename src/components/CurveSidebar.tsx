"use client";

import { ChangeEvent, useRef, useState } from "react";
import { pointRole } from "../lib/drawing";
import type { Curve, CurveType, PendingImport, Point } from "../lib/types";
import { PointFields } from "./PointFields";
import styles from "./CurveSidebar.module.css";

type CurveSidebarProps = {
  curves: Curve[];
  selectedCurveId: string | null;
  selectedCurveExists: boolean;
  pendingImport: PendingImport | null;
  onAddCurve: (type: CurveType) => void;
  onDeleteSelectedCurve: () => void;
  onSelectCurve: (curveId: string) => void;
  onUpdateCurve: (curveId: string, updater: (curve: Curve) => Curve) => void;
  onUpdatePoint: (curveId: string, pointId: string, updates: Partial<Pick<Point, "x" | "y">>) => void;
  onAddPoint: (curveId: string) => void;
  onRemovePoint: (curveId: string, pointId: string) => void;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportClipboard: () => void;
  onCreateImportedCurve: () => void;
  onReplaceSelectedWithImport: () => void;
  onExportFile: () => void;
  onExportClipboard: () => void;
};

export function CurveSidebar({
  curves,
  selectedCurveId,
  selectedCurveExists,
  pendingImport,
  onAddCurve,
  onDeleteSelectedCurve,
  onSelectCurve,
  onUpdateCurve,
  onUpdatePoint,
  onAddPoint,
  onRemovePoint,
  onImportFile,
  onImportClipboard,
  onCreateImportedCurve,
  onReplaceSelectedWithImport,
  onExportFile,
  onExportClipboard
}: CurveSidebarProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [hoverReadyId, setHoverReadyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

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
    <aside className={styles.sidebar} aria-label="Curve controls">
      <div className={styles.sidebarToolbar}>
        <div className={styles.actions}>
          <div className={styles.menuWrap}>
            <button
              className={`${styles.actionButton} ${styles.primary}`}
              onClick={() => {
                setAddMenuOpen((open) => !open);
                setImportMenuOpen(false);
                setExportMenuOpen(false);
              }}
            >
              + Add
            </button>
            {addMenuOpen && (
              <div className={styles.menu} role="menu">
                <button
                  onClick={() => {
                    onAddCurve("linear");
                    setAddMenuOpen(false);
                  }}
                >
                  Linear
                </button>
                <button
                  onClick={() => {
                    onAddCurve("bezier");
                    setAddMenuOpen(false);
                  }}
                >
                  Bezier
                </button>
              </div>
            )}
          </div>
          <button className={`${styles.actionButton} ${styles.danger}`} disabled={!selectedCurveExists} onClick={onDeleteSelectedCurve}>
            x Delete
          </button>
          <div className={styles.importWrap}>
            <button
              className={styles.actionButton}
              onClick={() => {
                setImportMenuOpen((open) => !open);
                setAddMenuOpen(false);
                setExportMenuOpen(false);
              }}
            >
              Import
            </button>
            <input ref={fileInputRef} className={styles.hiddenInput} type="file" accept=".csv,text/csv,text/plain" onChange={onImportFile} />
            {importMenuOpen && !pendingImport && (
              <div className={styles.menu} role="menu">
                <button onClick={() => fileInputRef.current?.click()}>File</button>
                <button
                  onClick={() => {
                    onImportClipboard();
                    setImportMenuOpen(false);
                  }}
                >
                  Clipboard
                </button>
              </div>
            )}
            {pendingImport && selectedCurveExists && (
              <div className={styles.popover}>
                <div className={styles.popoverTitle}>Do you want to replace current curve points?</div>
                <div className={styles.popoverActions}>
                  <button onClick={onCreateImportedCurve}>No</button>
                  <button className={styles.primary} onClick={onReplaceSelectedWithImport}>
                    Yes
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className={styles.importWrap}>
            <button
              className={styles.actionButton}
              disabled={!selectedCurveExists}
              onClick={() => {
                setExportMenuOpen((open) => !open);
                setAddMenuOpen(false);
                setImportMenuOpen(false);
              }}
            >
              Export
            </button>
            {exportMenuOpen && selectedCurveExists && (
              <div className={styles.menu} role="menu">
                <button
                  onClick={() => {
                    onExportFile();
                    setExportMenuOpen(false);
                  }}
                >
                  File
                </button>
                <button
                  onClick={() => {
                    onExportClipboard();
                    setExportMenuOpen(false);
                  }}
                >
                  Clipboard
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.curveList}>
        {curves.length === 0 ? (
          <div className={styles.empty}>No curves</div>
        ) : (
          curves.map((curve) => (
            <div key={curve.id} className={`${styles.curveItem} ${curve.id === selectedCurveId ? styles.selected : ""}`}>
              <div className={styles.curveHeader} onClick={() => onSelectCurve(curve.id)}>
                <button
                  className={styles.iconButton}
                  aria-label={curve.expanded ? "Collapse curve" : "Expand curve"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdateCurve(curve.id, (current) => ({ ...current, expanded: !current.expanded }));
                  }}
                >
                  {curve.expanded ? "-" : "+"}
                </button>
                {editingNameId === curve.id ? (
                  <input
                    className={styles.renameInput}
                    value={curve.name}
                    autoFocus
                    onBlur={() => setEditingNameId(null)}
                    onChange={(event) => onUpdateCurve(curve.id, (current) => ({ ...current, name: event.target.value }))}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === "Escape") {
                        setEditingNameId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    className={styles.curveName}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectCurve(curve.id);
                      if (hoverReadyId === curve.id) setEditingNameId(curve.id);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setEditingNameId(curve.id);
                    }}
                    onMouseEnter={() => startHoverTimer(curve.id)}
                    onMouseLeave={clearHoverTimer}
                  >
                    <span className={styles.colorDot} style={{ backgroundColor: curve.color }} />
                    <span className={styles.nameText}>{curve.name || "Untitled curve"}</span>
                  </button>
                )}
                <span className={styles.curveKind}>{curve.type}</span>
              </div>

              {curve.expanded && (
                <div className={styles.points}>
                  {curve.points.map((point, index) => (
                    <div className={styles.pointRow} key={point.id}>
                      <span className={styles.pointRole}>{pointRole(curve, index)}</span>
                      <PointFields point={point} onChange={(updates) => onUpdatePoint(curve.id, point.id, updates)} />
                      <button className={styles.removePoint} aria-label="Remove point" onClick={() => onRemovePoint(curve.id, point.id)}>
                        x
                      </button>
                    </div>
                  ))}
                  <button className={styles.addPoint} aria-label="Add point" onClick={() => onAddPoint(curve.id)}>
                    +
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
