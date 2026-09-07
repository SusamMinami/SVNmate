import { useEffect, useMemo, useRef, useState } from "react";
import type { BlueprintFormationSnapshot, DialogueSequence } from "../types";
import { getSceneReference } from "../ue/client";
import type { SceneInspection, SceneReadRequest, SceneReference } from "../scene/sceneReference";

export function useSceneReference(
  sequence: DialogueSequence, snapshot: BlueprintFormationSnapshot | undefined, sourceName: string,
) {
  const request = useMemo((): Omit<SceneReadRequest, "radiusMeters"> | undefined => {
    if (!snapshot || !sequence.formationOrigin || snapshot.dialogueId !== sequence.prefix || snapshot.slots.length === 0 ||
        snapshot.blueprintClassPath !== sequence.formation?.classPath) return undefined;
    return { dialogueId: sequence.prefix, startId: sequence.startId, formationClassPath: snapshot.blueprintClassPath, stageOrigin: sequence.formationOrigin };
  }, [sequence.prefix, sequence.startId, sequence.formation?.classPath, sequence.formationOrigin, snapshot]);
  const key = JSON.stringify([sourceName, request ?? sequence.prefix]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [radius, setRadius] = useState(20);
  const [inspection, setInspection] = useState<SceneInspection>();
  const [draft, setDraft] = useState<SceneReference>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState(new Map<string, SceneReference>());
  const recordsRef = useRef(records);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setInspection(undefined); setDraft(undefined); setError(""); setBusy(false);
    return () => controller.current?.abort();
  }, [key, radius]);

  async function read(anchorId?: string) {
    if (!request) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++generation.current;
    const readKey = key;
    setBusy(true); setError("");
    setDraft(undefined);
    if (!anchorId) setInspection(undefined);
    try {
      const result = await getSceneReference({
        ...request, radiusMeters: radius, anchorId,
        inspectionFingerprint: anchorId ? inspection?.fingerprint : undefined,
      }, abort.signal);
      if (run !== generation.current || currentKey.current !== readKey) return;
      setInspection(result.inspection);
      setDraft(result.snapshot);
    } catch (cause) {
      if (run === generation.current && currentKey.current === readKey) {
        setError(cause instanceof Error && cause.name !== "AbortError"
          ? cause.message : "场景读取已中断或超时，原有分镜未改变");
      }
    } finally {
      if (run === generation.current && currentKey.current === readKey) setBusy(false);
    }
  }

  function store(value?: SceneReference) {
    const next = new Map(recordsRef.current);
    if (value) next.set(key, value); else next.delete(key);
    recordsRef.current = next;
    setRecords(next);
  }

  async function accept(ids: Set<string>, shareWithDirector: boolean, anchorId: string): Promise<SceneReference | undefined> {
    if (!draft) return;
    if (draft.anchor.id !== anchorId) throw new Error("落点已改变，请重新确认并采集");
    const readKey = key;
    const acceptRun = generation.current;
    const value = { ...draft, objects: draft.objects.filter((object) => ids.has(object.id)), shareWithDirector };
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
      base: draft.fingerprint, selected: value.objects.map((object) => object.id), shareWithDirector,
    })));
    if (currentKey.current !== readKey || generation.current !== acceptRun) return;
    value.fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    store(value);
    return value;
  }

  function attach(value: DialogueSequence): DialogueSequence {
    const scene = recordsRef.current.get(key);
    return { ...value, sceneReference: request && scene && value.prefix === request.dialogueId &&
      value.formation?.classPath === request.formationClassPath ? scene : undefined };
  }

  return {
    key, request, radius, setRadius, inspection, draft, current: records.get(key),
    busy, error, read, accept, attach, clear: () => store(),
    invalidateDraft: () => {
      generation.current += 1;
      controller.current?.abort();
      setDraft(undefined);
      setBusy(false);
    },
    cancel: () => {
      generation.current += 1; controller.current?.abort(); setBusy(false);
    },
  };
}
