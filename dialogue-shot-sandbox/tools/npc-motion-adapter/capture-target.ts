import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { UnrealMcpConnection } from "../../server/ue/transport";

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: "string" }, blueprint: { type: "string" },
    "body-component": { type: "string", default: "CharacterMesh0" },
    "face-node": { type: "string" }, "face-template": { type: "string" },
    output: { type: "string" },
  } });
  if (!values.project || !values.blueprint || !values.output)
    throw new Error("--project, --blueprint and --output are required");
  if (!!values["face-node"] !== !!values["face-template"])
    throw new Error("Supply both --face-node and --face-template, or neither");
  const packagePath = values.blueprint.split(".")[0];
  if (values["face-node"] && (!values["face-node"].startsWith(`${packagePath}.`) ||
      !values["face-template"]!.startsWith(`${packagePath}.`)))
    throw new Error("Face node/template must belong to the requested blueprint");
  const connection = new UnrealMcpConnection();
  try {
    await connection.connect();
    let face: unknown = null;
    if (values["face-node"]) {
      const read = (property: string) => connection.invoke("reflect.read_object_property", {
        ThisPtr: values["face-node"], PropertyName: property,
      });
      const parent = await read("ParentComponentOrVariableName");
      const bone = await read("AttachToName");
      const template = await read("ComponentTemplate");
      const templateName = values["face-template"]!.split(":").at(-1)!;
      if (parent !== values["body-component"] || typeof bone !== "string" || bone === "None")
        throw new Error("Face node is not attached to the requested body bone");
      if (typeof template !== "string" ||
          !(template === values["face-template"] || template.endsWith(`_${templateName}`)))
        throw new Error("Face SCS node and template do not match");
      face = { node: values["face-node"], template: values["face-template"],
        attach_bone: bone, parent };
    }
    const request = { project: values.project, blueprint: values.blueprint,
      body_component: values["body-component"], output: values.output, face };
    const source = await readFile(fileURLToPath(new URL("./export_target.py", import.meta.url)), "utf8");
    const result = await connection.invoke("script.eval_python_expression", {
      Expression: `(lambda ns:(exec(${JSON.stringify(source)},ns),__import__('json').dumps(ns['_result']))[1])({'unreal':unreal,'REQUEST':__import__('json').loads(${JSON.stringify(JSON.stringify(request))})})`,
    }, { timeoutMs: 180000 });
    if (result && typeof result === "object" && "bSuccess" in result && !result.bSuccess)
      throw new Error(JSON.stringify(result));
    console.log(JSON.stringify(result, null, 2));
  } finally { connection.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
