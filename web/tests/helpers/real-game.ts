import { existsSync } from "node:fs";

// ZHWP_GAME_ZIPS: absolute paths of the game ZIPs separated by ":", built with
// scripts/make-game-zip.mjs --split. Real-data specs skip unless every path
// exists. The ZIPs live outside the repository and are never copied into it.
export function gameZips(): string[] | null {
  const raw = process.env.ZHWP_GAME_ZIPS;
  if (!raw) return null;
  const paths = raw.split(":").filter((entry) => entry.length > 0);
  if (paths.length === 0 || !paths.every((path) => existsSync(path))) return null;
  return paths;
}
