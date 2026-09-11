import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDatabase } from "../data/demo";
import { findDialogueSequence } from "../data/dialogueRepository";
import { createShotPreview } from "./shotPlanner";
import { renderRuleCandidateFrames } from "./candidateFrameRenderer";
import type { RuleCameraCandidateSet } from "./shotCandidateGenerator";

const gpu = vi.hoisted(() => ({
  constructed: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
  forceContextLoss: vi.fn(),
  setSize: vi.fn(),
}));

vi.mock("three", async (importOriginal) => ({
  ...await importOriginal<typeof import("three")>(),
  WebGLRenderer: class {
    constructor(options: unknown) { gpu.constructed(options); }
    render = gpu.render;
    dispose = gpu.dispose;
    forceContextLoss = gpu.forceContextLoss;
    setSize = gpu.setSize;
    setPixelRatio = vi.fn();
  },
}));

const sequence = findDialogueSequence(demoDatabase, "2048");
const shot = createShotPreview(sequence).shots[0];
let canvases: Array<{ width: number; height: number; toDataURL: ReturnType<typeof vi.fn> }>;

function candidates(count = 3): RuleCameraCandidateSet[] {
  return [{
    shotIndex: 0,
    dialogueIds: [sequence.rows[0].id],
    candidates: Array.from({ length: count }, (_, index) => ({
      candidateId: `candidate-${index}`,
      shotIndex: index,
      geometryCandidateIndex: index,
      label: `Camera ${index}`,
      isBaseline: index === 0,
      legal: true,
      cameraOverride: {
        position: shot.cameraPosition,
        target: shot.cameraTarget,
        composition: shot.compositionPlan,
      },
      shot: { ...shot, index },
    })),
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  gpu.render.mockReset();
  gpu.setSize.mockReset();
  canvases = [];
  vi.stubGlobal("document", {
    createElement: vi.fn(() => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          strokeRect: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
          measureText: () => ({ width: 40 }),
        }),
        toDataURL: vi.fn(() => `data:image/jpeg;base64,frame-${gpu.render.mock.calls.length}`),
      };
      canvases.push(canvas);
      return canvas;
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("renderRuleCandidateFrames resource ownership", () => {
  it("renders every candidate using one context, scene, camera and output buffer", () => {
    const result = renderRuleCandidateFrames(sequence.participants, candidates(9));
    expect(result?.candidate_frames).toHaveLength(9);
    expect(result?.candidate_frames.map((frame) => frame.candidate_id))
      .toEqual(Array.from({ length: 9 }, (_, index) => `candidate-${index}`));
    expect(new Set(result?.candidate_frames.map((frame) => frame.image_data_url)).size).toBe(9);
    expect(gpu.constructed).toHaveBeenCalledTimes(1);
    expect(gpu.constructed).toHaveBeenCalledWith(expect.objectContaining({
      antialias: true, preserveDrawingBuffer: true,
    }));
    expect(new Set(gpu.render.mock.calls.map(([scene]) => scene)).size).toBe(1);
    expect(new Set(gpu.render.mock.calls.map(([, camera]) => camera)).size).toBe(1);
    expect(gpu.setSize).toHaveBeenCalledWith(512, 288, false);
    expect(canvases).toHaveLength(2);
    expect(canvases[1].toDataURL).toHaveBeenCalledWith("image/jpeg", 0.78);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it("updates attendance and facing and does not accumulate camera roll", () => {
    const participant = { ...sequence.participants[0], entryIndex: 1, exitIndex: 1 };
    const sets = candidates();
    const yaw: number[] = [];
    const visibility: boolean[] = [];
    const rotations: THREE.Quaternion[] = [];
    const target: [number, number, number] = [participant.position[0] + 1, 0, participant.position[2]];
    sets[0].candidates.forEach((candidate, index) => {
      candidate.shot = {
        ...shot,
        dialogueEndIndex: index,
        cameraRollDegrees: 15,
        facingOverrides: index === 1 ? { [participant.slot]: target } : {},
      };
    });
    gpu.render.mockImplementation((scene: THREE.Scene, camera: THREE.Camera) => {
      const root = scene.children.find((child) => child instanceof THREE.Group)!;
      visibility.push(root.visible);
      yaw.push(root.rotation.y);
      rotations.push(camera.quaternion.clone());
    });
    renderRuleCandidateFrames([participant], sets);
    expect(visibility).toEqual([false, true, false]);
    expect(yaw[1]).toBeCloseTo(Math.PI / 2);
    expect(yaw[2]).toBeCloseTo(yaw[0]);
    expect(rotations[0].angleTo(rotations[1])).toBeCloseTo(0);
    expect(rotations[0].angleTo(rotations[2])).toBeCloseTo(0);
  });

  it("releases meshes, shared materials and grid geometry exactly once", () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    gpu.render.mockImplementation((scene: THREE.Scene) => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        geometries.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material])
          .forEach((material) => materials.add(material));
      });
    });
    renderRuleCandidateFrames(sequence.participants, candidates());
    expect(geometryDispose.mock.contexts).toHaveLength(geometries.size);
    expect(new Set(geometryDispose.mock.contexts)).toEqual(geometries);
    expect(materialDispose.mock.contexts).toHaveLength(materials.size);
    expect(new Set(materialDispose.mock.contexts)).toEqual(materials);
  });

  it("cleans up after render failures while retaining successful candidates", () => {
    gpu.render.mockImplementationOnce(() => { throw new Error("render failed"); });
    const result = renderRuleCandidateFrames(sequence.participants, candidates());
    expect(result?.candidate_frames.map((frame) => frame.candidate_id))
      .toEqual(["candidate-1", "candidate-2"]);
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans up when every candidate fails", () => {
    gpu.render.mockImplementation(() => { throw new Error("render failed"); });
    expect(renderRuleCandidateFrames(sequence.participants, candidates())).toBeNull();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("cleans up after renderer initialization fails", () => {
    gpu.setSize.mockImplementationOnce(() => { throw new Error("initialization failed"); });
    expect(renderRuleCandidateFrames(sequence.participants, candidates())).toBeNull();
    expect(gpu.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it("does not allocate resources for an empty request or a non-browser runtime", () => {
    expect(renderRuleCandidateFrames([], [])).toEqual({ candidate_frames: [] });
    vi.stubGlobal("document", undefined);
    expect(renderRuleCandidateFrames(sequence.participants, candidates())).toBeNull();
    expect(gpu.constructed).not.toHaveBeenCalled();
  });
});
