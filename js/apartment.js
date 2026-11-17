// Estructura del Apartaestudio 201 (Las Margaritas): muros, pisos, techos, enchapes,
// balcón y entorno exterior. Medidas tomadas del plano (metros).
//
// Sistema de coordenadas (igual al plano con medidas, visto de frente):
//   x: de la pared medianera izquierda (x=0) a la fachada derecha (x=4.35)
//   z: del fondo del baño (z=0) hacia el balcón (z≈9.3)
//   y: altura, piso en 0, techo en 2.40
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const H = 2.4; // altura libre

// ---------- Texturas procedurales ----------
function canvasTex(size, draw, repeatMeters) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.userData.period = repeatMeters; // cuántos metros cubre una repetición
  return t;
}

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Porcelanato greige 60x60 (la textura cubre 1.2 m = 2x2 baldosas)
function tileTexture({ base, grout, tilesX, tilesY, period, vary = 6, seed = 7, veins = false }) {
  return canvasTex(1024, (g, s) => {
    const r = rand(seed);
    const tw = s / tilesX, th = s / tilesY;
    for (let i = 0; i < tilesX; i++) {
      for (let j = 0; j < tilesY; j++) {
        const d = (r() - 0.5) * vary;
        g.fillStyle = shade(base, d);
        g.fillRect(i * tw, j * th, tw, th);
        // moteado sutil
        for (let k = 0; k < 900; k++) {
          g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.025 * r()})`;
          g.fillRect(i * tw + r() * tw, j * th + r() * th, 2 + r() * 3, 2 + r() * 3);
        }
        if (veins) drawVeins(g, i * tw, j * th, tw, th, r);
      }
    }
    g.strokeStyle = grout;
    g.lineWidth = 3;
    for (let i = 0; i <= tilesX; i++) { g.beginPath(); g.moveTo(i * tw, 0); g.lineTo(i * tw, s); g.stroke(); }
    for (let j = 0; j <= tilesY; j++) { g.beginPath(); g.moveTo(0, j * th); g.lineTo(s, j * th); g.stroke(); }
  }, period);
}

function drawVeins(g, x, y, w, h, r) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  for (let v = 0; v < 4; v++) {
    g.strokeStyle = `rgba(140,140,145,${0.05 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 1.4;
    g.beginPath();
    let px = x + r() * w, py = y;
    g.moveTo(px, py);
    while (py < y + h) {
      px += (r() - 0.45) * w * 0.25;
      py += h * (0.08 + r() * 0.1);
      g.lineTo(px, py);
    }
    g.stroke();
  }
  g.restore();
}

function shade(hex, d) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + d));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const tex = {
  floor: tileTexture({ base: '#b2aca3', grout: '#97918a', tilesX: 2, tilesY: 1, period: 1.2, vary: 5 }),
  bathFloor: tileTexture({ base: '#6a6e78', grout: '#4f525a', tilesX: 2, tilesY: 2, period: 1.2, vary: 8, seed: 3 }),
  darkWall: tileTexture({ base: '#363a47', grout: '#9a9ca3', tilesX: 1, tilesY: 2, period: 1.2, vary: 5, seed: 11 }),
  marbleWall: tileTexture({ base: '#f1f0ec', grout: '#d9d7d1', tilesX: 1, tilesY: 2, period: 1.2, vary: 3, seed: 5, veins: true }),
};

export const mats = {
  wall: new THREE.MeshLambertMaterial({ color: 0xf3f2ee }),
  wallTop: new THREE.MeshLambertMaterial({ color: 0x8f8a83 }),
  ceiling: new THREE.MeshLambertMaterial({ color: 0xfafaf8 }),
  floor: new THREE.MeshLambertMaterial({ map: tex.floor }),
  bathFloor: new THREE.MeshLambertMaterial({ map: tex.bathFloor }),
  darkWall: new THREE.MeshLambertMaterial({ map: tex.darkWall }),
  marbleWall: new THREE.MeshLambertMaterial({ map: tex.marbleWall }),
  baseboard: new THREE.MeshLambertMaterial({ color: 0xc4bbad }),
  railing: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.5, metalness: 0.4 }),
  ground: new THREE.MeshLambertMaterial({ color: 0x7d8f62 }),
  street: new THREE.MeshLambertMaterial({ color: 0x8d8b86 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x5b4632 }),
  leaves: new THREE.MeshLambertMaterial({ color: 0x4f7a3a, flatShading: true }),
  leaves2: new THREE.MeshLambertMaterial({ color: 0x6b8f45, flatShading: true }),
  facade: new THREE.MeshLambertMaterial({ color: 0xe8e4dc }),
  sill: new THREE.MeshLambertMaterial({ color: 0xf2f0eb }),
};

