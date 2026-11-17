// Arma la escena completa del Apartaestudio 201: estructura + acabados fijos + muebles de ejemplo.
// La usan el visor (main.js) y la herramienta que hornea la luz (hornear.js), así que las dos
// ven exactamente la misma geometría.
import * as THREE from 'three';
import { buildApartment, H } from './apartment.js';
import * as F from './furniture.js';
import { updateAnimations } from './anim.js';

const ROT = { 'z-': 0, 'z+': Math.PI, 'x+': -Math.PI / 2, 'x-': Math.PI / 2 };

export function buildScene() {
  const world = new THREE.Group();
  const apt = buildApartment();
  world.add(apt.group);

  const fixed = new THREE.Group();   // acabados que vienen con el apartamento
  const staged = new THREE.Group();  // muebles de ejemplo (botón "Amoblado")
  world.add(fixed, staged);
  const fixedColliders = [...apt.colliders];
  const stagedColliders = [];

  function put(obj, parent, collide) {
    parent.add(obj);
    if (collide) {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      (parent === staged ? stagedColliders : fixedColliders).push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
    }
    return obj;
  }
  /**
   * Pone un objeto con la espalda contra una pared.
   * side: 'z-' espalda hacia -Z (mira +Z) · 'z+' mira -Z · 'x+' espalda hacia +X (mira -X) · 'x-' mira +X
   */
  function against(obj, side, coord, along, parent, collide = true, y = 0) {
    obj.rotation.y = ROT[side];
    if (side[0] === 'z') obj.position.set(along, y, coord); else obj.position.set(coord, y, along);
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    if (side === 'z-') obj.position.z += coord - b.min.z;
    if (side === 'z+') obj.position.z += coord - b.max.z;
    if (side === 'x+') obj.position.x += coord - b.max.x;
    if (side === 'x-') obj.position.x += coord - b.min.x;
    return put(obj, parent, collide);
  }
  function at(obj, x, z, rotY, parent, collide = true, y = 0) {
    obj.position.set(x, y, z);
    obj.rotation.y = rotY;
    return put(obj, parent, collide);
  }
  // Pieza de pared (toma, interruptor, citófono): espalda en la cara del muro
  function onWall(fn, side, coord, along, y) {
    if (typeof fn !== 'function') return null;
    let o = null;
    try { o = fn(); } catch { return null; } // pieza aún no disponible en furniture.js
    if (!o) return null;
    o.rotation.y = ROT[side];
    if (side[0] === 'z') o.position.set(along, y, coord); else o.position.set(coord, y, along);
    return put(o, fixed, false);
  }

  // ---- Acabados fijos ----
  // Cocina en línea contra la fachada (lavaplatos hacia el baño, estufa hacia la ventana)
  const kitchen = against(F.kitchenRun({ length: 1.55, sinkAt: 0.27, cooktopAt: 0.78 }), 'x+', 4.35, 3.375, fixed);
  // Closet de la alcoba (nicho de 1.35 junto al balcón)
  const closet = against(F.closet({ width: 1.35, depth: 0.6, height: H }), 'z+', 8.76, 0.675, fixed);
  // Puertas
  const entryDoor = at(F.doorLeaf({ width: 0.90, style: 'black', hinge: 'left', swing: 1 }), 0.55, 2.155, 0, fixed, false);
  const bathDoor = at(F.doorLeaf({ width: 0.75, style: 'oak', hinge: 'left', swing: 1 }), 2.925, 1.305, 0, fixed, false);
  const bedDoor = at(F.doorLeaf({ width: 0.85, style: 'oak', hinge: 'left', swing: 1 }), 0.475, 5.575, 0, fixed, false);
  const balconyDoor = at(F.balconyDoor({ width: 2.85, height: 2.25 }), 2.925, 8.235, 0, fixed, false);
  // Ventanas en la fachada
  const salaWindow = at(F.slidingWindow({ width: 1.15, height: 1.20 }), 4.425, 4.825, Math.PI / 2, fixed, false, 0.95);
  at(F.slidingWindow({ width: 0.90, height: 0.45 }), 4.425, 0.60, Math.PI / 2, fixed, false, 1.80);
  // Baño
  against(F.vanity({ width: 0.60 }), 'z-', 0, 2.80, fixed);
  against(F.toilet(), 'z-', 0, 3.30, fixed);
  against(F.showerScreen({ width: 0.75, depth: 0.90, side: 'left' }), 'z-', 0, 3.975, fixed);
  // Lámparas de techo
  for (const [x, z] of [[1.6, 3.4], [3.0, 3.6], [2.2, 6.9], [3.3, 0.6], [3.3, 1.9], [2.9, 8.8]]) {
    at(F.ceilingLight(), x, z, 0, fixed, false, H).userData.lamparaTecho = true;
  }
  // Tomas, interruptores y citófono (como en el video)
  onWall(() => F.switchPlate({ gangs: 2 }), 'z-', 2.23, 1.18, 1.20);   // entrada, junto a la puerta
  onWall(F.intercom, 'x-', 0, 2.55, 1.45);                             // citófono junto a la entrada
  onWall(F.outlet, 'z-', 2.23, 2.05, 0.35);                            // escritorio
  onWall(F.outlet, 'x-', 0, 3.10, 0.35);                               // sala
  onWall(F.outlet, 'x+', 4.35, 2.85, 1.12);                            // mesón, lado lavaplatos
  onWall(F.outlet, 'x+', 4.35, 3.95, 1.12);                            // mesón, lado estufa
  onWall(F.outlet, 'x+', 4.35, 1.40, 1.20);                            // zona de ropas
  onWall(F.switchPlate, 'z+', 1.23, 3.45, 1.20);                       // baño (por fuera)
  onWall(F.switchPlate, 'z+', 5.50, 1.05, 1.20);                       // alcoba (lado sala)
  onWall(F.switchPlate, 'z-', 5.65, 1.05, 1.20);                       // alcoba (adentro)
  onWall(F.outlet, 'z-', 5.65, 1.45, 0.35);                            // mesa de noche izquierda
  onWall(F.outlet, 'z-', 5.65, 4.22, 0.35);                            // mesa de noche derecha
  onWall(F.outlet, 'x+', 4.35, 6.90, 0.35);                            // alcoba
  onWall(F.outlet, 'x-', 0, 4.95, 0.35);                               // junto al sofá
  onWall(F.towelRing, 'x-', 2.45, 0.80, 1.55);                         // toallero del baño

  // ---- Muebles de ejemplo ----
  against(F.bedQueen(), 'z-', 5.65, 2.85, staged);
  against(F.nightstand(), 'z-', 5.65, 1.72, staged);
  against(F.nightstand(), 'z-', 5.65, 3.98, staged);
  against(F.sofa({ width: 1.8 }), 'x-', 0, 4.15, staged);
  at(F.rug({ width: 1.6, depth: 2.0 }), 1.25, 4.15, 0, staged, false);
  at(F.coffeeTable(), 1.35, 4.15, 0, staged);
  at(F.diningTable({ width: 1.0, depth: 0.65 }), 3.0, 4.85, 0, staged);
  at(F.diningChair(), 2.30, 4.85, Math.PI / 2, staged);
  at(F.diningChair(), 3.70, 4.85, -Math.PI / 2, staged);
  against(F.desk({ width: 0.9 }), 'z-', 2.23, 1.70, staged);
  at(F.deskChair(), 1.70, 2.70, Math.PI, staged);
  const fridge = against(F.fridge(), 'x+', 4.35, 2.29, staged);
  const washer = against(F.washer(), 'x+', 4.35, 1.70, staged);
  // Electrodomésticos y mesas de noche de ejemplo: no hace falta abrirlos (menos puntos en pantalla)
  for (const o of [fridge, washer]) o.traverse((c) => { c.userData.interactive = false; });
  at(F.plant({ height: 0.8 }), 1.80, 9.02, 0, staged);
  at(F.plant({ height: 0.6 }), 4.08, 7.85, 0, staged);

  // Puertas interiores abiertas (así se hornea la luz y así arranca el recorrido)
  const firstInteractive = (root) => { let t = null; root.traverse((o) => { if (!t && o.userData.interactive) t = o; }); return t; };
  function openInteriorDoors() {
    firstInteractive(bathDoor)?.userData.toggle();
    firstInteractive(bedDoor)?.userData.toggle();
    for (let i = 0; i < 40; i++) updateAnimations(0.1);
  }

  world.updateMatrixWorld(true);
  return { world, apt, fixed, staged, fixedColliders, stagedColliders, doors: { entryDoor, bathDoor, bedDoor }, parts: { kitchen, closet, balconyDoor, salaWindow, bathDoor, bedDoor, entryDoor }, openInteriorDoors };
}
