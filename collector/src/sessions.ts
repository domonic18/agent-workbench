import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AttributionIndex } from "./attribution.js";
import type { StreamStatus } from "./state.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionFile {
  sessionId: string;
  path: string;
}

export function listSessionFiles(claudeDir: string): SessionFile[] {
  const root = join(claudeDir, "projects");
  const files: SessionFile[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return files;
  }
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const sessionId = name.slice(0, -".jsonl".length);
      if (UUID.test(sessionId)) {
        files.push({ sessionId: sessionId.toLowerCase(), path: join(root, dir, name) });
      }
    }
  }
  return files;
}

export interface Classification {
  status: StreamStatus;
  project: string | null;
}

export function classifyStream(
  index: AttributionIndex,
  sessionId: string,
  registered: ReadonlySet<string>,
): Classification {
  const projects = index.resolve(sessionId);
  if (projects.length === 0) {
    return { status: "unattributed", project: null };
  }
  if (projects.length > 1) {
    return { status: "ambiguous", project: null };
  }
  const project = projects[0] ?? null;
  if (project === null) {
    return { status: "unattributed", project: null };
  }
  return { status: registered.has(project) ? "ok" : "unregistered", project };
}