// ---------- Helpers ----------
// Las superficies se subdividen cada ~15 cm para guardar la luz horneada por vértice.
const SEG = 0.15;
const segs = (s) => Math.max(1, Math.round(s / SEG));
function box(w, h, d, mat, x, y, z, seg = true) {
  const g = seg ? new THREE.BoxGeometry(w, h, d, segs(w), segs(h), segs(d)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Plano horizontal con UV en coordenadas de mundo (la textura no se estira)
function hPlane(x0, x1, z0, z1, y, mat, facingUp = true) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segs(x1 - x0), segs(z1 - z0));
  g.rotateX(facingUp ? -Math.PI / 2 : Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  worldUV(g, 'xz', mat.map?.userData.period || 1);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// Panel vertical (enchape) pegado a una pared, con UV de mundo
function vPanel(axis, fixed, a0, a1, y0, y1, mat, normalSign) {
  const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0, segs(a1 - a0), segs(y1 - y0));
  if (axis === 'x') {
    // corre a lo largo de X, en z = fixed, normal ±Z
    if (normalSign < 0) g.rotateY(Math.PI);
    g.translate((a0 + a1) / 2, (y0 + y1) / 2, fixed);
    worldUV(g, 'xy', mat.map.userData.period);
  } else {
    g.rotateY(normalSign > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(fixed, (y0 + y1) / 2, (a0 + a1) / 2);
    worldUV(g, 'zy', mat.map.userData.period);
  }
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

function worldUV(g, plane, period) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (plane === 'xz') uv.setXY(i, x / period, -z / period);
    else if (plane === 'xy') uv.setXY(i, x / period, y / period);
    else uv.setXY(i, z / period, y / period);
  }
  uv.needsUpdate = true;
}

/**
 * Muro con vanos. axis 'x' = corre a lo largo de X (grosor en Z).
 * span [a0,a1] a lo largo del eje, thick [t0,t1] en el otro eje.
 * openings: [{ from, to, bottom, top }]
 */
function wall(group, colliders, axis, a0, a1, t0, t1, openings = []) {
  const ops = [...openings].sort((p, q) => p.from - q.from);
  const pieces = [];
  let cur = a0;
  for (const o of ops) {
    if (o.from > cur) pieces.push([cur, o.from, 0, H]);
    if (o.bottom > 0) pieces.push([o.from, o.to, 0, o.bottom]);
    if (o.top < H) pieces.push([o.from, o.to, o.top, H]);
    cur = o.to;
  }
  if (cur < a1) pieces.push([cur, a1, 0, H]);

  const tc = (t0 + t1) / 2, tw = t1 - t0;
  for (const [p0, p1, y0, y1] of pieces) {
    const len = p1 - p0, ac = (p0 + p1) / 2;
    const m = axis === 'x'
      ? box(len, y1 - y0, tw, mats.wall, ac, (y0 + y1) / 2, tc)
      : box(tw, y1 - y0, len, mats.wall, tc, (y0 + y1) / 2, ac);
    group.add(m);
    // franja gris en el corte superior (se ve en la vista de planta)
    if (y1 >= H - 1e-6) {
      const cap = axis === 'x'
        ? box(len, 0.005, tw, mats.wallTop, ac, H + 0.003, tc)
        : box(tw, 0.005, len, mats.wallTop, tc, H + 0.003, ac);
      cap.castShadow = false;
      group.add(cap);
    }
    if (y0 < 0.9) {
      colliders.push(axis === 'x'
        ? { minX: p0, maxX: p1, minZ: t0, maxZ: t1 }
        : { minX: t0, maxX: t1, minZ: p0, maxZ: p1 });
    }
  }
}

// ---------- Construcción ----------
export function buildApartment() {
  const group = new THREE.Group();
  const ceilings = new THREE.Group();
  const colliders = [];
  group.add(ceilings);

  const door = (from, to) => ({ from, to, bottom: 0, top: 2.1 });

  // Muros a lo largo de X
  wall(group, colliders, 'x', 2.30, 4.50, -0.15, 0);                       // fondo del baño
  wall(group, colliders, 'x', 2.45, 4.35, 1.23, 1.38, [door(2.55, 3.30)]); // baño / ropas
  wall(group, colliders, 'x', -0.25, 2.30, 2.08, 2.23, [door(0.10, 1.00)]); // muro de entrada
  wall(group, colliders, 'x', 0, 4.35, 5.50, 5.65, [door(0.05, 0.90)]);     // sala / alcoba
  wall(group, colliders, 'x', 1.50, 4.35, 8.16, 8.31,                        // alcoba / balcón
    [{ from: 1.50, to: 4.35, bottom: 0, top: 2.25 }]);
  wall(group, colliders, 'x', -0.25, 1.50, 8.76, 8.91);                     // fondo del closet

  // Muros a lo largo de Z
  wall(group, colliders, 'z', 2.08, 8.91, -0.25, 0);                        // medianera izquierda
  wall(group, colliders, 'z', -0.15, 9.30, 4.35, 4.50, [                     // fachada derecha
    { from: 0.15, to: 1.05, bottom: 1.80, top: 2.25 },                       // ventana del baño
    { from: 4.25, to: 5.40, bottom: 0.95, top: 2.15 },                       // ventana de la sala
  ]);
  wall(group, colliders, 'z', -0.15, 2.85, 2.30, 2.45);                     // muro baño-ropas / entrada
  wall(group, colliders, 'z', 8.16, 9.30, 1.35, 1.50);                      // closet / balcón

  // Pisos
  group.add(hPlane(0, 4.35, 2.08, 8.91, 0, mats.floor));     // sala, cocina, alcoba
  group.add(hPlane(2.30, 4.35, 1.23, 2.08, 0, mats.floor));  // zona de ropas
  group.add(hPlane(1.35, 4.50, 8.91, 9.30, 0, mats.floor));  // balcón
  group.add(hPlane(2.30, 4.35, -0.15, 1.23, 0.002, mats.bathFloor)); // baño

  // Techos (se ocultan en la vista de planta)
  const ceil = (x0, x1, z0, z1) => {
    const m = hPlane(x0, x1, z0, z1, H, mats.ceiling, false);
    m.castShadow = true;
    ceilings.add(m);
  };
  ceil(-0.25, 4.50, 2.08, 9.30);
  ceil(2.30, 4.50, -0.15, 2.08);

  // Guardaescobas de porcelanato (zonas secas)
  const bb = (axis, a0, a1, fixed, sign) => {
    const t = 0.012, h = 0.07;
    const m = axis === 'x'
      ? box(a1 - a0, h, t, mats.baseboard, (a0 + a1) / 2, h / 2, fixed + sign * t / 2)
      : box(t, h, a1 - a0, mats.baseboard, fixed + sign * t / 2, h / 2, (a0 + a1) / 2);
    m.castShadow = false;
    group.add(m);
  };
  bb('z', 2.23, 5.50, 0, 1);  bb('z', 5.65, 8.16, 0, 1);         // medianera
  bb('z', 4.15, 4.25, 4.35, -1); bb('z', 5.40, 5.50, 4.35, -1);  // fachada sala
  bb('z', 5.65, 8.16, 4.35, -1);                                 // fachada alcoba
  bb('x', 1.00, 2.30, 2.23, 1);                                  // muro de entrada
  bb('x', 0.90, 4.35, 5.50, -1); bb('x', 0.90, 4.35, 5.65, 1);   // muro alcoba
  bb('z', 2.23, 2.85, 2.30, -1); bb('z', 1.38, 2.85, 2.45, 1);   // muro ropas

  // Enchapes del baño: gris oscuro en la ducha, mármol blanco en el resto
  const shX = 3.60, shZ = 0.90;
  group.add(vPanel('x', 0.004, shX, 4.35, 0, H, mats.darkWall, 1));           // fondo ducha
  group.add(vPanel('x', 0.004, 2.45, shX, 0, H, mats.marbleWall, 1));         // fondo resto
  group.add(vPanel('z', 4.346, 0, 0.15, 0, H, mats.darkWall, -1));            // fachada (ducha)
  group.add(vPanel('z', 4.346, 0.15, shZ, 0, 1.80, mats.darkWall, -1));
  group.add(vPanel('z', 4.346, 0.15, shZ, 2.25, H, mats.darkWall, -1));
  group.add(vPanel('z', 4.346, shZ, 1.05, 0, 1.80, mats.marbleWall, -1));
  group.add(vPanel('z', 4.346, shZ, 1.05, 2.25, H, mats.marbleWall, -1));
  group.add(vPanel('z', 4.346, 1.05, 1.23, 0, H, mats.marbleWall, -1));
  group.add(vPanel('z', 2.454, 0, 1.23, 0, H, mats.marbleWall, 1));           // muro izquierdo baño
  group.add(vPanel('x', 1.226, 2.45, 2.55, 0, H, mats.marbleWall, -1));       // muro de la puerta
  group.add(vPanel('x', 1.226, 3.30, 4.35, 0, H, mats.marbleWall, -1));
  group.add(vPanel('x', 1.226, 2.55, 3.30, 2.1, H, mats.marbleWall, -1));

  // Zona de ropas: panel de mármol con las tomas de agua
  group.add(vPanel('z', 4.346, 1.42, 2.55, 0.85, 1.45, mats.marbleWall, -1));

  // Balcón: baranda negra de barrotes verticales
  const rail = new THREE.Group();
  const rz = 9.24, rx0 = 1.50, rx1 = 4.35;
  rail.add(box(rx1 - rx0, 0.04, 0.05, mats.railing, (rx0 + rx1) / 2, 1.0, rz));
  rail.add(box(rx1 - rx0, 0.03, 0.03, mats.railing, (rx0 + rx1) / 2, 0.08, rz));
  for (let x = rx0 + 0.06; x < rx1; x += 0.11) {
    rail.add(box(0.018, 0.92, 0.018, mats.railing, x, 0.54, rz));
  }
  group.add(rail);
  colliders.push({ minX: rx0, maxX: rx1, minZ: rz - 0.03, maxZ: rz + 0.06 });

  // Borde del edificio (losa del piso vista desde afuera)
  // (solo bajo el apartamento: la zona de escaleras de al lado no se dibuja)
  group.add(box(4.75, 0.25, 7.22, mats.facade, 2.125, -0.126, 5.69, false));
  group.add(box(2.20, 0.25, 2.23, mats.facade, 3.40, -0.126, 0.965, false));

  // Cortinas enrollables recogidas (como en el video)
  group.add(box(0.09, 0.09, 1.25, mats.sill, 4.29, 2.21, 4.825));
  group.add(box(2.85, 0.09, 0.09, mats.sill, 2.925, 2.30, 8.10));
  // Alféizares blancos en las ventanas de la fachada
  group.add(box(0.14, 0.025, 1.19, mats.sill, 4.29, 0.95 + 0.0125, 4.825));
  group.add(box(0.14, 0.025, 0.94, mats.sill, 4.29, 1.80 + 0.0125, 0.60));

  group.userData.floorMat = mats.floor;
  group.userData.bathFloorMat = mats.bathFloor;
  const surroundings = buildSurroundings();

  // Rendimiento: fusionar todo lo estático en una pieza por material
  // (de ~130 dibujos por cuadro a ~20).
  mergeByMaterial(group, [ceilings]);
  mergeByMaterial(ceilings);
  mergeByMaterial(surroundings, [], false);
  group.add(surroundings);
  return { group, ceilings, colliders, surroundings };
}

function mergeByMaterial(root, exclude = [], bake = true) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const victims = [];
  const visit = (o) => {
    if (exclude.includes(o)) return;
    if (o.isMesh) {
      const g = o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!buckets.has(o.material)) buckets.set(o.material, { geos: [], cast: o.castShadow });
      buckets.get(o.material).geos.push(g);
      victims.push(o);
    }
    for (const c of o.children) visit(c);
  };
  for (const c of root.children) visit(c);
  for (const v of victims) { v.removeFromParent(); v.geometry.dispose(); }
  // quita grupos vacíos que quedaron
  for (const c of [...root.children]) if (c.isGroup && !exclude.includes(c) && c.children.length === 0) c.removeFromParent();
  for (const [mat, { geos, cast }] of buckets) {
    const allIndexed = geos.every((g) => g.index);
    const list = allIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.userData.bake = bake && mat !== mats.wallTop && mat !== mats.baseboard;
    m.castShadow = cast;
    m.receiveShadow = true;
    root.add(m);
    geos.forEach((g) => g.dispose());
  }
}

