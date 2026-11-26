import type { AgentRosterSummary } from "../../../api/identity.js";
import type { OverviewAgent } from "../../../api/types.js";
import { agentDisplayName } from "../../../shared/agent-label.js";
import { formatTokens } from "../../../shared/format.js";
import { RuntimeIcon } from "../../../shared/runtime-icon.js";
import type { Tone } from "../../../shared/tone.js";
import { officeBubbleOf } from "./office-behavior.js";
import { OFFICE_STATE_LABEL } from "./office-state.js";
import type { StageMapper, StationScene, ZoneView } from "./scene-layout.js";
import { STATION } from "./pix/geometry.js";
import { cn } from "../../../lib/utils.js";

/** 气泡的屏幕高度，与气泡样式的固定高度（h-5）一致 */
const BUBBLE_H = 20;
/** 分区标签的屏幕高度 */
const ZONE_H = 22;
/** 相邻工位气泡的高低错开量：同一行奇偶列错开，两两就不会撞在一起 */
const BUBBLE_STAGGER = 24;

const BUBBLE_TONE_CLASS: Record<Tone, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  muted: "bg-muted",
};

export interface OfficeOverlayProps {
  stations: readonly StationScene[];
  zones: readonly ZoneView[];
  mapper: StageMapper;
  /** 「刚刚完成」这类时效文案的判断时刻 */
  now: number;
  onOpenDetail: (agent: AgentRosterSummary) => void;
}

/**
 * 命中层：分区标签、头顶气泡、用量徽标与名牌。
 *
 * 这一层是屏幕固定的 HTML，不随房间缩小——宽度一律按工位实际间距收敛，
 * 否则窄容器里两两相撞。
 */
export function OfficeOverlay({
  stations,
  zones,
  mapper,
  now,
  onOpenDetail,
}: OfficeOverlayProps) {
  /** 气泡在屏幕上的位置与宽度上限 */
  const bubbleOf = (station: StationScene) => {
    const bubble = officeBubbleOf(station.state, station.live, now);
    if (bubble === null) return null;
    const anchor = mapper.toStage(station.slot, STATION.bubble.x, STATION.bubble.y);
    const stagger = station.slot.col % 2 === 1 ? -BUBBLE_STAGGER : 0;
    return {
      bubble,
      left: anchor.left,
      top: anchor.top + stagger,
      maxWidth: Math.max(40, Math.min(140, Math.floor(mapper.pitchOf(station.slot) - 10))),
    };
  };

  /**
   * 分区标签的位置。
   *
   * 标签挂在组内第一个工位头顶，而气泡也占那一列——两者相撞时把标签再往上挪，
   * 挪到气泡上沿之上，宁可标签离角色远一点，也不要和气泡叠在一起。
   */
  const zoneOf = (zone: ZoneView) => {
    const anchor = mapper.toStage(zone.first.slot, STATION.zone.x, STATION.zone.y);
    const head = bubbleOf(zone.first);
    if (head === null) return anchor;
    return { left: anchor.left, top: Math.min(anchor.top, head.top - BUBBLE_H - 4 - ZONE_H) };
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {zones.map((zone) => (
        <span key={zone.key} className="absolute inline-flex items-center h-[22px] px-2 border border-border-strong rounded-full bg-surface text-text-secondary text-xs leading-[18px] whitespace-nowrap -translate-x-1/2 shadow-[0_1px_2px_rgb(15_23_42/12%)] pointer-events-auto" style={zoneOf(zone)}>
          {zone.label} · {zone.count} 个工位
        </span>
      ))}
      {stations.map((station) => {
        const name = agentDisplayName(station.agent);
        const busy = busyText(station.live);
        const tokens = station.live?.todayTokens ?? 0;
        const head = bubbleOf(station);
        return (
          <span key={station.agent.id} className="pointer-events-auto">
            {head === null ? null : (
              <span
                className="absolute inline-flex items-center gap-1 h-5 px-2 border border-border-strong rounded-full bg-surface text-text-secondary text-2xs leading-4 whitespace-nowrap -translate-x-1/2 -translate-y-full shadow-[0_1px_2px_rgb(15_23_42/12%)] pointer-events-none"
                aria-hidden="true"
                style={{ left: head.left, top: head.top, maxWidth: head.maxWidth }}
              >
                <span className={cn("shrink-0 w-1.5 h-1.5 rounded-full", BUBBLE_TONE_CLASS[head.bubble.tone])} />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{head.bubble.text}</span>
              </span>
            )}
            {tokens > 0 ? (
              <span
                className="absolute px-2 py-px border border-accent-border rounded-full bg-accent-soft text-accent text-2xs whitespace-nowrap overflow-hidden text-ellipsis -translate-x-1/2 pointer-events-none"
                style={{
                  ...mapper.toStage(station.slot, STATION.badge.x, STATION.badge.y),
                  maxWidth: mapper.overlayWidthOf(station.slot),
                }}
              >
                今日 {formatTokens(tokens)} tok
              </span>
            ) : null}
            <button
              type="button"
              className="absolute flex items-center justify-center gap-1 max-w-[150px] px-2 py-0.5 border border-border-strong rounded-full bg-surface text-foreground text-xs cursor-pointer -translate-x-1/2 shadow-[0_1px_2px_rgb(15_23_42/12%)] enabled:hover:border-border-hover enabled:hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              style={{
                ...mapper.toStage(station.slot, STATION.label.x, STATION.label.y),
                maxWidth: mapper.overlayWidthOf(station.slot),
              }}
              aria-label={`${name}，${OFFICE_STATE_LABEL[station.state]}，${busy}`}
              title={`${name} · ${OFFICE_STATE_LABEL[station.state]} · ${busy}`}
              onClick={() => onOpenDetail(station.agent)}
            >
              <RuntimeIcon runtime={station.agent.runtime} size={12} />
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** 工位在忙什么：先说任务标题，没有标题但在跑就说指令，都没有就是待命 */
function busyText(live: OverviewAgent | undefined): string {
  const title = live?.currentTaskTitle ?? null;
  if (title !== null) {
    return title;
  }
  if (live?.running === true) {
    return live.currentInstruction ?? "运行中";
  }
  return "无进行中任务";
}
