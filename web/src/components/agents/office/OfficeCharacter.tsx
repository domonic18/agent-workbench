import type { OfficeState } from "./office-state.js";
import styles from "./office.module.css";

export const OFFICE_SLOT_W = 200;
export const OFFICE_SLOT_H = 190;

/**
 * 单个工位：桌、椅、显示器与扁平小人按状态摆姿。
 * 纯装饰图形（外层 SVG aria-hidden），文字信息由叠加的命中按钮承载。
 */
export function OfficeCharacter({ state }: { state: OfficeState }) {
  const seated = state === "running" || state === "idle" || state === "disabled";

  return (
    <g className={state === "disabled" ? styles.dim : undefined}>
      <line x1="14" y1="168" x2="186" y2="168" className={styles.floorLine} />

      {/* 椅背在身体后面，椅面在桌下 */}
      <rect x="80" y="76" width="9" height="52" rx="4" className={styles.furniture} />
      <rect x="84" y="124" width="34" height="7" rx="3.5" className={styles.furniture} />

      {seated ? (
        <g className={state === "idle" ? styles.idleBob : undefined}>
          <rect x="88" y="86" width="26" height="34" rx="10" className={styles.body} />
          <circle cx="101" cy="74" r="11" className={styles.head} />
          <circle cx="97" cy="73" r="1.4" className={styles.face} />
          <circle cx="105" cy="73" r="1.4" className={styles.face} />
          <path d="M97 78 Q101 81 105 78" className={styles.faceLine} />
        </g>
      ) : null}

      {/* 桌面盖住坐姿下半身 */}
      <rect x="46" y="118" width="108" height="8" rx="3" className={styles.deskTop} />
      <rect x="54" y="126" width="6" height="42" className={styles.furniture} />
      <rect x="140" y="126" width="6" height="42" className={styles.furniture} />

      <rect x="76" y="86" width="48" height="32" rx="4" className={styles.monitorFrame} />
      <rect x="80" y="90" width="40" height="24" rx="2" className={styles.screenOff} />
      {state === "running" ? (
        <>
          <rect x="80" y="90" width="40" height="24" rx="2" className={styles.screenActive} />
          <rect x="84" y="93" width="6" height="19" rx="2" className={styles.screenLine} />
          <rect x="93" y="93" width="23" height="4" rx="2" className={styles.screenLine} />
          <rect x="93" y="100" width="16" height="4" rx="2" className={styles.screenLine} />
          <rect x="93" y="107" width="20" height="4" rx="2" className={styles.screenLine} />
        </>
      ) : null}
      <rect x="90" y="113" width="36" height="4" rx="2" className={styles.keyboard} />

      {state === "running" ? (
        <>
          <rect x="86" y="92" width="7" height="24" rx="3.5" className={styles.typingArmL} />
          <rect x="109" y="92" width="7" height="24" rx="3.5" className={styles.typingArmR} />
        </>
      ) : null}

      {state === "idle" ? (
        <g className={styles.idleBob}>
          <rect x="136" y="108" width="12" height="10" rx="2" className={styles.cup} />
          <path d="M148 109 q3 2 0 4" className={styles.cupHandle} />
          <path d="M139 104 q1 -2 0 -4 M144 104 q1 -2 0 -4" className={styles.steam} />
        </g>
      ) : null}

      {state === "hold" ? (
        <>
          <circle cx="168" cy="94" r="9" className={styles.head} />
          <rect x="159" y="104" width="18" height="48" rx="8" className={styles.body} />
          <rect x="161" y="150" width="5" height="18" rx="2.5" className={styles.furniture} />
          <rect x="170" y="150" width="5" height="18" rx="2.5" className={styles.furniture} />
          <g className={styles.holdSway}>
            <path d="M168 52 L180 72 H156 Z" className={styles.warnTriangle} />
            <rect x="166.6" y="59" width="2.8" height="8" rx="1.4" className={styles.warnMark} />
            <rect x="166.6" y="69" width="2.8" height="2.8" rx="1.4" className={styles.warnMark} />
          </g>
        </>
      ) : null}

      {state === "offline" ? (
        <>
          <rect x="170" y="84" width="20" height="84" rx="2" className={styles.door} />
          <g className={styles.dim}>
            <circle cx="150" cy="96" r="9" className={styles.head} />
            <rect x="141" y="106" width="18" height="46" rx="8" className={styles.body} />
            <rect x="143" y="150" width="5" height="18" rx="2.5" className={styles.furniture} />
            <rect x="152" y="150" width="5" height="18" rx="2.5" className={styles.furniture} />
          </g>
        </>
      ) : null}
    </g>
  );
}
