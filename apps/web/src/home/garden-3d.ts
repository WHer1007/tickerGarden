import * as THREE from "three";
import { GARDEN_FRUITS, wrapFruitIndex } from "./garden-data.ts";

/** A self-contained, progressively enhanced sculpture. No wallet, RPC or price dependency. */
export function mountGarden(stage: HTMLElement): () => void {
  const viewport = stage.querySelector<HTMLElement>("[data-garden-viewport]")!;
  const labels = stage.querySelector<HTMLElement>("[data-garden-labels]")!;
  const motionButton = stage.querySelector<HTMLButtonElement>("[data-garden-motion]")!;
  const status = stage.querySelector<HTMLElement>("[data-garden-status]")!;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute("aria-hidden", "true");
  viewport.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
  camera.position.set(0, 0.8, 8.7);
  camera.lookAt(0, 0.25, 0);
  scene.add(new THREE.HemisphereLight(0xfff9e6, 0x446650, 2.4));
  const key = new THREE.DirectionalLight(0xfff2d6, 3.5);
  key.position.set(-3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcbe5ab, 2);
  rim.position.set(4, 3, -2);
  scene.add(rim);
  const tree = new THREE.Group();
  scene.add(tree);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const material = (color: string, roughness = 0.55) => {
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    materials.push(result);
    return result;
  };
  const bark = material("#53754a");
  const leaves = ["#174d35", "#2f6742", "#477e43", "#799a54"].map((color) => material(color));
  const sphere = new THREE.SphereGeometry(1, 24, 18);
  geometries.push(sphere);
  function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = tree) {
    const result = new THREE.Mesh(geometry, mat);
    parent.add(result);
    return result;
  }
  function branch(points: THREE.Vector3[], radius: number, endRadius = 0.014) {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, 20, radius, 8, false);
    const positions = geometry.attributes.position!;
    for (let i = 0; i <= 20; i++) {
      const center = curve.getPointAt(i / 20);
      const taper = 1 + (endRadius / radius - 1) * i / 20;
      for (let j = 0; j <= 8; j++) {
        const k = i * 9 + j;
        const point = new THREE.Vector3().fromBufferAttribute(positions, k).sub(center).multiplyScalar(taper).add(center);
        positions.setXYZ(k, point.x, point.y, point.z);
      }
    }
    geometry.computeVertexNormals();
    geometries.push(geometry);
    return mesh(geometry, bark);
  }
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  branch([v(0, -1.34, 0), v(-0.12, -0.6, 0), v(0.12, 0.3, -0.15), v(-0.12, 1.3, -0.12), v(0, 2.07, -0.2)], 0.19, 0.035);

  // A ceramic island, with a recessed green top and orbit engraved around the rim.
  const baseGeometry = new THREE.CylinderGeometry(1.37, 1.2, 0.22, 64);
  geometries.push(baseGeometry);
  const base = mesh(baseGeometry, material("#e7ddc4"));
  base.position.y = -1.48;
  const soilGeometry = new THREE.CylinderGeometry(1.18, 1.18, 0.035, 64);
  geometries.push(soilGeometry);
  const soil = mesh(soilGeometry, material("#93a36b"));
  soil.position.y = -1.35;
  const ringGeometry = new THREE.TorusGeometry(1.25, 0.012, 6, 80);
  geometries.push(ringGeometry);
  const ring = mesh(ringGeometry, material("#b4c779"));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.352;
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.4;
    branch([v(0, -1.32, 0), v(Math.cos(angle) * 0.38, -1.3, Math.sin(angle) * 0.38), v(Math.cos(angle) * 0.8, -1.335, Math.sin(angle) * 0.8)], 0.06, 0.008);
  }
  // Broad leaves sit behind the fruit, so every ticker reads clearly from the home view.
  const leafObjects: { mesh: THREE.Mesh; angle: number }[] = [];
  GARDEN_FRUITS.forEach((fruit, i) => {
    const [x, y, z] = fruit.position;
    const tip = v(x, y + 0.37, z - 0.16);
    branch([v(0.03, Math.max(-0.65, y - 0.95), -0.12), v(x * 0.52, y + 0.05, z - 0.4), tip], 0.075, 0.02);
    for (let j = 0; j < 3; j++) {
      const leaf = mesh(sphere, leaves[(i + j) % leaves.length]!);
      leaf.position.set(x + (j - 1) * 0.3, y + 0.33 + (j % 2) * 0.12, z - 0.31 - j * 0.08);
      leaf.scale.set(0.22 + j * 0.025, 0.5, 0.09);
      leaf.rotation.set(-0.22 + j * 0.2, i * 0.8, (j - 1) * 0.85 + (x > 0 ? -0.3 : 0.3));
      leafObjects.push({ mesh: leaf, angle: leaf.rotation.z });
    }
  });
  const fruits = GARDEN_FRUITS.map((fruit, i) => {
    const group = new THREE.Group();
    group.position.set(fruit.position[0], fruit.position[1], fruit.position[2]);
    tree.add(group);
    const fruitMaterial = new THREE.MeshPhysicalMaterial({ color: fruit.color, roughness: 0.28, metalness: 0.03, clearcoat: 0.45, clearcoatRoughness: 0.3 });
    materials.push(fruitMaterial);
    const ball = mesh(sphere, fruitMaterial, group);
    ball.scale.set(0.31, 0.33, 0.3);
    ball.userData.fruitIndex = i;
    const stemGeometry = new THREE.CylinderGeometry(0.015, 0.024, 0.16, 6);
    geometries.push(stemGeometry);
    const stem = mesh(stemGeometry, bark, group);
    stem.position.set(0, 0.35, 0);
    stem.rotation.z = -0.24;
    const leaf = mesh(sphere, leaves[2]!, group);
    leaf.scale.set(0.13, 0.055, 0.07);
    leaf.position.set(0.1, 0.4, 0);
    leaf.rotation.z = 0.35;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "garden-fruit-label";
    button.textContent = fruit.symbol;
    button.setAttribute("aria-label", `Explore ${fruit.symbol}, ${fruit.name}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => selectFruit(i), options);
    button.addEventListener("focus", () => { hovered = i; }, options);
    button.addEventListener("blur", () => { hovered = -1; }, options);
    button.addEventListener("pointerenter", () => { hovered = i; }, options);
    button.addEventListener("pointerleave", () => { hovered = -1; }, options);
    labels.append(button);
    return { group, ball, button };
  });
  let selected = -1;
  let hovered = -1;
  let targetYaw = 0;
  let targetPitch = 0;
  let moving = !reduceMotion.matches;
  let visible = true;
  let disposed = false;
  let lastInteraction = performance.now();
  let lastFrame = 0;
  let frameId = 0;
  let width = 1, height = 1;
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const projected = new THREE.Vector3();
  const world = new THREE.Vector3();
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;

  function updateMotionButton() {
    motionButton.setAttribute("aria-pressed", String(moving));
    motionButton.textContent = moving ? "Pause motion" : "Resume motion";
  }
  function selectFruit(index: number) {
    selected = wrapFruitIndex(index);
    const fruit = GARDEN_FRUITS[selected]!;
    lastInteraction = performance.now();
    stage.querySelector<HTMLElement>("[data-garden-symbol]")!.textContent = fruit.symbol;
    stage.querySelector<HTMLElement>("[data-garden-story]")!.textContent = fruit.story;
    status.textContent = `${fruit.symbol} · ${fruit.name}. ${fruit.story}`;
    stage.style.setProperty("--selected-fruit", fruit.color);
    fruits.forEach(({ button }, i) => button.setAttribute("aria-pressed", String(i === selected)));
  }
  function resize() {
    width = viewport.clientWidth; height = viewport.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = camera.aspect < 1.15 ? 9.6 : 8.7;
    camera.updateProjectionMatrix();
  }
  function pick(event: PointerEvent) {
    const rect = viewport.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(fruits.map(({ ball }) => ball), false)[0]?.object.userData.fruitIndex as number | undefined;
  }
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: targetYaw, pitch: targetPitch, moved: false };
    viewport.setPointerCapture(event.pointerId);
    lastInteraction = performance.now();
    viewport.classList.add("is-dragging");
  }, options);
  viewport.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId) {
      const dx = event.clientX - drag.x;
      drag.moved ||= Math.abs(dx) + Math.abs(event.clientY - drag.y) > 5;
      targetYaw = drag.yaw + dx * 0.008;
      targetPitch = event.pointerType === "touch" ? 0 : THREE.MathUtils.clamp(drag.pitch + (event.clientY - drag.y) * 0.002, -0.16, 0.16);
    } else if (!(event.target as HTMLElement).closest("button")) {
      hovered = pick(event) ?? -1;
    }
  }, options);
  function endDrag(event: PointerEvent) {
    if (drag?.id !== event.pointerId) return;
    if (!drag.moved && event.type === "pointerup") {
      const index = pick(event);
      if (index !== undefined) selectFruit(index);
    }
    drag = null;
    viewport.classList.remove("is-dragging");
    lastInteraction = performance.now();
  }
  viewport.addEventListener("pointerup", endDrag, options);
  viewport.addEventListener("pointercancel", endDrag, options);
  viewport.addEventListener("lostpointercapture", endDrag, options);
  viewport.addEventListener("pointerleave", () => { hovered = -1; }, options);
  viewport.addEventListener("keydown", (event) => {
    if (event.target !== viewport) return;
    if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) {
      event.preventDefault();
      targetYaw = event.key === "Home" ? 0 : targetYaw + (event.key === "ArrowLeft" ? -0.25 : 0.25);
      lastInteraction = performance.now();
    }
  }, options);
  motionButton.addEventListener("click", () => { moving = !moving; updateMotionButton(); }, options);
  stage.querySelector("[data-garden-reset]")!.addEventListener("click", () => {
    targetYaw = 0; targetPitch = 0; lastInteraction = performance.now();
    selected = -1;
    fruits.forEach(({ button }) => button.setAttribute("aria-pressed", "false"));
    stage.querySelector<HTMLElement>("[data-garden-symbol]")!.textContent = "Pick a ticker";
    stage.querySelector<HTMLElement>("[data-garden-story]")!.textContent = "Every branch has a different story.";
    status.textContent = "Garden view reset.";
  }, options);
  stage.querySelector("[data-garden-next]")!.addEventListener("click", () => selectFruit(selected + 1), options);
  reduceMotion.addEventListener("change", () => { moving = !reduceMotion.matches; updateMotionButton(); }, options);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(viewport);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; }, { threshold: 0 });
  intersection.observe(stage);

  function frame(now: number) {
    if (disposed) return;
    frameId = requestAnimationFrame(frame);
    if (!visible || document.hidden || now - lastFrame < 32) return;
    lastFrame = now;
    const idle = moving && !drag && now - lastInteraction > 1800;
    const desiredYaw = targetYaw + (idle ? Math.sin(now * 0.00022) * 0.09 : 0);
    const smoothing = reduceMotion.matches ? 1 : 0.13;
    tree.rotation.y += (desiredYaw - tree.rotation.y) * smoothing;
    tree.rotation.x += (targetPitch - tree.rotation.x) * smoothing;
    leafObjects.forEach(({ mesh: leaf, angle }, i) => { leaf.rotation.z = angle + (moving ? Math.sin(now * 0.001 + i) * 0.025 : 0); });
    tree.updateMatrixWorld(true);
    const labelPositions: { button: HTMLButtonElement; x: number; y: number; depth: number }[] = [];
    fruits.forEach(({ group, ball, button }, i) => {
      const scale = i === selected ? 1.13 : i === hovered ? 1.07 : 1;
      group.scale.lerp(new THREE.Vector3(scale, scale, scale), reduceMotion.matches ? 1 : 0.2);
      ball.getWorldPosition(world);
      projected.copy(world).project(camera);
      button.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      button.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
      button.style.zIndex = String(Math.round((world.z + 5) * 10));
      button.style.opacity = world.z < -0.25 ? "0.55" : "1";
      button.classList.toggle("is-selected", i === selected);
      labelPositions.push({ button, x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height, depth: world.z });
    });
    // Keep the nearer label when fruit silhouettes overlap during rotation.
    const placed: typeof labelPositions = [];
    labelPositions.sort((a, b) => b.depth - a.depth).forEach((label) => {
      const occluded = placed.some((front) => Math.abs(front.x - label.x) < 42 && Math.abs(front.y - label.y) < 28);
      label.button.style.visibility = occluded ? "hidden" : "visible";
      if (!occluded) placed.push(label);
    });
    renderer.render(scene, camera);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameId);
    controller.abort();
    resizeObserver.disconnect(); intersection.disconnect();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((mat) => mat.dispose());
    renderer.dispose();
    renderer.domElement.remove();
    labels.replaceChildren();
    stage.classList.remove("garden-ready");
  }
  renderer.domElement.addEventListener("webglcontextlost", (event) => { event.preventDefault(); dispose(); }, options);
  resize(); updateMotionButton();
  // Commit the enhancement only after a successful render; keep the original illustration as fallback.
  try { renderer.render(scene, camera); } catch (error) { dispose(); throw error; }
  stage.classList.add("garden-ready");
  frameId = requestAnimationFrame(frame);
  return dispose;
}
