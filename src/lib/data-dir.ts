import path from "path";

/**
 * The desk's one writable directory: the SQLite database, filed document
 * bytes, and the private contact overlays all live here.
 *
 * Locally it is `./data` next to the repo, gitignored. On a hosted instance
 * `DESK_DATA_DIR` points at a mounted volume so the record survives a
 * redeploy — a container filesystem does not. Because everything the desk
 * persists funnels through this one path, mounting a single volume is the
 * whole of the hosting story.
 */
export const DATA_DIR =
  process.env.DESK_DATA_DIR ?? path.join(process.cwd(), "data");

/** A path inside the data directory, e.g. `dataPath("files", accountId)`. */
export function dataPath(...segments: string[]): string {
  return path.join(DATA_DIR, ...segments);
}
