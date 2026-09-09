import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExistingDialogueNodeConfiguration } from "../types";
import { ExistingAudioConfiguration } from "./ExistingAudioConfiguration";

const configuration: ExistingDialogueNodeConfiguration = {
  dialogueId: "735201",
  cameraPosition: "",
  moveCameraCount: 0,
  cameraMoveTypes: [],
  fov: null,
  blendCameraType: "",
  blendCurve: "",
  blendDuration: 0,
  schoolCameraKeys: [],
  schoolCameraCount: 0,
  soundEffectAssetPath: "",
  soundEffectAssetName: "",
  soundEffectDelaySeconds: 0,
  backgroundMusicStateId: 18,
  backgroundMusicDelaySeconds: 2.5,
};

const musicCatalog = {
  entries: [
    {
      recordId: "music-18",
      name: "真诚",
      stateName: "Sincere",
      stateId: 18,
      tags: ["日常轻松"],
      notes: "温馨圆满",
      fileToken: null,
      fileName: null,
    },
  ],
  revision: 1,
  syncedAt: null,
  unmappedCount: 0,
  missingAttachmentCount: 0,
  analyzedCount: 0,
};

describe("ExistingAudioConfiguration", () => {
  it("shows the configured UE music name, state and delay", () => {
    const html = renderToStaticMarkup(
      <ExistingAudioConfiguration
        configuration={configuration}
        musicCatalog={musicCatalog}
      />,
    );

    expect(html).toContain("UE 当前音频");
    expect(html).toContain("真诚");
    expect(html).toContain("Sincere");
    expect(html).toContain("2.5s");
  });

  it("stays absent when the node has no configured audio", () => {
    expect(
      renderToStaticMarkup(
        <ExistingAudioConfiguration
          configuration={{
            ...configuration,
            backgroundMusicStateId: null,
          }}
          musicCatalog={musicCatalog}
        />,
      ),
    ).toBe("");
  });
});
