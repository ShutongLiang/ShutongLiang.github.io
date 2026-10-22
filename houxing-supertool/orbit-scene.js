import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const canvas = document.querySelector("#skyCanvas");

if (canvas) {
  const targets = [
    { name: "TOI-700", catalog: "TIC 150428135", position: [4.6, 1.7, -0.8], color: 0x79e7df },
    { name: "TOI-4593", catalog: "TIC 399954349", position: [-4.25, 2.35, 0.7], color: 0xb99cff },
    { name: "TOI-4342", catalog: "TIC 354944123", position: [3.7, -2.8, 0.2], color: 0x86e3a7 },
    { name: "TOI-5624", catalog: "TIC 53498154", position: [-3.45, -2.7, -1.05], color: 0xffd36d },
    { name: "TOI-125", catalog: "TIC 52368076", position: [1.25, 4.05, -1.5], color: 0xff8f9c },
    { name: "TOI-216", catalog: "TIC 55652896", position: [-1.75, 3.55, 1.85], color: 0x83bdff },
    { name: "TOI-2180", catalog: "TIC 298663873", position: [2.2, -3.5, 1.55], color: 0xffb765 },
  ];

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02070d);
  scene.fog = new THREE.FogExp2(0x02070d, 0.028);

  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
  camera.position.set(0.15, 0.35, 8.2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene.add(new THREE.AmbientLight(0x29455e, 0.85));
  const keyLight = new THREE.DirectionalLight(0xe9f8ff, 3.4);
  keyLight.position.set(-5, 3, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x2d68bd, 1.4);
  rimLight.position.set(5, -2, -4);
  scene.add(rimLight);

  const earthGroup = new THREE.Group();
  earthGroup.rotation.set(0.16, -0.3, -0.12);
  scene.add(earthGroup);

  const earthTexture = new THREE.TextureLoader().load("earth-blue-marble.jpg");
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1.72, 80, 80),
    new THREE.MeshStandardMaterial({ map: earthTexture, roughness: 0.82, metalness: 0.02 }),
  );
  earthGroup.add(earth);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.75, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0xe6f9ff, transparent: true, opacity: 0.065, roughness: 1 }),
  );
  earthGroup.add(clouds);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.9, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0x52cfff, transparent: true, opacity: 0.075, side: THREE.BackSide }),
  );
  earthGroup.add(atmosphere);

  function ring(radius, verticalScale, color, opacity, tilt) {
    const points = Array.from({ length: 180 }, (_, index) => {
      const angle = index / 180 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * verticalScale, Math.sin(angle) * 0.25);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    line.rotation.set(tilt, 0.08, -0.18);
    scene.add(line);
  }
  ring(2.45, 0.58, 0x5a779d, 0.24, 0.12);
  ring(3.15, 0.62, 0x62dfe9, 0.38, 0.18);
  ring(3.9, 0.65, 0x5a779d, 0.2, 0.24);

  function random(index) {
    const value = Math.sin(index * 9283.47 + 17.21) * 43758.5453;
    return value - Math.floor(value);
  }

  const starPositions = [];
  const starColors = [];
  for (let index = 0; index < 4200; index += 1) {
    const radius = 13 + random(index) * 34;
    const theta = random(index + 6000) * Math.PI * 2;
    const phi = Math.acos(2 * random(index + 12000) - 1);
    starPositions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
    const warm = random(index + 18000) > 0.84;
    starColors.push(warm ? 1 : 0.72, warm ? 0.76 : 0.88, warm ? 0.46 : 1);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("color", new THREE.Float32BufferAttribute(starColors, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ size: 0.038, vertexColors: true, transparent: true, opacity: 0.86, sizeAttenuation: true }),
  );
  scene.add(stars);

  function labelTexture(target, selected = false) {
    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 430;
    labelCanvas.height = 112;
    const context = labelCanvas.getContext("2d");
    context.clearRect(0, 0, 430, 112);
    context.fillStyle = selected ? "rgba(7,24,35,.92)" : "rgba(3,12,20,.78)";
    context.strokeStyle = selected ? "rgba(121,231,223,.8)" : "rgba(150,205,228,.3)";
    context.lineWidth = selected ? 3 : 2;
    context.beginPath();
    context.roundRect(4, 4, 422, 104, 22);
    context.fill();
    context.stroke();
    context.fillStyle = selected ? "#f0fbff" : "#c1d5df";
    context.font = `${selected ? 700 : 600} 31px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.fillText(target.name, 28, 46);
    context.fillStyle = selected ? "#79e7df" : "#6f8d9d";
    context.font = "20px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillText(target.catalog, 28, 80);
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const interactive = [];
  targets.forEach((target) => {
    const group = new THREE.Group();
    group.position.fromArray(target.position);
    group.userData.target = target;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.072, 24, 24),
      new THREE.MeshBasicMaterial({ color: target.color, toneMapped: false }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshBasicMaterial({ color: target.color, transparent: true, opacity: 0.13, toneMapped: false }),
    );
    core.userData.target = target;
    halo.userData.target = target;
    group.add(core, halo);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(target), transparent: true, depthWrite: false }));
    sprite.position.set(0, -0.3, 0);
    sprite.scale.set(1.52, 0.395, 1);
    sprite.userData.target = target;
    group.add(sprite);
    scene.add(group);
    interactive.push(core, halo, sprite);
    target.group = group;
    target.core = core;
    target.halo = halo;
    target.sprite = sprite;
  });

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 4.8;
  controls.maxDistance = 12;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 0.18;
  controls.minPolarAngle = 0.28;
  controls.maxPolarAngle = Math.PI - 0.28;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDown = null;
  let selected = targets.find((target) => target.name === "TOI-125") || targets[0];

  function selectTarget(target, focus = true) {
    selected = target;
    targets.forEach((row) => {
      const active = row === target;
      row.core.scale.setScalar(active ? 1.42 : 1);
      row.halo.scale.setScalar(active ? 1.65 : 1);
      row.halo.material.opacity = active ? 0.28 : 0.13;
      row.sprite.material.map.dispose();
      row.sprite.material.map = labelTexture(row, active);
      row.sprite.material.needsUpdate = true;
    });
    document.querySelector("#sceneTargetName").textContent = target.name;
    document.querySelector("#sceneTargetCatalog").textContent = target.catalog;
    document.querySelector("#ticInput").value = target.name;
    document.querySelectorAll("#sceneTargets button").forEach((button) => {
      button.classList.toggle("active", button.dataset.target === target.name);
    });
    if (focus) controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.4);
  }

  function hitTest(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(interactive, false)[0];
    return hit?.object.userData.target || null;
  }

  canvas.addEventListener("pointerdown", (event) => { pointerDown = [event.clientX, event.clientY]; });
  canvas.addEventListener("pointermove", (event) => {
    canvas.style.cursor = hitTest(event) ? "pointer" : "grab";
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 7) return;
    const target = hitTest(event);
    if (target) selectTarget(target);
  });

  document.querySelectorAll("#sceneTargets button").forEach((button) => {
    button.addEventListener("click", () => {
      const target = targets.find((row) => row.name === button.dataset.target);
      if (target) selectTarget(target);
    });
  });
  document.querySelector("#sceneRunButton").addEventListener("click", () => {
    selectTarget(selected, false);
    document.querySelector("#scan").scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.querySelector("#searchForm").requestSubmit(), 520);
  });

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  function render() {
    const delta = Math.min(clock.getDelta(), 0.05);
    earth.rotation.y += delta * 0.018;
    clouds.rotation.y += delta * 0.026;
    stars.rotation.y -= delta * 0.0015;
    targets.forEach((target, index) => {
      target.halo.scale.multiplyScalar(1 + Math.sin(performance.now() * 0.0015 + index) * 0.0008);
    });
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  selectTarget(selected, false);
  render();
}
