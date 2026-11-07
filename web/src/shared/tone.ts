/** 语义色调：基元层唯一的「状态 → 颜色」类型来源
 *
 * 放在 shared/tone.ts 而不是 labels.ts，是为了让基元层（components/ui/）可以只依赖
 * 一个纯类型模块，不 import 带业务枚举的 labels（03 §6 封装纪律第 5 条）。
 */
export type Tone = "positive" | "warning" | "danger" | "muted" | "info";
