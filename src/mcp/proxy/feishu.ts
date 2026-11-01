import * as Lark from "@larksuiteoapi/node-sdk";
import type { CollabNotify } from "../../shared/collab.js";

export interface FeishuBotIdentity {
  openId: string;
  name: string;
}

export interface FeishuNotifier {
  /** /bot/v3/info 自报 open_id 与展示名,供控制台渲染 <at> */
  identify(): Promise<FeishuBotIdentity>;
  send(notify: CollabNotify): Promise<void>;
}

interface BotInfoResponse {
  code?: number;
  msg?: string;
  bot?: { open_id?: string; app_name?: string };
}

function ensureOk(
  response: { code?: number | undefined; msg?: string | undefined },
  action: string,
): void {
  const code = response.code ?? 0;
  if (code !== 0) {
    throw new Error(`飞书${action}失败: code=${code} msg=${response.msg ?? ""}`);
  }
}

export function createFeishuNotifier(client: Lark.Client): FeishuNotifier {
  return {
    identify: async () => {
      const response = (await client.request({
        method: "GET",
        url: "/open-apis/bot/v3/info",
      })) as BotInfoResponse;
      ensureOk(response, "查询 bot 身份");
      const openId = response.bot?.open_id;
      const name = response.bot?.app_name;
      if (openId === undefined || openId === "" || name === undefined || name === "") {
        throw new Error("飞书 bot 信息缺 open_id 或 app_name");
      }
      return { openId, name };
    },
    send: async (notify) => {
      const response = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: notify.chat_id,
          msg_type: "text",
          content: JSON.stringify({ text: notify.text }),
          // 飞书侧按 uuid 去重,控制台重试不会在群里刷出重复通知
          uuid: notify.uuid,
        },
      });
      ensureOk(response, "发送协作通知");
    },
  };
}
