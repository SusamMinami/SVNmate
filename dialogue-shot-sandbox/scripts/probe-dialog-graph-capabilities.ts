import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { UnrealMcpConnection } from "../server/ue/transport";

const args = process.argv.slice(2);
const allowed = new Set(["--engine-root", "--project-root", "--out"]);
const flags = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!allowed.has(flag) || !value || value.startsWith("--") || flags.has(flag)) {
    throw new Error("Usage: tsx scripts/probe-dialog-graph-capabilities.ts --engine-root <UE root> --project-root <project root> [--out <new JSON file>]");
  }
  flags.set(flag, value);
}
for (const flag of ["--engine-root", "--project-root"]) {
  if (!flags.has(flag)) throw new Error(`Missing ${flag}`);
}
const engineRoot = path.resolve(flags.get("--engine-root")!);
const projectRoot = path.resolve(flags.get("--project-root")!);
const outputPath = flags.has("--out") ? path.resolve(flags.get("--out")!) : null;
if (outputPath && existsSync(outputPath)) {
  throw new Error("Refusing to overwrite an existing report.");
}

async function fingerprint(file: string) {
  try {
    const bytes = await readFile(file);
    return { path: file, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: file, missing: true };
    }
    throw error;
  }
}

const requiredPaths = [
  "Engine/Source/Runtime/Core/Public/CoreMinimal.h",
  "Engine/Source/Editor/UnrealEd/Public/EdGraphUtilities.h",
  "Engine/Build/BatchFiles/Build.bat",
  "Engine/Binaries/DotNET/UnrealBuildTool.exe",
  "Engine/Intermediate/Build/Win64/UE4Editor/Development/UnrealEd/UE4Editor-UnrealEd.lib",
];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  mode: "read-only-metadata",
  engineRoot,
  projectRoot,
  prerequisites: requiredPaths.map((relativePath) => ({
    relativePath,
    exists: existsSync(path.join(engineRoot, relativePath)),
  })),
  editorBuild: JSON.parse(await readFile(path.join(engineRoot, "Engine/Build/Build.version"), "utf8")),
  files: [],
  safety: {
    createsObjects: false,
    loadsAssets: false,
    changesSelection: false,
    savesAssets: false,
    writesEngineFiles: false,
    retriesRequests: false,
  },
};
for (const relativePath of [
  "Plugins/SeriaDialogEditor/SeriaDialogEditor.uplugin",
  "Plugins/SeriaDialogEditor/Binaries/Win64/UE4Editor-SeriaDialogEditor.dll",
  "Plugins/SeriaDialogEditor/Binaries/Win64/UE4Editor.modules",
  "Plugins/OmniMcpCore/Binaries/Win64/UE4Editor-OmniMcpCore.dll",
  "Plugins/OmniMcpCore/Binaries/Win64/UE4Editor-OmniMcpCoreEditor.dll",
]) {
  (report.files as unknown[]).push(await fingerprint(path.join(projectRoot, relativePath)));
}

const connection = new UnrealMcpConnection();
async function evaluateMetadata(expression: string): Promise<unknown> {
  // Base64 avoids interpreting Python repr escaping as JSON escaping.
  const value = await connection.invoke("script.eval_python_expression", {
    Expression: `__import__('base64').b64encode(__import__('json').dumps(${expression}).encode('utf-8')).decode('ascii')`,
  }) as { bSuccess?: boolean; Result?: string; Message?: string };
  if (value?.bSuccess !== true || typeof value.Result !== "string") {
    throw new Error(value?.Message || "Invalid Python metadata result");
  }
  const match = /^(['"])([A-Za-z0-9+/]*={0,2})\1$/.exec(value.Result.trim());
  if (!match) throw new Error("Unexpected Python base64 result");
  return JSON.parse(Buffer.from(match[2], "base64").toString("utf8"));
}

const classes = [
  "SeriaDialogEditorSubsystem",
  "SeriaDialogEditorSubsystemPythonHelper",
  "SeriaDialogEditorHelperFunctionLibrary",
  "SeriaDialogGraph",
  "SeriaDialogGraphFactory",
  "SeriaEdDialogGraphNode",
  "BlueprintModificationHelper",
  "BlueprintAnalyseHelper",
];
const signatureNames = [
  "create_node", "create_dialog_node", "get_current_selected_dialog_node_info",
  "apply_current_selected_node_data_property", "add_node_from_action",
  "list_available_nodes", "connect_pins", "import_subgraph", "get_graph_node_info",
];
try {
  await connection.connect();
  const pie = await connection.invoke("editor.is_p_i_e_running", {});
  report.pie = pie;
  if (pie !== false) throw new Error("Editor is running PIE or PIE state is unknown");
  report.runtime = await evaluateMetadata(`{
    'engine_version':unreal.SystemLibrary.get_engine_version(),
    'project_file':unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path()),
    'dirty_content':[p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()],
    'dirty_maps':[p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
  }`);
  const runtime = report.runtime as { project_file: string; dirty_content: string[]; dirty_maps: string[] };
  if (path.dirname(path.resolve(runtime.project_file)).toLowerCase() !== projectRoot.toLowerCase()) {
    throw new Error("Connected UE project does not match --project-root");
  }
  report.pythonClasses = await evaluateMetadata(`{
    n:{
      'available':hasattr(unreal,n),
      'bases':[b.__name__ for b in getattr(unreal,n).__mro__] if hasattr(unreal,n) else [],
      'methods':[m for m in dir(getattr(unreal,n)) if not m.startswith('_') and m not in dir(unreal.Object)] if hasattr(unreal,n) else [],
      'signatures':{m:getattr(getattr(unreal,n),m).__doc__ for m in ${JSON.stringify(signatureNames)} if hasattr(getattr(unreal,n),m)} if hasattr(unreal,n) else {}
    } for n in ${JSON.stringify(classes)}
  }`);
  const functions: Record<string, unknown> = {};
  for (const classPath of [
    "/Script/SeriaDialogEditor.SeriaDialogGraphSchema",
    "/Script/SeriaDialogEditor.SeriaDialogGraph",
    "/Script/SeriaDialogEditor.SeriaEdDialogGraphNode",
    "/Script/SeriaDialogEditor.SeriaDialogEditorSubsystem",
  ]) {
    functions[classPath] = await connection.invoke("reflect.search_functions", {
      ClassNameOrThisPtr: classPath,
      Keyword: "",
      bIncludeSuper: true,
    });
  }
  report.reflectedFunctions = functions;
  const after = await evaluateMetadata(`{
    'dirty_content':[p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages()],
    'dirty_maps':[p.get_path_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
  }`) as { dirty_content: string[]; dirty_maps: string[] };
  report.dirtyAfter = after;
  report.dirtyPackageSetsUnchanged =
    JSON.stringify([...runtime.dirty_content].sort()) === JSON.stringify([...after.dirty_content].sort()) &&
    JSON.stringify([...runtime.dirty_maps].sort()) === JSON.stringify([...after.dirty_maps].sort());
  report.probeStatus = "completed";
  report.writeCapability = "not-tested";
} catch (error) {
  report.probeStatus = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  connection.close();
}
report.finishedAt = new Date().toISOString();
const serialized = JSON.stringify(report, null, 2);
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serialized}\n`, { flag: "wx" });
  console.log(`Report: ${outputPath}`);
}
console.log(serialized);
