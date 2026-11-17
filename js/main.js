// Página de venta: escena 3D (escena.js) + luz horneada (luz.js) + recorrido con scroll (historia.js).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from './escena.js';
import { loadBaked, applyBaked } from './luz.js';
import { setupHistoria } from './historia.js';
import { updateAnimations, isAnimating } from './anim.js';

// ---------- Render ----------
// La estructura usa luz horneada (sin luces ni sombras en tiempo real), así que el costo por
// píxel es mínimo. La resolución arranca en 1x y se ajusta sola según los fps del equipo.
const isPhone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
const MAX_RATIO = Math.min(window.devicePixelRatio || 1, isPhone ? 2 : 1.5);
let ratio = Math.min(isPhone ? 1.25 : 1, MAX_RATIO);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(ratio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.43;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1eee9);
const pmrem = new THREE.PMREMGenerator(renderer);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 120);

// ---------- Escena ----------
const S = buildScene();
S.openInteriorDoors();
scene.add(S.world);
const { apt, staged } = S;

// ---------- Luz ----------
const baked = await loadBaked('./js/luz.txt');
const setVariant = baked ? applyBaked(apt.group, baked) : null;
if (setVariant) {
  // Muebles y acabados: iluminados por una captura 360° del propio apartamento ya horneado
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e2d6, 0.35));
  const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cube = new THREE.CubeCamera(0.05, 40, rt);
  cube.position.set(2.2, 1.35, 4.4);
  scene.add(cube);
  cube.update(renderer, scene);
  scene.environment = pmrem.fromCubemap(rt.texture).texture;
  // Porcelanato con brillo: el piso refleja suavemente la luz de las ventanas y los muebles
  for (const fm of [apt.group.userData.floorMat, apt.group.userData.bathFloorMat]) {
    apt.group.traverse((o) => {
      if (o.isMesh && o.userData.bake && o.userData.srcMat === fm) {
        o.material.envMap = rt.texture;
        o.material.combine = THREE.AddOperation; // solo lo muy brillante (las ventanas) se nota
        o.material.reflectivity = fm === apt.group.userData.floorMat ? 0.035 : 0.025;
        o.material.needsUpdate = true;
      }
    });
  }
  // Afuera se ve como a plena luz del día (más claro que el interior, como en una foto)
  apt.surroundings.traverse((o) => {
    if (o.isMesh && !o.material.map && o.userData.flatTone !== false) o.material = new THREE.MeshBasicMaterial({ color: o.material.color.clone().multiplyScalar(2.2) });
  });
} else {
  // Respaldo si falta luz.bin: luz en tiempo real sencilla
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xefe9df, 1.25));
  scene.add(new THREE.AmbientLight(0xfff8ef, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
  sun.position.set(13, 9, 12);
  scene.add(sun);
}

// El espejo del baño refleja la captura 360° tomada en la sala (con zonas oscuras): se le da un
// acabado de vidrio claro en vez de espejo perfecto, para que no aparezcan manchas negras.
S.world.traverse((o) => {
  if (o.isMesh && o.material && o.material.metalness === 1 && o.material.roughness <= 0.03) {
    o.material = o.material.clone();
    o.material.metalness = 0.15;
    o.material.roughness = 0.12;
    o.material.color.set(0xdfe6ea);
  }
});

function setFurnished(on) {
  staged.visible = on;
  setVariant?.(on ? 0 : 1);
}
setFurnished(true);

// ---------- Recorrido con scroll ----------
const controls = setupHistoria({ camera, renderer, scene, world: S.world, apt, parts: S.parts, onFurnished: setFurnished });
renderer.setPixelRatio(ratio);
let dirty = true;
addEventListener('resize', () => { renderer.setPixelRatio(ratio); hq = false; dirty = true; });
// Las fotos de la vista exterior llegan después: redibujar cuando carguen
THREE.DefaultLoadingManager.onProgress = () => { dirty = true; };

// ---------- Calidad adaptable ----------
// Mide los cuadros mientras hay movimiento. Si el equipo no llega a ~45 fps baja la
// resolución interna; si va sobrado la sube, hasta MAX_RATIO.
const MIN_RATIO = 0.6;
let frames = 0, acc = 0, goodWindows = 0;
function adapt(frameDt) {
  if (frameDt > 0.25) return; // pestaña en segundo plano o pausa
  frames++; acc += frameDt;
  if (frames < 24) return;
  const avg = acc / frames;
  frames = 0; acc = 0;
  let next = ratio;
  if (avg > 1 / 45) { next = Math.max(MIN_RATIO, ratio * (avg > 1 / 25 ? 0.75 : 0.88)); goodWindows = 0; }
  else if (avg < 1 / 56 && ++goodWindows >= 3) { next = Math.min(MAX_RATIO, ratio * 1.1); goodWindows = 0; }
  if (Math.abs(next - ratio) > 0.01) { ratio = next; renderer.setPixelRatio(ratio); }
}

// ---------- Bucle ----------
// Solo se dibuja cuando algo cambia (cámara, animaciones, amoblado, vista de planta).
// Imagen nítida en reposo: mientras se mueve se dibuja a la resolución adaptable (fluido);
// cuando la vista se queda quieta un momento, se redibuja UNA vez en alta resolución.
const HQ_RATIO = Math.min(isPhone ? 2.5 : 2, Math.max(window.devicePixelRatio || 1, 1) * (isPhone ? 1 : 1.5));
let still = 0, hq = false;
const clock = new THREE.Clock();
const lastCam = new THREE.Matrix4(), lastProj = new THREE.Matrix4();
let lastState = '', first = true, renderedPrev = false, lastRenderT = 0;
renderer.setAnimationLoop((t) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (isAnimating()) dirty = true;
  updateAnimations(dt);
  controls.update(dt);
  camera.updateMatrixWorld();

  const state = `${staged.visible}|${apt.ceilings.visible}`;
  if (state !== lastState) { lastState = state; dirty = true; }
  if (!lastCam.equals(camera.matrixWorld) || !lastProj.equals(camera.projectionMatrix)) dirty = true;

  if (!dirty) {
    renderedPrev = false;
    still += dt;
    if (!hq && still > 0.3 && HQ_RATIO > ratio + 0.05) {
      hq = true;
      renderer.setPixelRatio(HQ_RATIO);
      renderer.render(scene, camera);
    }
    return;
  }
  still = 0;
  if (hq) { hq = false; renderer.setPixelRatio(ratio); renderedPrev = false; }
  lastCam.copy(camera.matrixWorld);
  lastProj.copy(camera.projectionMatrix);
  dirty = false;
  renderer.render(scene, camera);
  if (renderedPrev) adapt((t - lastRenderT) / 1000);
  renderedPrev = true;
  lastRenderT = t;

  if (first) {
    first = false;
    const c = document.getElementById('cargando');
    c.style.opacity = '0';
    setTimeout(() => c.remove(), 700);
  }
});

// Para depurar desde la consola
window.__tour = { scene, camera, renderer, world: S.world, staged, controls, getRatio: () => ratio, baked: !!setVariant };
