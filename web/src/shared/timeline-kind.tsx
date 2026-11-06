import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  CircleHelp,
  MessageSquare,
  Settings,
  Terminal,
  type LucideIcon,
} from "lucide-react";

export interface TimelineKindMeta {
  label: string;
  Icon: LucideIcon;
}

/** 对话流事件类型的展示口径:文案与图标只在这里维护 */
export const TIMELINE_KIND_META: Record<string, TimelineKindMeta> = {
  user_message: { label: "用户消息", Icon: MessageSquare },
  assistant_message: { label: "助手回复", Icon: Bot },
  thinking: { label: "思考", Icon: Brain },
  tool_call: { label: "工具调用", Icon: Terminal },
  tool_result: { label: "工具结果", Icon: CheckCircle2 },
  system: { label: "系统", Icon: Settings },
  token_usage: { label: "Token 用量", Icon: Activity },
};

/** 采集侧出现过的未知类型:不丢内容,用中性图标兜底 */
export const TIMELINE_OTHER_KIND: TimelineKindMeta = { label: "其他", Icon: CircleHelp };

export function timelineKindMeta(kind: string): TimelineKindMeta {
  return TIMELINE_KIND_META[kind] ?? TIMELINE_OTHER_KIND;
}

/** 类型过滤选项:只覆盖有正文的类型,token_usage / system 归入「全部」 */
export const TIMELINE_FILTER_OPTIONS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "user_message", label: "用户消息" },
  { key: "assistant_message", label: "助手回复" },
  { key: "thinking", label: "思考" },
  { key: "tool_call", label: "工具调用" },
  { key: "tool_result", label: "工具结果" },
];
