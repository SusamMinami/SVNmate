import type {
  NpcMigrationAnimationRoleAssets,
  NpcMigrationFileOperation,
  NpcMigrationMontagePlan,
  NpcMigrationPlan,
  NpcMigrationPlanRequest,
  NpcMigrationStandardAbpTemplate,
  NpcMigrationStep,
} from "../types";

const ASSET_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const PACKAGE_PATH_PATTERN = /^\/Game(?:\/[A-Za-z0-9_]+)+$/;
const HUMANOID_TEMPLATE_ROLES: Array<
  keyof NpcMigrationAnimationRoleAssets
> = [
  "lookDown",
  "lookForward",
  "lookUp",
  "idleStand",
  "impact",
  "interact",
];
const ANIMAL_TEMPLATE_ROLES: Array<
  keyof NpcMigrationAnimationRoleAssets
> = ["idleStand", "walk"];

function normalizeSlashes(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

export function normalizeNpcPackagePath(value: string): string {
  const normalized = normalizeSlashes(value);
  return normalized.startsWith("/Game/")
    ? normalized.replace(/\/+/g, "/")
    : normalized;
}

export function deriveNpcName(meshName: string): string {
  return meshName.trim().replace(/^SK_/i, "");
}

export function deriveAnimalAnimationName(npcName: string): string {
  const normalized = npcName.trim();
  return normalized.match(/^(.+_[A-Za-z][A-Za-z0-9_]*?)\d{2}$/)?.[1] ??
    normalized;
}

function deriveAnimalBlueprintPackagePath(
  targetPackagePath: string,
  animationName: string,
): string {
  const marker = "/biosystems/";
  const markerIndex = targetPackagePath.toLowerCase().indexOf(marker);
  if (markerIndex >= 0) {
    return `${targetPackagePath.slice(0, markerIndex)}/NPC/${animationName}`;
  }
  return `/Game/Seria/NPC/${animationName}`;
}

export function deriveNpcMigrationIdentity(
  npcName: string,
  targetPackagePath: string,
  template: NpcMigrationStandardAbpTemplate,
): {
  animationName: string;
  animationPrefix: string;
  blueprintName: string;
  animationBlueprintName: string;
  blueprintPackagePath: string;
  animationPackagePath: string;
  animationBlueprintPackagePath: string;
  montagePackagePath: string;
} {
  const normalizedTargetPackagePath =
    normalizeNpcPackagePath(targetPackagePath);
  const isAnimal = template === "animal";
  const animationName = isAnimal
    ? deriveAnimalAnimationName(npcName)
    : npcName;
  const blueprintPackagePath = isAnimal
    ? deriveAnimalBlueprintPackagePath(
        normalizedTargetPackagePath,
        animationName,
      )
    : normalizedTargetPackagePath;
  const animationPackagePath =
    `${normalizedTargetPackagePath}/Animation`;
  return {
    animationName,
    animationPrefix: `A_${animationName}_`,
    blueprintName: isAnimal
      ? `BP_${npcName.toUpperCase()}_NPC`
      : `BP_${npcName}`,
    animationBlueprintName: isAnimal
      ? `ABP_${npcName.toUpperCase()}_NPC`
      : `ABP_${npcName}`,
    blueprintPackagePath,
    animationPackagePath,
    animationBlueprintPackagePath: isAnimal
      ? blueprintPackagePath
      : animationPackagePath,
    montagePackagePath: isAnimal
      ? `${blueprintPackagePath}/Animation`
      : animationPackagePath,
  };
}

export function inferStandardAbpTemplate(
  npcName: string,
): NpcMigrationStandardAbpTemplate {
  const normalized = npcName.toLowerCase();
  if (/(?:^|_)(?:cat|animal)(?:\d|_|$)/.test(normalized)) {
    return "animal";
  }
  if (/(?:female|girl|woman|lady)/.test(normalized)) {
    return "female";
  }
  if (/(?:male|boy|man)/.test(normalized)) {
    return "male";
  }
  return "female";
}

export function classifyNpcAnimationFiles(files: readonly string[]): {
  body: string[];
  face: string[];
} {
  const sorted = [...files]
    .filter((file) => /\.fbx$/i.test(file))
    .sort((left, right) =>
      left.localeCompare(right, "en", { sensitivity: "base" }),
    );
  return {
    body: sorted.filter((file) => !/_Face\.fbx$/i.test(file)),
    face: sorted.filter((file) => /_Face\.fbx$/i.test(file)),
  };
}

function fileStem(file: string): string {
  return file.replaceAll("\\", "/").split("/").at(-1)?.replace(/\.fbx$/i, "") ?? "";
}

export function buildNpcMontagePlans(
  npcName: string,
  bodyAnimationFiles: readonly string[],
  template: NpcMigrationStandardAbpTemplate = "female",
): {
  montages: NpcMigrationMontagePlan[];
  duplicateNames: string[];
} {
  const prefix = `A_${npcName}_`.toLowerCase();
  const montages = bodyAnimationFiles.flatMap((sourceFile) => {
    const sourceAssetName = fileStem(sourceFile);
    if (!sourceAssetName.toLowerCase().startsWith(prefix)) {
      return [];
    }
    const actionName = sourceAssetName.slice(prefix.length);
    const montageActionName = actionName.replace(/^AM_Emotion_/i, "");
    const normalized = actionName.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
    let montage: Pick<
      NpcMigrationMontagePlan,
      "kind" | "montageName" | "slotName"
    > | null = null;
    const idle = normalized.match(/^idle(\d*)$/);
    if (template === "animal") {
      return [];
    }
    if (idle) {
      montage = {
        kind: "idle",
        montageName: `AM_Idle${idle[1] || "1"}`,
        slotName: "IdleSlot",
      };
    } else if (/^turn(?:l|left)(?:90)?$/.test(normalized)) {
      montage = {
        kind: "turn_left_90",
        montageName: "AM_TurnLeft90",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:r|right)(?:90)?$/.test(normalized)) {
      montage = {
        kind: "turn_right_90",
        montageName: "AM_TurnRight90",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:l|left)180$/.test(normalized)) {
      montage = {
        kind: "turn_left_180",
        montageName: "AM_TurnLeft180",
        slotName: "TurnSlot",
      };
    } else if (/^turn(?:r|right)180$/.test(normalized)) {
      montage = {
        kind: "turn_right_180",
        montageName: "AM_TurnRight180",
        slotName: "TurnSlot",
      };
    } else if (normalized === "walk") {
      montage = {
        kind: "action",
        montageName: "AM_Walk",
        slotName: "TurnSlot",
      };
    } else if (
      !/^(?:look[dfu]|backlean|frontlean|idlestand\d*)$/.test(
        normalized,
      )
    ) {
      montage = {
        kind: "action",
        montageName: `AM_${montageActionName}`,
        slotName: "IdleSlot",
      };
    }
    return montage
      ? [{ ...montage, sourceFile, sourceAssetName }]
      : [];
  });
  const counts = new Map<string, number>();
  for (const montage of montages) {
    counts.set(
      montage.montageName,
      (counts.get(montage.montageName) ?? 0) + 1,
    );
  }
  return {
    montages,
    duplicateNames: Array.from(counts)
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  };
}

export function buildNpcAnimationRoleAssets(
  npcName: string,
  bodyAnimationFiles: readonly string[],
  template: NpcMigrationStandardAbpTemplate = "female",
): {
  assets: NpcMigrationAnimationRoleAssets;
  missingRoles: Array<keyof NpcMigrationAnimationRoleAssets>;
  duplicateRoles: Array<keyof NpcMigrationAnimationRoleAssets>;
} {
  const prefix = `A_${npcName}_`.toLowerCase();
  const matches: Record<
    keyof NpcMigrationAnimationRoleAssets,
    string[]
  > = {
    lookDown: [],
    lookForward: [],
    lookUp: [],
    idleStand: [],
    impact: [],
    interact: [],
    walk: [],
  };
  for (const sourceFile of bodyAnimationFiles) {
    const sourceAssetName = fileStem(sourceFile);
    if (!sourceAssetName.toLowerCase().startsWith(prefix)) {
      continue;
    }
    const action = sourceAssetName
      .slice(prefix.length)
      .replaceAll(/[^a-z0-9]/gi, "")
      .toLowerCase();
    const role =
      action === "lookd"
        ? "lookDown"
        : action === "lookf"
          ? "lookForward"
          : action === "looku"
            ? "lookUp"
            : action === "idlestand"
              ? "idleStand"
              : action === "impact"
                ? "impact"
                : action === "interact"
                  ? "interact"
              : action === "walk"
                ? "walk"
                  : null;
    if (role) {
      matches[role].push(sourceAssetName);
    }
  }
  const assets = Object.fromEntries(
    Object.entries(matches).map(([role, values]) => [
      role,
      values.length === 1 ? values[0] : "",
    ]),
  ) as unknown as NpcMigrationAnimationRoleAssets;
  const requiredRoles =
    template === "animal"
      ? ANIMAL_TEMPLATE_ROLES
      : HUMANOID_TEMPLATE_ROLES;
  return {
    assets,
    missingRoles: requiredRoles.filter(
      (role) => matches[role].length === 0,
    ),
    duplicateRoles: requiredRoles.filter(
      (role) => matches[role].length > 1,
    ),
  };
}

function automaticStep(
  id: NpcMigrationStep["id"],
  label: string,
  detail: string,
  blocked: boolean,
): NpcMigrationStep {
  return {
    id,
    label,
    mode: "automatic",
    state: blocked ? "blocked" : "ready",
    detail,
  };
}

export function buildNpcMigrationPlan(
  request: NpcMigrationPlanRequest,
  discovered: {
    animationFiles: string[];
    fileOperations: NpcMigrationFileOperation[];
    targetDirectoryReady: boolean;
    animationDirectoryReady: boolean;
  },
): Omit<NpcMigrationPlan, "reviewToken"> {
  const npcName = (request.npcName || deriveNpcName(
    request.source.skeletalMeshName,
  )).trim();
  const targetContentDirectory = normalizeSlashes(
    request.targetContentDirectory,
  );
  const animationSourceDirectory = normalizeSlashes(
    request.animationSourceDirectory,
  );
  const targetPackagePath = normalizeNpcPackagePath(
    request.targetPackagePath ||
      request.source.suggestedTargetPackagePath,
  );
  const configureStandardAbp = request.configureStandardAbp ?? false;
  const standardAbpTemplate =
    request.standardAbpTemplate ?? inferStandardAbpTemplate(npcName);
  const {
    animationName,
    animationPrefix,
    blueprintName,
    animationBlueprintName,
    blueprintPackagePath,
    animationPackagePath,
    animationBlueprintPackagePath,
    montagePackagePath,
  } = deriveNpcMigrationIdentity(
    npcName,
    targetPackagePath,
    standardAbpTemplate,
  );
  const isAnimal = standardAbpTemplate === "animal";
  const classifiedAnimations = classifyNpcAnimationFiles(
    discovered.animationFiles,
  );
  const body = isAnimal ? [] : classifiedAnimations.body;
  const face = classifiedAnimations.face;
  const { montages, duplicateNames } = buildNpcMontagePlans(
    animationName,
    body,
    standardAbpTemplate,
  );
  const animationRoles = buildNpcAnimationRoleAssets(
    animationName,
    body,
    standardAbpTemplate,
  );
  const {
    assets: animationRoleAssets,
  } = animationRoles;
  const missingRoles = isAnimal ? [] : animationRoles.missingRoles;
  const duplicateRoles = isAnimal ? [] : animationRoles.duplicateRoles;
  const lookBlendSpaceName = isAnimal
    ? ""
    : `BS_${npcName}_Look`;
  const blockedReasons: string[] = [];
  const warnings = [...request.source.warnings];

  if (!ASSET_NAME_PATTERN.test(npcName)) {
    blockedReasons.push("NPC 名称只能包含英文字母、数字和下划线");
  }
  if (!PACKAGE_PATH_PATTERN.test(targetPackagePath)) {
    blockedReasons.push("目标 UE 路径必须是 /Game 开头的有效资产目录");
  }
  if (!PACKAGE_PATH_PATTERN.test(blueprintPackagePath)) {
    blockedReasons.push("BP/ABP 目录必须是 /Game 开头的有效资产目录");
  }
  if (!ASSET_NAME_PATTERN.test(blueprintName)) {
    blockedReasons.push("BP 名称只能包含英文字母、数字和下划线");
  }
  if (!ASSET_NAME_PATTERN.test(animationBlueprintName)) {
    blockedReasons.push("ABP 名称只能包含英文字母、数字和下划线");
  }
  if (duplicateNames.length > 0) {
    blockedReasons.push(
      `多个动作会生成同名 Montage：${duplicateNames.join("、")}`,
    );
  }
  if (configureStandardAbp && missingRoles.length > 0) {
    blockedReasons.push(
      `标准 ABP 缺少动作：${missingRoles.join("、")}`,
    );
  }
  if (configureStandardAbp && duplicateRoles.length > 0) {
    blockedReasons.push(
      `标准 ABP 动作不唯一：${duplicateRoles.join("、")}`,
    );
  }
  if (isAnimal && face.length > 0) {
    blockedReasons.push("动物模板不支持 Face FBX，请移除后重新生成计划");
  }
  if (!discovered.targetDirectoryReady) {
    blockedReasons.push("目标目录必须是现有 Unreal 项目的 Content 目录");
  }
  if (
    targetContentDirectory.toLowerCase() ===
    normalizeSlashes(request.source.sourceContentDirectory).toLowerCase()
  ) {
    blockedReasons.push("源工程与目标工程不能使用同一个 Content 目录");
  }
  if (request.source.dirtyPackageNames.length > 0) {
    blockedReasons.push(
      `源 UE 有 ${request.source.dirtyPackageNames.length} 个待迁移资产尚未保存`,
    );
  }
  if (discovered.fileOperations.length === 0) {
    blockedReasons.push("没有找到可复制的源资产文件");
  }
  const conflicts = discovered.fileOperations.filter(
    (operation) => operation.state === "conflict",
  );
  if (conflicts.length > 0) {
    blockedReasons.push(
      `目标 Content 中已有 ${conflicts.length} 个同路径文件，当前版本不会覆盖`,
    );
  }
  if (!isAnimal && !discovered.animationDirectoryReady) {
    blockedReasons.push("动作源目录不存在或无法读取");
  } else if (!isAnimal && body.length === 0) {
    blockedReasons.push("动作源目录中没有可导入的 Body FBX");
  }
  if (face.length > 0) {
    warnings.push(
      `检测到 ${face.length} 个 Face FBX；将导入并锁定根骨骼，表情曲线仍需通过 BP_FaceConfigHelper 生成`,
    );
  }
  if (montages.length === 0) {
    warnings.push(
      isAnimal
        ? "动物模板保留 BP_E05_CAT01_NPC 引用的 AM_Sleep，不自动创建人形 Montage"
        : "目录中只有状态机或混合空间素材，不会自动创建 Montage",
    );
  }
  warnings.push(
    isAnimal
      ? "将套用 BP_E05_CAT01_NPC 的胶囊体参数 R40 / H40、Mesh Z -35"
      : "胶囊体将按 Mesh 包围盒估算，完成后仍需在蓝图视口确认",
  );
  warnings.push(
    configureStandardAbp
      ? isAnimal
        ? "将复制 BP_E05_CAT01_NPC / ABP_E05_CAT01_NPC，并复用模板动作集"
        : `将使用${
            standardAbpTemplate === "male" ? "男性" : "女性"
          }标准模板配置状态机、Look 和 SpecialAction`
      : "未启用标准 ABP 模板，状态机、Look 和 SpecialAction 需要人工配置",
  );
  if (isAnimal) {
    warnings.push(
      `动物动作前缀为 ${animationPrefix}，AnimSequence 写入 ${animationPackagePath}`,
    );
    warnings.push(
      `BP/ABP 写入 ${blueprintPackagePath}，Montage 写入 ${montagePackagePath}`,
    );
    warnings.push(
      "首版动物模板仅支持与 SKEL_E05_Cat 相同的 Skeleton；策划 UE 预检会严格阻断其他骨架",
    );
  }

  const migrationBlocked =
    !discovered.targetDirectoryReady ||
    request.source.dirtyPackageNames.length > 0 ||
    discovered.fileOperations.length === 0 ||
    conflicts.length > 0 ||
    targetContentDirectory.toLowerCase() ===
      normalizeSlashes(request.source.sourceContentDirectory).toLowerCase();
  const configurationBlocked =
    blockedReasons.some((reason) =>
      [
        "NPC 名称",
        "目标 UE 路径",
        "BP 名称",
        "ABP 名称",
        "BP/ABP 目录",
        "动作源目录",
        "多个动作会生成同名 Montage",
        "标准 ABP 缺少动作",
        "标准 ABP 动作不唯一",
        "动物模板不支持 Face FBX",
      ].some((prefix) => reason.startsWith(prefix)),
    );

  const steps: NpcMigrationStep[] = [
    automaticStep(
      "source",
      "采集 Skeletal Mesh 与依赖",
      `${request.source.dependencyPackageNames.length} 个包，${request.source.sourceFiles.length} 个物理文件`,
      request.source.sourceFiles.length === 0,
    ),
    automaticStep(
      "migration",
      "迁移模型基础资产",
      `复制到 ${targetContentDirectory || "未指定目标 Content"}`,
      migrationBlocked,
    ),
    automaticStep(
      "animations",
      "导入 Body / Face 动作",
      isAnimal
        ? `复用 ${animationPrefix} 模板动作集`
        : `${body.length} 个 Body FBX，${face.length} 个 Face FBX`,
      !isAnimal &&
        (!discovered.animationDirectoryReady || body.length === 0),
    ),
    automaticStep(
      "blueprint",
      "创建并配置 NPC BP",
      `${blueprintPackagePath}/${blueprintName} · Mesh ${request.source.skeletalMeshName}`,
      !ASSET_NAME_PATTERN.test(blueprintName),
    ),
    automaticStep(
      "animation_blueprint",
      "创建并绑定动画蓝图",
      configureStandardAbp
        ? `${animationBlueprintName} · ${
            standardAbpTemplate === "animal"
              ? "ABP_E05_CAT01_NPC"
              : standardAbpTemplate === "male"
                ? "ABP_N16_Villager_Male_A"
                : "ABP_N18_Villager_Female_A"
          }`
        : `${animationBlueprintName} · ${request.source.skeletonAssetPath}`,
      !ASSET_NAME_PATTERN.test(animationBlueprintName) ||
        (configureStandardAbp &&
          (missingRoles.length > 0 || duplicateRoles.length > 0)),
    ),
    automaticStep(
      "look_blend_space",
      "创建 Look 混合空间",
      isAnimal
        ? "动物模板复用专用状态机，不创建人形 Look 混合空间"
        : `${lookBlendSpaceName} · LookD / LookF / LookU`,
      !isAnimal && configureStandardAbp &&
        (missingRoles.some((role) =>
          ["lookDown", "lookForward", "lookUp"].includes(role),
        ) ||
          duplicateRoles.some((role) =>
            ["lookDown", "lookForward", "lookUp"].includes(role),
          )),
    ),
    automaticStep(
      "montages",
      "创建动作 Montage",
      isAnimal
        ? `复用 ${montagePackagePath}/AM_Sleep`
        : `${montages.length} 个 Montage，按语义写入 IdleSlot / TurnSlot`,
      duplicateNames.length > 0,
    ),
    {
      id: "face",
      label: "生成脸部曲线与蒙太奇",
      mode: face.length > 0 ? "assisted" : "manual",
      state: "ready",
      detail:
        face.length > 0
          ? "自动导入并锁根；BP_FaceConfigHelper 的 MakeTable / Out 保留人工确认"
          : "未检测到 Face FBX，按无拆分脸部流程跳过",
    },
    {
      id: "visual_review",
      label: "校准胶囊体与 Mesh",
      mode: "assisted",
      state: "ready",
      detail: isAnimal
        ? "套用猫模板 R40 / H40、Mesh Z -35；在 BP 视口确认结果"
        : "自动按包围盒写入尺寸和 Mesh 高度；在 BP 视口确认结果",
    },
    {
      id: "finalize",
      label: "编译、保存与最终确认",
      mode: "assisted",
      state: "ready",
      detail: "自动编译保存并回读；人工确认 ABP 状态机和后处理动画蓝图",
    },
  ];

  return {
    source: request.source,
    npcName,
    animationName,
    animationPrefix,
    targetContentDirectory,
    targetPackagePath,
    blueprintPackagePath,
    animationSourceDirectory,
    animationPackagePath,
    animationBlueprintPackagePath,
    montagePackagePath,
    blueprintName,
    animationBlueprintName,
    bodyAnimationFiles: body,
    faceAnimationFiles: face,
    montages,
    configureStandardAbp,
    standardAbpTemplate,
    lookBlendSpaceName,
    animationRoleAssets,
    fileOperations: discovered.fileOperations,
    steps,
    canMigrate: !migrationBlocked,
    canConfigure: !configurationBlocked,
    blockedReasons,
    warnings: Array.from(new Set(warnings)),
  };
}
