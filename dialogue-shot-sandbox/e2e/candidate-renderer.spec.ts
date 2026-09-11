import { expect, test } from "@playwright/test";
import type { RuleCameraCandidateSet } from "../src/director/shotCandidateGenerator";
import type { RuleCandidateVisualSet } from "../src/director/candidateFrameRenderer";
import type { DialogueParticipant, ShotPlan } from "../src/types";

test("reused candidate renderer matches fresh contexts pixel for pixel", async ({ page }, testInfo) => {
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: '{"ok":false}',
  }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const { demoDatabase } = await load("/src/data/demo.ts");
    const { findDialogueSequence } = await load("/src/data/dialogueRepository.ts");
    const { createShotPreview } = await load("/src/director/shotPlanner.ts");
    const { renderRuleCandidateFrames } = await load("/src/director/candidateFrameRenderer.ts");
    const sequence = findDialogueSequence(demoDatabase, "2048");
    const preview = createShotPreview(sequence);
    const participants: DialogueParticipant[] = preview.participants ?? sequence.participants;
    const shots: ShotPlan[] = preview.shots;
    const sets: RuleCameraCandidateSet[] = shots.slice(0, 6).map((shot, index) => ({
      shotIndex: index,
      dialogueIds: shot.dialogueIds,
      candidates: [-15, 0, 15].map((roll, variant) => ({
        candidateId: `${index}-${variant}`,
        shotIndex: index,
        geometryCandidateIndex: variant,
        label: `${variant}`,
        isBaseline: variant === 1,
        legal: true,
        cameraOverride: {
          position: shot.cameraPosition,
          target: shot.cameraTarget,
          composition: shot.compositionPlan,
        },
        shot: { ...shot, cameraRollDegrees: roll },
      })),
    }));
    // Start each batch in a fresh context; the batched run must not retain prior camera state.
    const started = performance.now();
    const batch: RuleCandidateVisualSet = renderRuleCandidateFrames(participants, sets);
    const batchMs = performance.now() - started;
    const referenceStarted = performance.now();
    const fresh = sets.flatMap((set) => set.candidates.flatMap((candidate) =>
      renderRuleCandidateFrames(participants, [{ ...set, candidates: [candidate] }]).candidate_frames,
    ));
    const freshMs = performance.now() - referenceStarted;
    const images = batch.candidate_frames.map((frame) => frame.image_data_url);
    const image = new Image();
    image.src = images[0];
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<number>();
    for (let index = 0; index < pixels.length; index += 64) {
      colors.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
    }
    return {
      count: images.length,
      identical: images.every((image, index) => image === fresh[index].image_data_url),
      colors: colors.size,
      width: canvas.width,
      height: canvas.height,
      batchMs, freshMs,
      image: images[0],
    };
  });
  expect(result.count).toBeGreaterThanOrEqual(3);
  expect(result.identical).toBe(true);
  expect(result.colors).toBeGreaterThan(30);
  expect([result.width, result.height]).toEqual([512, 288]);
  await testInfo.attach("candidate-frame.jpg", {
    body: Buffer.from(result.image.split(",")[1], "base64"),
    contentType: "image/jpeg",
  });
  const { image: _image, ...metrics } = result;
  await testInfo.attach("candidate-render-metrics.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  console.log("candidate renderer", metrics);
  await page.setContent(`<img alt="Rendered candidate" src="${result.image}" width="512" height="288">`);
  await page.screenshot({ path: testInfo.outputPath("candidate-frame.png") });
});
