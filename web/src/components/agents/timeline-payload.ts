/**
 * 对话流事件的正文抽取:纯函数,只把 payload 变成可展示的文本,
 * 渲染交给调用方(不同类型要不同的排版)。
 */

export interface TimelinePayloadView {
  /** 事件正文 */
  body: string;
  /** 补充说明:模型名、字符数、Token 明细等 */
  meta?: string;
  /** 正文按代码块排版(工具入参与结果预览) */
  code?: boolean;
  /** 工具返回错误 */
  error?: boolean;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function timelinePayloadView(
  kind: string,
  payload: Record<string, unknown>,
): TimelinePayloadView {
  switch (kind) {
    case "user_message": {
      const text = str(payload.text);
      return {
        body: text ?? "（无正文）",
        ...(count(payload.length) > 0 ? { meta: `${count(payload.length)} 字` } : {}),
      };
    }
    case "assistant_message": {
      const text = str(payload.text);
      const model = str(payload.model);
      return {
        body: text ?? "（无正文）",
        ...(model === null ? {} : { meta: model }),
      };
    }
    case "thinking": {
      const model = str(payload.model);
      return {
        body: "（思考正文不入库，只记录长度）",
        ...(model === null ? {} : { meta: `${count(payload.length)} 字 · ${model}` }),
      };
    }
    case "tool_call": {
      const name = str(payload.name);
      const input = str(payload.input);
      return {
        body: input ?? "（无入参）",
        code: true,
        ...(name === null ? {} : { meta: name }),
      };
    }
    case "tool_result": {
      const preview = str(payload.preview);
      const length = count(payload.length);
      return {
        body: preview ?? "（无返回内容）",
        code: true,
        error: payload.is_error === true,
        ...(length > 0 ? { meta: `${length} 字` } : {}),
      };
    }
    case "system": {
      const subtype = str(payload.subtype);
      return { body: subtype ?? "（系统事件）" };
    }
    case "token_usage": {
      const model = str(payload.model);
      const cacheRead = count(payload.cache_read_tokens);
      const cacheCreation = count(payload.cache_creation_tokens);
      const parts = [
        `输入 ${count(payload.input_tokens)}`,
        `输出 ${count(payload.output_tokens)}`,
      ];
      if (cacheRead > 0) {
        parts.push(`缓存读 ${cacheRead}`);
      }
      if (cacheCreation > 0) {
        parts.push(`缓存写 ${cacheCreation}`);
      }
      return {
        body: parts.join(" · "),
        ...(model === null ? {} : { meta: model }),
      };
    }
    default:
      return { body: "（无正文）" };
  }
}
