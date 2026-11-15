import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import type { AgentSummary } from "../../api/identity.js";
import type { AgentGroupSummary } from "../../api/types.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { IconButton } from "../ui/IconButton.js";
import { HANDLE_W, layoutGraph, nodeAt } from "./layout.js";
import { DelegationNode, edgePath } from "./DelegationNode.js";
import { toGraph, useViewport } from "./useViewport.js";
import styles from "./DelegationCanvas.module.css";

const ZOOM_STEP = 1.25;

export interface DelegationCanvasProps {
  agents: AgentSummary[];
  groups: AgentGroupSummary[];
  /** 发起方 → 目标引用(Agent id 或组 id) */
  selection: Record<string, readonly string[]>;
  /** 点节点:选中发起方 */
  onSelect: (agentId: string | null) => void;
  /** 拖拽连线落点:切换一条委派边 */
  onToggleTarget: (initiatorId: string, targetId: string) => void;
  selectedId: string | null;
}

interface DragState {
  fromKey: string;
  /** 拖拽中的指针位置(图形坐标) */
  x: number;
  y: number;
}

/**
 * 委派关系画布:可缩放平移,可从节点手柄拖线到目标节点建立委派。
 *
 * 拖拽只是快捷路径,键盘可达的命中按钮与下方编辑面板都保留——
 * 可访问性不能只靠拖拽。
 */
