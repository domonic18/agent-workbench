import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface TailCursor {
  inode: number;
  offset: number;
  epoch: number;
}

export interface TailLine {
  text: string;
  startOffset: number;
}

export interface TailResult {
  missing: boolean;
  inode: number;
  offset: number;
  epoch: number;
  rotated: boolean;
  truncated: boolean;
  size: number;
  lines: TailLine[];
}

const READ_CHUNK = 1024 * 1024;

/**
 * 从 offset 读追加内容。只消费完整行:末尾没有换行说明还在写,offset 停在行首。
 * inode 变化或文件变短视为轮转/截断,offset 归零并推进 epoch。
 */
export function readNewLines(
  path: string,
  cursor: TailCursor,
  maxBytes = 8 * 1024 * 1024,
): TailResult {
  let size: number;
  let inode: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return missingResult(cursor);
    }
    size = stat.size;
    inode = stat.ino;
  } catch {
    return missingResult(cursor);
  }

  const rotated = cursor.inode !== 0 && inode !== cursor.inode;
  const truncated = !rotated && size < cursor.offset;
  const epoch = cursor.epoch + (rotated || truncated ? 1 : 0);
  const start = rotated || truncated ? 0 : cursor.offset;
  const end = Math.min(size, start + maxBytes);
  if (end <= start) {
    return {
      missing: false,
      inode,
      offset: start,
      epoch,
      rotated,
      truncated,
      size,
      lines: [],
    };
  }

  const chunks: Buffer[] = [];
  const fd = openSync(path, "r");
  try {
    let position = start;
    while (position < end) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK, end - position));
      const read = readSync(fd, buffer, 0, buffer.length, position);
      if (read <= 0) {
        break;
      }
      chunks.push(buffer.subarray(0, read));
      position += read;
    }
  } finally {
    closeSync(fd);
  }

  const data = Buffer.concat(chunks);
  const lastNewline = data.lastIndexOf(0x0a);
  const consumed = lastNewline === -1 ? 0 : lastNewline + 1;
  const lines: TailLine[] = [];
  let lineStart = start;
  if (consumed > 0) {
    const text = data.subarray(0, consumed).toString("utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim() !== "") {
        lines.push({ text: raw, startOffset: lineStart });
      }
      lineStart += Buffer.byteLength(raw, "utf8") + 1;
    }
  }

  return {
    missing: false,
    inode,
    offset: start + consumed,
    epoch,
    rotated,
    truncated,
    size,
    lines,
  };
}

function missingResult(cursor: TailCursor): TailResult {
  return {
    missing: true,
    inode: cursor.inode,
    offset: cursor.offset,
    epoch: cursor.epoch,
    rotated: false,
    truncated: false,
    size: 0,
    lines: [],
  };
}
