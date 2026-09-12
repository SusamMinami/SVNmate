import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { configureConfigDocDirectory } from "../server/configRepository";
import { scanAnimationSequence } from "../server/animationVoice";
import { listAnimationSpeechMedia, prepareAnimationSpeechAudio } from "../server/animationSpeechMedia";
import { animationSpeechStatus, startAnimationSpeech, getAnimationSpeechJob, cancelAnimationSpeech } from "../server/animationSpeechRuntime";

const assetPath = process.argv[2];
if (!assetPath) throw new Error("Pass a LevelSequence object path. This test only reads UE and performs local inference.");
configureConfigDocDirectory(process.env.STORYBOARD_CONFIG_DOC_DIR || "C:/trunk/doc");
assert.equal((await animationSpeechStatus()).ready, true);
const snapshot = await scanAnimationSequence({ assetPath });
const sections = snapshot.tracks.flatMap((t) => t.sections).filter((s) => s.audioEvent?.startsWith("A_Voice_"));
assert.equal(sections.length, 1, "Select a sequence with exactly one voice section for this smoke test");
const section = sections[0];
const context = { assetPath, revision: snapshot.revision, sectionPath: section.path };
const media = await listAnimationSpeechMedia(context);
assert.equal(media.length, 1);
const audio = await prepareAnimationSpeechAudio({ ...context, mediaId: media[0].id });
const results = [];
for (const mode of ["align", "asr"] as const) {
  const job = await startAnimationSpeech({
    audioToken: audio.token, mode, cropStart: 0,
    cropEnd: Math.min(audio.duration, snapshot.end - audio.sectionStart, 300),
    timelineOrigin: audio.sectionStart,
    lines: mode === "align" ? snapshot.voices.map((v) => ({ key: String(v.id), dialogueId: v.id, text: v.text })) : [],
  });
  let state = job;
  let lastStage = "";
  while (state.state === "running") {
    if (state.stage !== lastStage) { console.log(mode, state.stage); lastStage = state.stage; }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = await getAnimationSpeechJob({ id: job.id });
  }
  console.log(JSON.stringify(state, null, 2));
  results.push(state);
  await writeFile(".impeccable/speech-smoke-results.json", JSON.stringify({ audio, results }, null, 2));
  assert.equal(state.state, "complete", state.error);
  assert.ok(state.result!.lines.length > 0);
}
assert.equal((await animationSpeechStatus()).busy, false);
console.log("Both speech modes completed; worker exited and GPU resources released.");
const cancelled = await startAnimationSpeech({
  audioToken: audio.token, mode: "asr", cropStart: 0, cropEnd: Math.min(10, audio.duration),
  timelineOrigin: audio.sectionStart, lines: [],
});
await new Promise((resolve) => setTimeout(resolve, 1500));
assert.equal((await cancelAnimationSpeech({ id: cancelled.id })).state, "cancelled");
const deadline = Date.now() + 15000;
while ((await animationSpeechStatus()).busy && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
assert.equal((await animationSpeechStatus()).busy, false, "Cancelled process did not exit");
console.log("Native worker cancellation and lease release verified.");
