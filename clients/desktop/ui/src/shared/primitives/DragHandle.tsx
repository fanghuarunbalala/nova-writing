/**
 * DragHandle
 *
 * 拖拽调宽手柄。pointer events 全局监听，每次 move 的 delta 经 rAF 节流后
 * 调 onResize；min/max 约束单次拖拽会话累计位移（越界 clamp）。
 *
 * 注：绝对宽度（如 inspector 宽度）的 [min, max] clamp 由持有方（Phase 3
 * InspectorHost）基于本手柄的 delta 计算；这里的 min/max 是会话位移的防御性上界。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./DragHandle.module.css";

export interface DragHandleProps {
  readonly orientation: "horizontal" | "vertical";
  readonly onResize: (deltaPx: number) => void;
  readonly onResizeEnd?: () => void;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
}

export function DragHandle({
  orientation,
  onResize,
  onResizeEnd,
  ariaLabel,
  min,
  max,
}: DragHandleProps) {
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<{ lastPos: number; accumulated: number } | null>(null);
  const pendingDeltaRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);
  onResizeRef.current = onResize;
  onResizeEndRef.current = onResizeEnd;

  const axis = useCallback(
    (event: PointerEvent | ReactPointerEvent<HTMLDivElement>): number =>
      orientation === "horizontal" ? event.clientX : event.clientY,
    [orientation],
  );

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingDeltaRef.current === null || sessionRef.current === null) return;
    const delta = pendingDeltaRef.current;
    pendingDeltaRef.current = null;
    onResizeRef.current(delta);
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (session === null) return;
      const nextPos = axis(event);
      const rawDelta = nextPos - session.lastPos;
      let nextAccumulated = session.accumulated + rawDelta;
      if (min !== undefined) nextAccumulated = Math.max(min, nextAccumulated);
      if (max !== undefined) nextAccumulated = Math.min(max, nextAccumulated);
      const emitted = nextAccumulated - session.accumulated;
      session.accumulated = nextAccumulated;
      session.lastPos = nextPos;
      pendingDeltaRef.current = (pendingDeltaRef.current ?? 0) + emitted;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushPending);
      }
    },
    [axis, flushPending, max, min],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    sessionRef.current = null;
    pendingDeltaRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDragging(false);
    onResizeEndRef.current?.();
  }, [handlePointerMove]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    sessionRef.current = { lastPos: axis(event), accumulated: 0 };
    pendingDeltaRef.current = null;
    setDragging(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [endDrag, handlePointerMove]);

  return (
    <div
      className={[styles.handle, styles[orientation], dragging ? styles.dragging : ""]
        .filter(Boolean)
        .join(" ")}
      role="separator"
      aria-orientation={orientation === "horizontal" ? "horizontal" : "vertical"}
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      data-dragging={dragging || undefined}
    />
  );
}
