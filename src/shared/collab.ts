/** 控制台返回、proxy 原样投递的飞书协作通知;uuid 用作飞书侧消息去重 */
export interface CollabNotify {
  chat_id: string;
  text: string;
  uuid: string;
}

export function isCollabNotify(value: unknown): value is CollabNotify {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Partial<Record<keyof CollabNotify, unknown>>;
  return (
    typeof row.chat_id === "string" &&
    row.chat_id !== "" &&
    typeof row.text === "string" &&
    row.text !== "" &&
    typeof row.uuid === "string" &&
    row.uuid !== ""
  );
}
