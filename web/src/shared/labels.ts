import type { HeartbeatState } from "../api/types.js";

export type Tone = "positive" | "warning" | "danger" | "muted" | "info";

/** 状态到文案/色调的映射只在这里维护,组件不自行判断业务枚举(03 §6) */
export const HEARTBEAT_LABEL: Record<HeartbeatState, string> = {
  ok: "在线",
  timeout: "心跳超时",
  offline: "离线",
  unknown: "未上报",
};

export const HEARTBEAT_TONE: Record<HeartbeatState, Tone> = {
  ok: "positive",
  timeout: "warning",
  offline: "danger",
  unknown: "muted",
};

export type RealtimeStatus = "connecting" | "live" | "disconnected";

export const REALTIME_LABEL: Record<RealtimeStatus, string> = {
  connecting: "连接中",
  live: "实时连接",
  disconnected: "实时断开",
};

export const REALTIME_TONE: Record<RealtimeStatus, Tone> = {
  connecting: "muted",
  live: "positive",
  disconnected: "warning",
};

export const VISIBILITY_NOTE =
  "控制台只看到自报的与自己的会话，看不到不属于它的飞书对话。";
