/**
 * 画布视口:缩放 / 平移 / 适应容器。
 *
 * 没有图形库可用,视口就是「平移量 + 缩放系数」两个数:
 * 屏幕坐标 = 图形坐标 × scale + offset。图形坐标→屏幕由 CSS transform 负责,
 * 屏幕→图形坐标用 toGraph 换算(拖拽连线落点判定要用)。
 */
import { useCallback, useState } from "react";

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2.5;

export interface Viewport {
  scale: number;
  /** 平移量(屏幕像素) */
  x: number;
  y: number;
}

export const INITIAL_VIEWPORT: Viewport = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 屏幕坐标 → 图形坐标 */
export function toGraph(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.scale,
    y: (screenY - viewport.y) / viewport.scale,
  };
}

/** 以某个屏幕点为锚缩放:锚点下的图形位置保持不动 */
export function zoomAt(
  viewport: Viewport,
  nextScale: number,
  anchorX: number,
  anchorY: number,
): Viewport {
  const scale = clampScale(nextScale);
  const graph = toGraph(anchorX, anchorY, viewport);
  return { scale, x: anchorX - graph.x * scale, y: anchorY - graph.y * scale };
}

/** 适应容器:整张图居中放下,必要时缩小 */
export function fitViewport(
  containerW: number,
  containerH: number,
  graphW: number,
  graphH: number,
): Viewport {
  if (containerW <= 0 || containerH <= 0 || graphW <= 0 || graphH <= 0) {
    return INITIAL_VIEWPORT;
  }
  const scale = clampScale(Math.min(containerW / graphW, containerH / graphH, 1));
  return {
    scale,
    x: (containerW - graphW * scale) / 2,
    y: (containerH - graphH * scale) / 2,
  };
}

export interface ViewportApi {
  viewport: Viewport;
  /** 以屏幕点为锚缩放 */
  zoomAt: (nextScale: number, anchorX: number, anchorY: number) => void;
  /** 相对当前缩放再乘一个系数(滚轮) */
  zoomBy: (factor: number, anchorX: number, anchorY: number) => void;
  panBy: (dx: number, dy: number) => void;
  fit: (containerW: number, containerH: number, graphW: number, graphH: number) => void;
  reset: () => void;
}

export function useViewport(): ViewportApi {
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);

  const zoomAtPoint = useCallback(
    (nextScale: number, anchorX: number, anchorY: number) => {
      setViewport((current) => zoomAt(current, nextScale, anchorX, anchorY));
    },
    [],
  );

  const zoomBy = useCallback(
    (factor: number, anchorX: number, anchorY: number) => {
      setViewport((current) => zoomAt(current, current.scale * factor, anchorX, anchorY));
    },
    [],
  );

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }, []);

  const fit = useCallback(
    (containerW: number, containerH: number, graphW: number, graphH: number) => {
      setViewport(fitViewport(containerW, containerH, graphW, graphH));
    },
    [],
  );

  const reset = useCallback(() => {
    setViewport(INITIAL_VIEWPORT);
  }, []);

  return { viewport, zoomAt: zoomAtPoint, zoomBy, panBy, fit, reset };
}
