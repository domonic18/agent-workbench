export interface BearerCredential {
  id: string;
  secret: string;
}

/** `Bearer <id>.<secret>`;id 与 base64url 密钥都不含 `.`,按第一个 `.` 切 */
export function parseBearer(header: string | undefined): BearerCredential | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const value = match[1] ?? "";
  const index = value.indexOf(".");
  if (index <= 0 || index === value.length - 1) {
    return undefined;
  }
  return { id: value.slice(0, index), secret: value.slice(index + 1) };
}
