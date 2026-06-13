# AGENTS.md

This repo is a small browser-based curve plotting app built with Next.js, React, TypeScript, SVG, CSS modules, and client-side IndexedDB persistence.

## Commands

- Install deps: `pnpm install`
- Local dev: `pnpm run dev`
- Production build and type check: `pnpm run build`
- Start production server: `pnpm run start`
- Lint, when available: `pnpm run lint`

Before handoff, run `pnpm run build` for code changes unless the task is docs-only or otherwise clearly does not touch compiled code.

## Repo Shape

- App routes and global styles: `app/`
- React UI components: `src/components/`
- Reusable React hooks: `src/hooks/`
- Drawing, parsing, persistence, and state helpers: `src/lib/`

Keep route files thin. `app/page.tsx` should remain a route entrypoint, not the main implementation surface.

## UI Structure

- `CurvePlotter` owns top-level app orchestration and cross-component state.
- `PlotterHeader` owns the top control strip.
- `PlotterCanvas` owns SVG rendering and pointer-facing plot UI.
- `CurveSidebar` owns curve list controls, import/export menus, renaming, and point editing.
- `PointFields` owns debounced coordinate field editing.

If a component starts absorbing unrelated responsibilities, extract a hook, helper, or child component before it becomes difficult to reason about.

## Styling

- Use CSS modules for component-specific layout and styling.
- Keep `app/globals.css` limited to design tokens, resets, page-level defaults, and truly global element styles.
- Avoid adding broad global class selectors for component UI.

## State And Persistence

- IndexedDB persistence lives in `src/lib/persistence.ts`.
- Point undo/redo history lives in `src/hooks/usePointHistory.ts`.
- Drawing math and SVG path helpers live in `src/lib/drawing.ts`.
- CSV import/export helpers live in `src/lib/csv.ts`.

Undo/redo is currently in-memory and keyboard-driven. Persisted project state should not silently include undo stacks unless that behavior is intentionally designed.

## Interaction Notes

- The plot uses a native non-passive wheel listener so trackpad pinch and wheel gestures affect the plot instead of the page.
- Page scrolling should remain disabled; sidebar and plot interactions should handle their own scroll, pan, and zoom behavior.
- For UI changes, do a browser smoke test in addition to `pnpm run build` when practical. At minimum, check load, add curve, clear state, and one canvas interaction related to the change.

## Refactors

- Prefer small, cohesive modules over large orchestration files.
- Treat files approaching 500-700 lines as candidates for extraction, especially if they mix state, rendering, persistence, and pointer math.
- Keep helper functions in `src/lib` when they are framework-independent.
- Keep hooks in `src/hooks` when they coordinate React state, refs, effects, or browser events.

## Handoff

When finishing code changes, report:

- main files changed
- checks run
- whether browser/UI verification was performed
- any known risks or follow-up work
