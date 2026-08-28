import { describe, expect, it } from "vitest";
import {
  EXCEL_REGISTRATION_SCRIPT,
  EXCEL_TARGET_UPDATE_SCRIPT,
  parseNpcRegistrationWriteRequest,
  powerShellFileArguments,
  readablePowerShellError,
  validateNpcRegistrationWriteResult,
} from "./excelRegistration";

const TEST_REGISTRATION_PATHS = {
  missionTarget: "F:\\Project\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
  npc: "F:\\Project\\doc\\xlsdir\\NPC表.xlsm",
  model: "F:\\Project\\doc\\xlsdir\\m模型资源表.xlsm",
};

describe("Excel PowerShell errors", () => {
  it("turns Excel busy CLIXML into an actionable message", () => {
    const clixml =
      '#< CLIXML <Objs><S S="Error">异常来自 HRESULT:0x800AC472_x000D__x000A_</S></Objs>';

    expect(readablePowerShellError(clixml)).toBe(
      "Excel 当前正忙或处于单元格编辑状态。请在 Excel 中按 Enter 或 Esc 退出编辑，关闭弹窗后重试",
    );
  });

  it("extracts and decodes ordinary CLIXML error text", () => {
    const clixml =
      '#< CLIXML <Objs><S S="Error">目标物 500001 不存在_x000D__x000A_请刷新</S></Objs>';

    expect(readablePowerShellError(clixml)).toBe(
      "目标物 500001 不存在\r\n请刷新",
    );
  });

  it("runs scripts from a file instead of the Windows command line", () => {
    const scriptPath =
      "C:\\Users\\Admin\\AppData\\Local\\Temp\\shot-sandbox-excel-1\\operation.ps1";
    const arguments_ = powerShellFileArguments(scriptPath);

    expect(arguments_).toContain("-File");
    expect(arguments_).toContain(scriptPath);
    expect(arguments_).not.toContain("-EncodedCommand");
    expect(arguments_.join(" ").length).toBeLessThan(1_000);
  });

  it("accepts NPC-only writes without a MapID when the model exists", () => {
    const request = parseNpcRegistrationWriteRequest({
      scope: "npc_only",
      paths: TEST_REGISTRATION_PATHS,
      items: [
        {
          actorRef: "BP_Guard_C_1",
          label: "守卫新增",
          classPath: "/Game/Test/BP_Guard.BP_Guard_C",
          transform: {
            location: { x: 1, y: 2, z: 3 },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          mapId: "",
          existingModelId: 200135,
          existingNpcId: null,
          existingTargetId: null,
          canTurn: true,
          newNpc: {
            name: "",
            title: "",
            canTurn: true,
          },
        },
      ],
    });

    expect(request.scope).toBe("npc_only");
    expect(request.items[0].mapId).toBe("");
    expect(request.items[0].newNpc?.name).toBe("");
  });

  it("rejects NPC-only writes without an existing model", () => {
    expect(() =>
      parseNpcRegistrationWriteRequest({
        scope: "npc_only",
        paths: TEST_REGISTRATION_PATHS,
        items: [
          {
            actorRef: "BP_Guard_C_1",
            label: "守卫新增",
            classPath: "/Game/Test/BP_Guard.BP_Guard_C",
            transform: {
              location: { x: 1, y: 2, z: 3 },
              rotation: { pitch: 0, yaw: 90, roll: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
            mapId: "",
            existingModelId: null,
            existingNpcId: null,
            existingTargetId: null,
            canTurn: true,
            newNpc: {
              name: "新增守卫",
              title: "",
              canTurn: true,
            },
          },
        ],
      }),
    ).toThrow("仅注册 NPC 时必须复用现有模型");
  });

  it("marks newly inserted registration cells red", () => {
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "$cell.Value2 = [double]$value",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "$sheet.Cells.Item($row, $column).Font.Color = 255",
    );
    expect(
      EXCEL_REGISTRATION_SCRIPT.match(/Set-NewCell \$npcSheet/g)?.length,
    ).toBeGreaterThan(10);
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      'if ($scope -eq "all")',
    );
  });

  it("retries busy COM calls and bulk-reads source tables", () => {
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "for ($attempt = 1; $attempt -le 20; $attempt++)",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "批量读取目标物表",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).not.toContain(
      "Start-Process -FilePath $path",
    );
    expect(EXCEL_TARGET_UPDATE_SCRIPT).toContain(
      "Get-RangeValues $targetSheet",
    );
    expect(EXCEL_TARGET_UPDATE_SCRIPT).toContain(
      "$excel.Workbooks.Open($targetPath, 0, $false)",
    );
  });

  it("opens full-registration workbooks only when that table needs additions", () => {
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "if ($null -eq $item.existingModelId)",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "[void]$requiredPaths.Add($paths.model)",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "if ($null -eq $item.existingNpcId)",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "[void]$requiredPaths.Add($paths.npc)",
    );
  });

  it("does not treat a missing transform lookup as a reusable target", () => {
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      "if ($targetIdsByTransform.ContainsKey($targetKey))",
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      'Normalize-TransformText $position @("X", "Y", "Z")',
    );
    expect(EXCEL_REGISTRATION_SCRIPT).toContain(
      'Normalize-TransformText $rotation @("Pitch", "Yaw", "Roll")',
    );
    expect(EXCEL_REGISTRATION_SCRIPT).not.toContain(
      '$existingTargets.Count -eq 1 -and $existingTargets[0] -ne ""',
    );
  });

  it("accepts target-only writes with existing model and NPC IDs", () => {
    const request = parseNpcRegistrationWriteRequest({
      scope: "target_only",
      paths: {
        missionTarget: "D:\\Project\\doc\\xlsdir\\r任务剧情\\m目标物表.xlsm",
        npc: "D:\\Project\\doc\\xlsdir\\NPC表.xlsm",
        model: "D:\\Project\\doc\\xlsdir\\m模型资源表.xlsm",
      },
      items: [
        {
          actorRef: "BP_Guard_C_1",
          label: "守卫新增",
          classPath: "/Game/Test/BP_Guard.BP_Guard_C",
          transform: {
            location: { x: 1, y: 2, z: 3 },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          mapId: "1204",
          existingModelId: 200135,
          existingNpcId: 101999,
          existingTargetId: null,
          canTurn: true,
          newNpc: null,
        },
      ],
    });

    expect(request.scope).toBe("target_only");
    expect(request.items[0].existingNpcId).toBe(101999);
    expect(request.paths.npc).toBe(
      "D:\\Project\\doc\\xlsdir\\NPC表.xlsm",
    );
  });

  it("rejects a successful response that did not confirm every target", () => {
    const item = parseNpcRegistrationWriteRequest({
      scope: "target_only",
      paths: TEST_REGISTRATION_PATHS,
      items: [
        {
          actorRef: "BP_Guard_C_1",
          label: "守卫新增",
          classPath: "/Game/Test/BP_Guard.BP_Guard_C",
          transform: {
            location: { x: 1, y: 2, z: 3 },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          mapId: "1204",
          existingModelId: 200135,
          existingNpcId: 101999,
          existingTargetId: null,
          canTurn: true,
          newNpc: null,
        },
      ],
    }).items[0];

    expect(() =>
      validateNpcRegistrationWriteResult([item], "target_only", {
        createdModels: [],
        createdNpcs: [],
        createdTargets: [],
        reusedTargets: [],
        openedWorkbooks: [TEST_REGISTRATION_PATHS.missionTarget],
      }),
    ).toThrow("Excel 未返回有效目标物 ID：守卫新增");

    expect(() =>
      validateNpcRegistrationWriteResult([item], "target_only", {
        createdModels: [],
        createdNpcs: [],
        createdTargets: [],
        reusedTargets: [{ actorRef: item.actorRef, id: "" }],
        openedWorkbooks: [TEST_REGISTRATION_PATHS.missionTarget],
      }),
    ).toThrow("Excel 未返回有效目标物 ID：守卫新增");

    expect(() =>
      validateNpcRegistrationWriteResult([item], "target_only", {
        createdModels: [],
        createdNpcs: [],
        createdTargets: [{ actorRef: item.actorRef, id: 500001 }],
        reusedTargets: [],
        openedWorkbooks: [TEST_REGISTRATION_PATHS.missionTarget],
      }),
    ).not.toThrow();
  });

  it("rejects an NPC-only response without a valid NPC ID", () => {
    const item = parseNpcRegistrationWriteRequest({
      scope: "npc_only",
      paths: TEST_REGISTRATION_PATHS,
      items: [
        {
          actorRef: "BP_Guard_C_1",
          label: "守卫新增",
          classPath: "/Game/Test/BP_Guard.BP_Guard_C",
          transform: {
            location: { x: 1, y: 2, z: 3 },
            rotation: { pitch: 0, yaw: 90, roll: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          mapId: "",
          existingModelId: 200135,
          existingNpcId: null,
          existingTargetId: null,
          canTurn: true,
          newNpc: { name: "新增守卫", title: "", canTurn: true },
        },
      ],
    }).items[0];

    expect(() =>
      validateNpcRegistrationWriteResult([item], "npc_only", {
        createdModels: [],
        createdNpcs: [],
        createdTargets: [],
        reusedTargets: [],
        openedWorkbooks: [TEST_REGISTRATION_PATHS.npc],
      }),
    ).toThrow("Excel 未返回有效 NPC ID：守卫新增");
    expect(() =>
      validateNpcRegistrationWriteResult([item], "npc_only", {
        createdModels: [],
        createdNpcs: [{ actorRef: item.actorRef, id: 101999 }],
        createdTargets: [],
        reusedTargets: [],
        openedWorkbooks: [TEST_REGISTRATION_PATHS.npc],
      }),
    ).not.toThrow();
  });
});
