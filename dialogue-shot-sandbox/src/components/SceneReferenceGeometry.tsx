import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SceneReference } from "../scene/sceneReference";

export function SceneReferenceGeometry({ scene }: { scene?: SceneReference }) {
  const resources = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    return { geometry, material: new THREE.LineBasicMaterial({ color: "#16869b", transparent: true, opacity: 0.65, depthWrite: false }) };
  }, []);
  useEffect(() => () => {
    resources.geometry.dispose();
    resources.material.dispose();
  }, [resources]);
  if (!scene) return null;
  return <group dispose={null}>
    {scene.objects.map((object) => <lineSegments key={object.id}
      geometry={resources.geometry} material={resources.material}
      position={object.center} scale={object.size} />)}
  </group>;
}
