import React from "react";

/**
 * Zone-occupancy context — the defense that makes nesting two full-zone wrappers
 * (the common authoring mistake `<Story><Content>…</Content></Story>`) render
 * CORRECTLY instead of double-offsetting content toward the bottom-right.
 *
 * `Story` and `Content` both fill the CONTENT_ZONE by positioning themselves
 * `position:absolute` at the zone's `(left, top)`. They are ALTERNATIVES, not
 * meant to nest: when `Content` sits inside `Story`, `Story`'s transform creates
 * a new containing block, so the inner absolute offset is applied a SECOND time
 * and content drifts +left/+top out of the zone (and down onto the divider,
 * which then also trips N14).
 *
 * Rather than forbid the nesting (a hard error the AI would keep hitting), the
 * OUTER wrapper publishes "the zone is already occupied" via this context; the
 * INNER wrapper reads it and renders IN-FLOW (filling its parent) instead of
 * re-positioning. One full-zone wrapper owns the absolute placement; any nested
 * one degrades to a plain flex column. Used by `Story` and `Content`.
 */
const ZoneContext = React.createContext<boolean>(false);

/** True when an enclosing full-zone wrapper has already claimed the content zone. */
export function useInZone(): boolean {
  return React.useContext(ZoneContext);
}

/** Mark the subtree as "inside the content zone" so nested wrappers render in-flow. */
export const ZoneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ZoneContext.Provider value={true}>{children}</ZoneContext.Provider>
);
