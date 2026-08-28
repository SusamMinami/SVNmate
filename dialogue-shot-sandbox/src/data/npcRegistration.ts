import type {
  DialogueDatabase,
  MissionPositionRow,
  NpcRegistrationCandidate,
  NpcRegistrationWriteItem,
  NpcRegistrationWriteScope,
  SelectedLevelActor,
  SelectedLevelActorsResult,
} from "../types";

const NUMBER_SOURCE = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;

function normalizedAssetPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").toLowerCase();
  const withoutClass = normalized.endsWith("_c")
    ? normalized.slice(0, -2)
    : normalized;
  return withoutClass.split(".")[0];
}

function parseNamedNumbers(
  value: string,
  fields: readonly (readonly string[])[],
  groupNames: readonly string[],
): number[] | null {
  const groupPattern = new RegExp(
    `(?:${groupNames.join("|")})\\s*=\\s*\\(([^()]*)\\)`,
    "i",
  );
  const scope = groupPattern.exec(value)?.[1] ?? value;
  const values = fields.map((aliases) => {
    const pattern = new RegExp(
      `(?:^|[^A-Za-z])(?:${aliases.join("|")})\\s*=\\s*(${NUMBER_SOURCE})`,
      "i",
    );
    const match = pattern.exec(scope);
    return match ? Number(match[1]) : Number.NaN;
  });
  if (values.every(Number.isFinite)) {
    return values;
  }
  if (/[A-Za-z]+\s*=/.test(scope)) {
    return null;
  }
  const looseValues = Array.from(
    scope.matchAll(new RegExp(NUMBER_SOURCE, "g")),
    (match) => Number(match[0]),
  );
  return looseValues.length === 3 && looseValues.every(Number.isFinite)
    ? looseValues
    : null;
}

export function parseUnrealVectorText(value: string): {
  x: number;
  y: number;
  z: number;
} | null {
  const values = parseNamedNumbers(
    value,
    [["x"], ["y"], ["z"]],
    ["Translation", "Location", "RelativeLocation", "Position"],
  );
  return values
    ? { x: values[0], y: values[1], z: values[2] }
    : null;
}

export function parseUnrealRotatorText(value: string): {
  pitch: number;
  yaw: number;
  roll: number;
} | null {
  const values = parseNamedNumbers(
    value,
    [["pitch", "p"], ["yaw", "y"], ["roll", "r"]],
    ["Rotation", "RelativeRotation", "Rotator"],
  );
  return values
    ? { pitch: values[0], yaw: values[1], roll: values[2] }
    : null;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

export function formatUnrealVector(value: {
  x: number;
  y: number;
  z: number;
}): string {
  return `(X=${formatNumber(value.x)},Y=${formatNumber(value.y)},Z=${formatNumber(value.z)})`;
}

export function formatUnrealRotator(value: {
  pitch: number;
  yaw: number;
  roll: number;
}): string {
  return `(Pitch=${formatNumber(value.pitch)},Yaw=${formatNumber(value.yaw)},Roll=${formatNumber(value.roll)})`;
}

export function registrationWriteScope(
  items: readonly NpcRegistrationWriteItem[],
): NpcRegistrationWriteScope {
  return items.every(
    (item) =>
      item.existingModelId !== null &&
      item.existingNpcId !== null &&
      item.newNpc === null,
  )
    ? "target_only"
    : "all";
}

function angleDistance(left: number, right: number): number {
  return Math.abs(((left - right + 180) % 360 + 360) % 360 - 180);
}

function matchesActorPosition(
  target: MissionPositionRow,
  actor: SelectedLevelActor,
): boolean {
  const position = parseUnrealVectorText(target.positionText);
  return Boolean(
    position &&
      Math.abs(position.x - actor.transform.location.x) <= 1 &&
      Math.abs(position.y - actor.transform.location.y) <= 1 &&
      Math.abs(position.z - actor.transform.location.z) <= 1,
  );
}

function matchesActorRotation(
  target: MissionPositionRow,
  actor: SelectedLevelActor,
): boolean {
  const rotation = parseUnrealRotatorText(target.rotationText);
  return Boolean(
    rotation &&
      angleDistance(rotation.pitch, actor.transform.rotation.pitch) <= 0.1 &&
      angleDistance(rotation.yaw, actor.transform.rotation.yaw) <= 0.1 &&
      angleDistance(rotation.roll, actor.transform.rotation.roll) <= 0.1,
  );
}

export function buildNpcRegistrationCandidates(
  database: DialogueDatabase,
  selection: SelectedLevelActorsResult,
): NpcRegistrationCandidate[] {
  const selectedMap = normalizedAssetPath(selection.mapAssetPath);
  const mapOptions = database.mapConfigs.filter(
    (item) => normalizedAssetPath(item.assetPath) === selectedMap,
  );
  const mapIds = new Set(mapOptions.map((item) => item.id));
  const models = Array.from(database.models.values());
  const npcs = Array.from(database.npcs.values());

  return selection.actors.map((actor) => {
    const actorClassPath = normalizedAssetPath(actor.classPath);
    const modelOptions = models.filter(
      (model) =>
        normalizedAssetPath(model.generatedClassPath) === actorClassPath ||
        normalizedAssetPath(model.configuredPath) === actorClassPath,
    );
    const modelIds = new Set(modelOptions.map((model) => model.id));
    const npcOptions = npcs
      .filter(
        (npc) =>
          npc.resourceId !== null && modelIds.has(npc.resourceId),
      )
      .sort((left, right) => left.id - right.id);
    const positionMatches = database.missionPositions.filter(
      (target) =>
        mapIds.has(target.mapId) &&
        matchesActorPosition(target, actor),
    );
    const targetMatches = positionMatches.filter((target) =>
      matchesActorRotation(target, actor),
    );
    const inferredMapId =
      targetMatches[0]?.mapId ??
      positionMatches[0]?.mapId ??
      (mapOptions.length === 1 ? mapOptions[0].id : null);
    const inferredMap = mapOptions.find(
      (item) => item.id === inferredMapId,
    );
    return {
      actor,
      modelOptions,
      npcOptions,
      positionMatches,
      targetMatches,
      mapOptions,
      mapId: inferredMapId,
      mapName: inferredMap?.name ?? mapOptions[0]?.name ?? "",
    };
  });
}
