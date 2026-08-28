export function turnDegreesFromMontageName(
  montageName: string,
): number | null {
  const match = montageName.match(
    /AM_Turn(Left|Right)(\d+(?:\.\d+)?)/i,
  );
  if (!match) {
    return null;
  }
  const degrees = Number(match[2]);
  if (!Number.isFinite(degrees) || degrees <= 0 || degrees > 360) {
    return null;
  }
  return match[1].toLowerCase() === "right" ? degrees : -degrees;
}

export function behaviourTypeForMontageName(
  montageName: string,
): "ENone" | "ERotate" {
  return montageName.toLowerCase().includes("am_turn")
    ? "ERotate"
    : "ENone";
}
