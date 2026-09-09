import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MusicRecommendations } from "./MusicRecommendations";

const recommendation = {
  dialogueId: "204801",
  stateId: 15,
  stateName: "Hidden_Crisis",
  musicName: "危机四伏",
  reason: "开场出现明确悬疑。",
  fileToken: null,
  fileName: null,
  recordId: "music-15",
  audioSummary: null,
  source: "rule-advisor" as const,
};

describe("MusicRecommendations", () => {
  it("does not carry a recommendation into a node without a cue", () => {
    const html = renderToStaticMarkup(
      <MusicRecommendations
        recommendations={[recommendation]}
        currentDialogueIds={["204802"]}
        playbackActive={false}
        onPlaybackStart={() => undefined}
        onPlaybackStop={() => undefined}
      />,
    );

    expect(html).toBe("");
  });

  it("hides a recommendation that matches the current UE music", () => {
    const html = renderToStaticMarkup(
      <MusicRecommendations
        recommendations={[recommendation]}
        currentDialogueIds={["204801"]}
        existingConfiguration={{
          dialogueId: "204801",
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
          backgroundMusicStateId: 15,
          backgroundMusicDelaySeconds: 0,
        }}
        playbackActive={false}
        onPlaybackStart={() => undefined}
        onPlaybackStop={() => undefined}
      />,
    );

    expect(html).toBe("");
  });
});
