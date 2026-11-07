/**
 * 飞书状态卡片统一构建(arch/01 §8):控制台对外播报只有这一套形态——
 * schema 2.0 卡片,header 标题 + 色板,body markdown。协作播报(交接/接单/完成/验收)
 * 与工作事项状态通知共用本模块,避免同一平台出现两套样式。
 */

/** 动态内容打断 markdown 语法(链接/加粗/代码块),防标题在群里注入富文本;换行压成空格防拆行 */
export function mdText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([*_`[\]])/g, "\\$1");
}

export interface StatusCardView {
  /** 卡片头标题,惯例用〔类别〕+ 主体 + 状态 */
  title: string;
  /** 飞书色板:blue / turquoise / green / red / orange / indigo */
  template: string;
  /** body markdown,字段行用「**字段**:值」 */
  body: string;
}

export function statusCard(view: StatusCardView): Record<string, unknown> {
  return {
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: view.title },
      template: view.template,
    },
    body: {
      elements: [{ tag: "markdown", content: view.body }],
    },
  };
}
