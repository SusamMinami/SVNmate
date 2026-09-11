import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { scanAnimationSequence, reviewAnimationSequence, applyAnimationSequence } from "../server/animationVoice";
import { UnrealMcpConnection } from "../server/ue/transport";

if (!process.argv.includes("--write-probe")) {
  throw new Error("This smoke test creates and deletes an isolated UE asset. Pass --write-probe to run.");
}
const folder = `/Game/__AnimationVoiceProbe_${randomUUID().replaceAll("-", "")}`;
const assetPath = `${folder}/LS_Probe.LS_Probe`;
const connection = new UnrealMcpConnection();
async function python(code: string) {
  return connection.invoke("script.eval_python_expression", {
    Expression: `(lambda ns: (exec(${JSON.stringify(code)},ns),str(ns.get('_result','ok')),ns.clear())[1])({'unreal':unreal})`,
  }, { timeoutMs: 120_000 });
}
try {
  await connection.connect();
  await python(`
s = unreal.AssetToolsHelpers.get_asset_tools().create_asset('LS_Probe', ${JSON.stringify(folder)}, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
s.set_playback_start(0)
s.set_playback_end(300)
unreal.EditorAssetLibrary.save_loaded_asset(s, only_if_is_dirty=False)
`);
  const before = await scanAnimationSequence({ assetPath });
  assert.equal(before.dirty, false);
  assert.equal(before.tracks.length, 0);
  assert.ok(before.skipBlockedReasons.some((reason) => reason.includes("Director")));
  const review = await reviewAnimationSequence({
    assetPath, revision: before.revision, subtitles: [{ dialogueId: 9032023, start: 1.1, end: 2.4 }],
    skipTime: 8, eventTimes: null,
  });
  const afterReview = await scanAnimationSequence({ assetPath });
  assert.equal(afterReview.revision, before.revision);
  const result = await applyAnimationSequence({ token: review.token });
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.dirty, true);
  assert.equal(result.snapshot.tracks[0].sections[0].dialogueId, 9032023);
  assert.equal(result.snapshot.marks[0].label, "skip");
  await assert.rejects(applyAnimationSequence({ token: review.token }));
  await python(`unreal.EditorAssetLibrary.save_asset(${JSON.stringify(assetPath)}, only_if_is_dirty=False)`);
  const saved = await scanAnimationSequence({ assetPath });
  const script = await readFile("server/ue/scripts/animation_voice.py", "utf8");
  const badRequest = {
    action: "apply", assetPath, stateRevision: saved.stateRevision, eventTargets: [],
    patch: { subtitles: [{ sectionPath: saved.tracks[0].sections[0].path, dialogueId: 99, start: 3, end: 4 }],
      skipTime: "invalid-test-value", eventTimes: null },
  };
  const injected = `_request = __import__('json').loads(${JSON.stringify(JSON.stringify(badRequest))})\n${script}`;
  const caught = await python(`try:\n    exec(${JSON.stringify(injected)})\n    _result = 'unexpected-success'\nexcept Exception as error:\n    _result = str(error)`) as { Result?: string };
  assert.match(caught.Result ?? "", /APPLY_FAILED \(restored/);
  const restored = await scanAnimationSequence({ assetPath });
  assert.deepEqual(restored.tracks, saved.tracks);
  assert.deepEqual(restored.marks, saved.marks);
  console.log("Forced mid-write failure restored original section range, ID and marks.");
  console.log(JSON.stringify({ assetPath, review: review.changes, result }, null, 2));
} finally {
  try {
    console.log(await python(`
__import__('gc').collect()
unreal.SystemLibrary.collect_garbage()
_result = unreal.EditorAssetLibrary.delete_directory(${JSON.stringify(folder)})
`));
    const exists = await connection.invoke("script.eval_python_expression", {
      Expression: `unreal.EditorAssetLibrary.does_asset_exist(${JSON.stringify(assetPath)})`,
    }) as { Result?: string };
    assert.equal(exists.Result, "False", `Probe cleanup failed: ${assetPath}`);
    console.log("Probe cleanup verified; smoke test passed.");
  } finally { connection.close(); }
}