export function DelegationCanvas({
  agents,
  groups,
  selection,
  onSelect,
  onToggleTarget,
  selectedId,
}: DelegationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  /** 用户手动缩放/平移过就不自动适应了——别把人调好的视角抢回去 */
  const adjusted = useRef(false);
  const { viewport, zoomBy, panBy, fit, reset } = useViewport();

  const nameOf = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agentDisplayName(agent)])),
    [agents],
  );

  const layout = useMemo(
    () =>
      layoutGraph(agents, groups, (agent) => selection[agent.id] ?? agent.allowedTargets),
    [agents, groups, selection],
  );

  /** 容器尺寸:适应容器与缩放都要用 */
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const update = (): void => {
      setSize({ w: element.clientWidth, h: element.clientHeight });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * 自动适应:版面变了或容器变了就重排一次。
   *
   * 用户手动缩放/平移过之后不再自动适应——把人调好的视角抢回去比塞在视野外更烦。
   */
  useEffect(() => {
    if (adjusted.current) return;
    fit(size.w, size.h, layout.width, layout.height);
  }, [fit, layout.height, layout.width, size.h, size.w]);

  /** 滚轮缩放要拦默认滚动,得用非 passive 监听 */
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      adjusted.current = true;
      zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const toGraphPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect === null || rect === undefined) {
        return { x: 0, y: 0 };
      }
      return toGraph(clientX - rect.left, clientY - rect.top, viewport);
    },
    [viewport],
  );

  /** 落在目标节点上就建立/取消一条委派 */
  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      setDrag((current) => {
        if (current === null) return null;
        const point = toGraphPoint(clientX, clientY);
        const target = nodeAt(layout.nodes, point.x, point.y);
        // 落在组节点上 = 授权整组(目标 id 就是组 id,白名单里存的就是它)
        if (target !== null && target.key !== current.fromKey) {
          onToggleTarget(current.fromKey, target.key);
        }
        return null;
      });
    },
    [layout.nodes, onToggleTarget, toGraphPoint],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      // 点在节点手柄上 = 开始连线;点空白 = 开始平移
      if (target.dataset.handle === "1") {
        const source = target.closest("[data-node-key]");
        const key = source?.getAttribute("data-node-key") ?? null;
        if (key !== null) {
          event.preventDefault();
          const point = toGraphPoint(event.clientX, event.clientY);
          setDrag({ fromKey: key, x: point.x, y: point.y });
          return;
        }
      }
      setPanning(true);
      panStart.current = { x: event.clientX, y: event.clientY };
    },
    [toGraphPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (drag !== null) {
        const point = toGraphPoint(event.clientX, event.clientY);
        setDrag({ fromKey: drag.fromKey, x: point.x, y: point.y });
        return;
      }
      const start = panStart.current;
      if (!panning || start === null) return;
      adjusted.current = true;
      panBy(event.clientX - start.x, event.clientY - start.y);
      panStart.current = { x: event.clientX, y: event.clientY };
    },
    [drag, panning, panBy, toGraphPoint],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (drag !== null) {
        finishDrag(event.clientX, event.clientY);
      }
      setPanning(false);
      panStart.current = null;
    },
    [drag, finishDrag],
  );

  const fitToScreen = useCallback(() => {
    fit(size.w, size.h, layout.width, layout.height);
  }, [fit, layout.height, layout.width, size.h, size.w]);

  const dragSource =
    drag === null ? null : (layout.nodes.find((node) => node.key === drag.fromKey) ?? null);

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.canvas}
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="delegation-canvas"
      >
        <svg className={styles.svg} width={size.w} height={size.h} role="img" aria-label="委派关系图">
          <defs>
            <marker
              id="aw-delegation-arrow"
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={7}
              markerHeight={7}
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={styles.arrowHead} />
            </marker>
          </defs>
          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
            {layout.edges.map((edge) => {
              const active =
                selectedId !== null &&
                (edge.from.key === selectedId || edge.to.key === selectedId);
              return (
                <path
                  key={`${edge.from.key}->${edge.to.key}`}
                  d={edgePath(edge.from, edge.to)}
                  className={active ? styles.edgeActive : styles.edge}
                  markerEnd="url(#aw-delegation-arrow)"
                />
              );
            })}
            {dragSource !== null && drag !== null ? (
              <path
                d={`M ${dragSource.x + dragSource.width} ${dragSource.y + dragSource.height / 2} L ${drag.x} ${drag.y}`}
                className={styles.edgeDraft}
              />
            ) : null}
            {layout.nodes.map((node) => (
              <DelegationNode
                key={node.key}
                node={node}
                active={node.key === selectedId}
                memberNames={
                  node.kind === "group"
                    ? node.group.memberIds
                        .map((id) => nameOf.get(id))
                        .filter((name): name is string => name !== undefined)
                    : []
                }
              />
            ))}
          </g>
        </svg>
        <div
          className={styles.hits}
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {layout.nodes.map((node) => (
            <button
              key={node.key}
              type="button"
              className={styles.hit}
              data-node-key={node.key}
              style={{
                left: node.x,
                top: node.y,
                width: node.width - HANDLE_W,
                height: node.height,
              }}
              aria-label={
                node.kind === "agent"
                  ? `${agentDisplayName(node.agent)}（委派 ${(selection[node.key] ?? []).length} 方）`
                  : `组 ${node.group.name}（${node.group.memberIds.length} 个成员）`
              }
              aria-pressed={node.key === selectedId}
              onClick={() => {
                if (node.kind === "agent") {
                  onSelect(node.key === selectedId ? null : node.key);
                }
              }}
            />
          ))}
        </div>
      </div>
      <div className={styles.controls}>
        <IconButton
          label="放大"
          icon={<Plus size={14} />}
          onClick={() => {
            adjusted.current = true;
            zoomBy(ZOOM_STEP, size.w / 2, size.h / 2);
          }}
        />
        <IconButton
          label="缩小"
          icon={<Minus size={14} />}
          onClick={() => {
            adjusted.current = true;
            zoomBy(1 / ZOOM_STEP, size.w / 2, size.h / 2);
          }}
        />
        <IconButton
          label="适应画布"
          icon={<Maximize2 size={14} />}
          onClick={() => {
            adjusted.current = false;
            fitToScreen();
          }}
        />
        <IconButton label="重置视图" icon={<RotateCcw size={14} />} onClick={reset} />
        <span className={styles.scale}>{Math.round(viewport.scale * 100)}%</span>
      </div>
    </div>
  );
}
