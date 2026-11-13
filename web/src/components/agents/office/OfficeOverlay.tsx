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
import styles from "./office.module.css";

/** 气泡的屏幕高度，与 office.module.css 里的固定高度一致 */
const BUBBLE_H = 20;
/** 分区标签的屏幕高度 */
const ZONE_H = 22;
/** 相邻工位气泡的高低错开量：同一行奇偶列错开，两两就不会撞在一起 */
const BUBBLE_STAGGER = 24;

const BUBBLE_TONE_CLASS: Record<Tone, string> = {
  positive: styles.bubblePositive ?? "",
  warning: styles.bubbleWarning ?? "",
  danger: styles.bubbleDanger ?? "",
  info: styles.bubbleInfo ?? "",
  muted: styles.bubbleMuted ?? "",
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
    <div className={styles.hits}>
      {zones.map((zone) => (
        <span key={zone.key} className={styles.zoneTag} style={zoneOf(zone)}>
          {zone.label} · {zone.count} 个工位
        </span>
      ))}
      {stations.map((station) => {
        const name = agentDisplayName(station.agent);
        const busy = busyText(station.live);
        const tokens = station.live?.todayTokens ?? 0;
        const head = bubbleOf(station);
        return (
          <span key={station.agent.id}>
            {head === null ? null : (
              <span
                className={styles.bubble}
                aria-hidden="true"
                style={{ left: head.left, top: head.top, maxWidth: head.maxWidth }}
              >
                <span className={`${styles.bubbleDot} ${BUBBLE_TONE_CLASS[head.bubble.tone]}`} />
                <span className={styles.bubbleText}>{head.bubble.text}</span>
              </span>
            )}
            {tokens > 0 ? (
              <span
                className={styles.tokenBadge}
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
              className={styles.hit}
              style={{
                ...mapper.toStage(station.slot, STATION.label.x, STATION.label.y),
                maxWidth: mapper.overlayWidthOf(station.slot),
              }}
              aria-label={`${name}，${OFFICE_STATE_LABEL[station.state]}，${busy}`}
              title={`${name} · ${OFFICE_STATE_LABEL[station.state]} · ${busy}`}
              onClick={() => onOpenDetail(station.agent)}
            >
              <RuntimeIcon runtime={station.agent.runtime} size={12} />
              <span className={styles.hitName}>{name}</span>
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
