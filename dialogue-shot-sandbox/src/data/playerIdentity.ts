export const DEFAULT_PLAYER_CLASS_PATH =
  "/Game/Seria/Characters/Eric/BP_Eric.BP_Eric_C";

function normalizedUnrealPackagePath(value: unknown): string {
  const text = String(value ?? "").trim().replaceAll("\\", "/");
  const referencedPath = text.match(/'([^']+)'/)?.[1] ?? text;
  const [packagePath] = referencedPath.toLowerCase().split(".");
  return packagePath.endsWith("_c")
    ? packagePath.slice(0, -2)
    : packagePath;
}

export function isEricPlayerClassPath(value: unknown): boolean {
  const packagePath = normalizedUnrealPackagePath(value);
  const segments = packagePath.split("/");
  const assetName = segments.at(-1) ?? "";
  return (
    packagePath.includes("/seria/characters/eric/") &&
    /^bp_eric(?:_|$)/.test(assetName)
  );
}

export function isPlayerModelName(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === "player";
}