// Entorno: fotos reales de la vista (sacadas del video) detrás de cada ventana.
// Van a varios metros de la fachada para que se muevan con perspectiva al recorrer.
function buildSurroundings() {
  const g = new THREE.Group();
  const groundY = -5.2;
  // Bloque del edificio hacia abajo
  g.add(box(4.75, 5.0, 9.45, mats.facade, 2.125, groundY + 2.5, 4.575, false));

  const loader = new THREE.TextureLoader();
  const photo = (url, w, h, x, y, z, rotY) => {
    const tex = loader.load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.45, 1.45, 1.45), fog: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.userData.flatTone = false;
    g.add(m);
  };
  // Ventana de la sala (fachada +X): árboles y casa de techo rojo
  photo('./img/vista-sala.jpg', 8.6, 8.3, 10.4, 1.3, 4.8, -Math.PI / 2);
  // Balcón (+Z): árboles, postes y la calle
  photo('./img/vista-balcon.jpg', 25.5, 17, 2.9, 2.6, 20.5, Math.PI); // foto: Unsplash (UIqDr16kZzY)
  // Ventana alta del baño: vidrio esmerilado (luz blanca difusa, sin vista)
  const frost = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.58) }));
  frost.position.set(4.47, 2.025, 0.60);
  frost.rotation.y = -Math.PI / 2;
  frost.userData.flatTone = false;
  g.add(frost);
  return g;
}
