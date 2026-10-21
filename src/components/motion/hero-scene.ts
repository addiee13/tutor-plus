import * as THREE from "three";

/** One draw call, no textures, lighting, or post-processing. */
export function mountHeroScene(host: HTMLDivElement): () => void {
  const canvas = document.createElement("canvas");
  // Avoid creating a renderer (and console error) when WebGL2 is unavailable.
  const context = canvas.getContext("webgl2", { alpha: true, antialias: false });
  if (!context) return () => {};
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
  camera.position.z = 9;
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const palette = getComputedStyle(host);
  const material = new THREE.MeshBasicMaterial({
    color: palette.getPropertyValue("--caramel").trim(),
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const papers = new THREE.InstancedMesh(geometry, material, 14);
  papers.frustumCulled = false;
  scene.add(papers);
  const dummy = new THREE.Object3D();
  const desktop = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
  let visible = false;
  let lost = false;
  let frame = 0;
  let previous = 0;
  let elapsed = 0;
  const pointer = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2));
    renderer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  const move = (event: PointerEvent) => {
    if (!desktop.matches || event.pointerType === "touch") return;
    pointer.x = (event.clientX / window.innerWidth - 0.5) * 0.35;
    pointer.y = (event.clientY / window.innerHeight - 0.5) * 0.2;
  };
  const reset = () => {
    pointer.x = 0;
    pointer.y = 0;
  };
  const render = (time: number) => {
    frame = 0;
    const delta = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
    previous = time;
    elapsed += delta;
    const smoothing = 1 - Math.exp(-delta * 3);
    if (!desktop.matches) reset();
    current.x += (pointer.x - current.x) * smoothing;
    current.y += (pointer.y - current.y) * smoothing;
    camera.position.x = current.x;
    camera.position.y = -current.y;
    for (let i = 0; i < papers.count; i++) {
      dummy.position.set(
        Math.sin(i * 2.4) * 7 + Math.sin(elapsed * 0.07 + i) * 0.3,
        Math.cos(i * 1.7) * 3.2 + Math.sin(elapsed * 0.09 + i * 2) * 0.25,
        -1 - (i % 4) * 0.7,
      );
      dummy.rotation.set(Math.sin(elapsed * 0.08 + i) * 0.45, i * 0.7 + elapsed * 0.035, i * 0.9);
      dummy.scale.set(0.12 + (i % 3) * 0.11, 0.2 + (i % 3) * 0.16, 1);
      dummy.updateMatrix();
      papers.setMatrixAt(i, dummy.matrix);
    }
    papers.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  const sync = () => {
    if (visible && !document.hidden && !lost) {
      if (!frame) {
        previous = 0;
        frame = requestAnimationFrame(render);
      }
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
    }
  };
  const lose = (event: Event) => {
    event.preventDefault();
    lost = true;
    sync();
  };
  const restore = () => {
    lost = false;
    resize();
    sync();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  const sizeObserver = new ResizeObserver(resize);
  host.append(canvas);
  resize();
  observer.observe(host);
  sizeObserver.observe(host);
  window.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerleave", reset);
  document.addEventListener("visibilitychange", sync);
  canvas.addEventListener("webglcontextlost", lose);
  canvas.addEventListener("webglcontextrestored", restore);
  return () => {
    observer.disconnect();
    sizeObserver.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    document.removeEventListener("pointerleave", reset);
    document.removeEventListener("visibilitychange", sync);
    canvas.removeEventListener("webglcontextlost", lose);
    canvas.removeEventListener("webglcontextrestored", restore);
    scene.clear();
    papers.dispose();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
