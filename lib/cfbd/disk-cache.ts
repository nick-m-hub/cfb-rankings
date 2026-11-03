import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResponseCache } from "./client";

/**
 * File-per-response cache for scripts (backfill). Node only; do not import from app/ or the cron route,
 * since Vercel's filesystem is read-only and ephemeral.
 *
 * Only use it for completed seasons. The current season changes weekly, so build that client without a cache.
 */
export function createDiskCache(dir = path.join(process.cwd(), ".cache", "cfbd")): ResponseCache {
  const fileFor = (key: string) => {
    const slug = key.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 10);
    return path.join(dir, `${slug}.${hash}.json`);
  };

  return {
    async get(key) {
      try {
        return JSON.parse(await readFile(fileFor(key), "utf8"));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async set(key, value) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      // Write then rename so an interrupted run never leaves a truncated file that parses as a cache hit.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(value));
      await rename(tmp, file);
    },
  };
}
