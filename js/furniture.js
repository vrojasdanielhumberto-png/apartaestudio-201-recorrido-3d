// Muebles, aparatos y carpintería del recorrido 3D.
// Convención: metros, Y arriba, piso en y=0. Cada builder devuelve un THREE.Group con origen en el
// centro de su huella a nivel de piso, con el FRENTE hacia +Z y la espalda hacia -Z.
// Excepción: piezas de pared (outlet, switchPlate, intercom, windowSill, towelRing) tienen el origen
// en el centro de su cara trasera (la que toca el muro, z=0) y miran a +Z.
// Las piezas estáticas de cada mueble se fusionan por material (pocos draw calls para móvil);
// las piezas que abren (puertas, cajones, correderas) son grupos propios con makeInteractive().
//
// Iluminación: el casco va horneado y los muebles se iluminan solo con scene.environment (IBL) +
// luz hemisférica, sin sombras en tiempo real. Por eso:
// - Materiales PBR con rugosidad/metalicidad realistas (sin transmission/sheen; clearcoat no se usa).
// - Oclusión ambiental falsa horneada en colores de vértice para telas (sofá, cama, cojines, ropa):
//   se calcula con un SDF analítico de las piezas del mismo mueble + el piso (ver Parts._ao).
// - Juntas de sombra oscuras entre frentes, zócalo oscuro e interiores un poco más oscuros.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { tween, makeInteractive } from './anim.js';

const DEG = Math.PI / 180;
const GAP = 0.003; // junta de sombra entre frentes
const T = 0.018; // espesor de tablero

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function rng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V2 = (x, y) => new THREE.Vector2(x, y);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([x, y]) => V2(x, y)), seg);

/**
 * Proyección UV en coordenadas de mundo/local (tipo triplanar por cara): la veta y el mármol
 * quedan a escala real en cualquier geometría. Devuelve la geometría (no indexada).
 * Útil para reutilizar materials.oak / materials.marble en muros: applyWorldUV(geo, ...materials.marble.userData.uvScale)
 * swapY: en caras horizontales usa (z, x) en vez de (x, z) (veta de la madera a lo largo de X).
 */
export function applyWorldUV(geo, su = 1, sv = su, swapY = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const n = p.count;
  let uv = g.attributes.uv;
  if (!uv || uv.count !== n) {
    uv = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    g.setAttribute('uv', uv);
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const tri = [a, b, c];
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    ab.cross(ac);
    const ax = Math.abs(ab.x), ay = Math.abs(ab.y), az = Math.abs(ab.z);
    for (let k = 0; k < 3; k++) {
      const v = tri[k];
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; }
      else if (ay >= az) { if (swapY) { u = v.z; w = v.x; } else { u = v.x; w = v.z; } }
      else { u = v.x; w = v.y; }
      uv.setXY(i + k, u * su, w * sv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

// ---------------------------------------------------------------------------
// Geometrías blandas (cojines, colchón, tapizados, telas)
// ---------------------------------------------------------------------------

function axisCoord(i, n, b, m, hh, r) {
  if (b && i <= b) return -hh + (r * i) / b;
  if (b && i >= n - b) return hh - (r * (n - i)) / b;
  return -(hh - r) + (2 * (hh - r) * (i - b)) / m;
}

/**
 * Caja redondeada subdividida de forma uniforme (vértices también en el centro de las caras, para
 * poder inflarla/hundirla y para que la AO por vértice tenga resolución).
 * puff: abombado de las caras superior/inferior; puffSide: abombado de los costados.
 * deform(v, hx, hy, hz): deformación libre por vértice (después de redondear e inflar).
 */
function softBoxGeo(w, h, d, r, { seg = 0.08, band = 2, puff = 0, puffSide = 0, deform = null } = {}) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  r = Math.max(0, Math.min(r, Math.min(hx, hy, hz) - 1e-4));
  const b = r > 1e-4 ? band : 0;
  const mx = Math.max(1, Math.round((w - 2 * r) / seg));
  const my = Math.max(1, Math.round((h - 2 * r) / seg));
  const mz = Math.max(1, Math.round((d - 2 * r) / seg));
  const nx = 2 * b + mx, ny = 2 * b + my, nz = 2 * b + mz;
  const g = new THREE.BoxGeometry(2, 2, 2, nx, ny, nz);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const p = g.attributes.position;
  const v = V3(), c = V3();
  const ix = hx - r, iy = hy - r, iz = hz - r;
  for (let k = 0; k < p.count; k++) {
    v.set(
      axisCoord(Math.round(((p.getX(k) + 1) * nx) / 2), nx, b, mx, hx, r),
      axisCoord(Math.round(((p.getY(k) + 1) * ny) / 2), ny, b, my, hy, r),
      axisCoord(Math.round(((p.getZ(k) + 1) * nz) / 2), nz, b, mz, hz, r),
    );
    if (r > 0) {
      c.set(clamp(v.x, -ix, ix), clamp(v.y, -iy, iy), clamp(v.z, -iz, iz));
      v.sub(c);
      const l = v.length();
      if (l > 1e-9) v.multiplyScalar(r / l);
      v.add(c);
    }
    if (puff || puffSide) {
      const fx = Math.max(0, 1 - (v.x / hx) ** 2);
      const fy = Math.max(0, 1 - (v.y / hy) ** 2);
      const fz = Math.max(0, 1 - (v.z / hz) ** 2);
      v.y += puff * (v.y / hy) * fx * fz;
      v.x += puffSide * (v.x / hx) * fy * fz;
      v.z += puffSide * (v.z / hz) * fx * fy;
    }
    if (deform) deform(v, hx, hy, hz);
    p.setXYZ(k, v.x, v.y, v.z);
  }
  const out = mergeVertices(g);
  out.computeVertexNormals();
  return out;
}

/** Cojín/almohada de pie (espesor en Z): bordes finos, centro lleno, costuras algo cóncavas. */
function pillowGeo(w, h, t, seg = 0.05) {
  return softBoxGeo(w, h, t, Math.min(t * 0.48, 0.06), {
    seg,
    deform: (v, hx, hy) => {
      const ax = Math.min(1, Math.abs(v.x) / hx), ay = Math.min(1, Math.abs(v.y) / hy);
      const f = Math.max(0, (1 - ax ** 3) * (1 - ay ** 3));
      v.z *= 0.22 + 0.78 * Math.pow(f, 0.55);
      v.x *= 1 - 0.035 * ay * ay;
      v.y *= 1 - 0.035 * ax * ax;
    },
  });
}

/** Curva una geometría alrededor del eje Y: los extremos en X se adelantan hacia +Z (respaldos). */
function bendGeo(g, R) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const th = x / R, rho = R - z;
    p.setXYZ(i, rho * Math.sin(th), p.getY(i), R - rho * Math.cos(th));
  }
  g.computeVertexNormals();
  return g;
}

function spanSamples(spans) {
  const out = [spans[0][0]];
  for (const [a, b, n] of spans) for (let i = 1; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

/**
 * Tela (edredón, pie de cama) que cubre una superficie superior y cae por los costados (±X) y el
 * frente (+Z), con doblez de radio rr, arrugas en la caída, abombado arriba y dobladillo de espesor th.
 * hw: semiancho de la parte plana; z0: borde trasero libre; z1: borde donde empieza la caída frontal.
 */
function drapeGeo({ hw, z0, z1, top, drop, rr = 0.06, th = 0.03, puff = 0.01, wrinkle = 0.008, seed = 1, front = true, flatSeg = 0.06 }) {
  const r = rng(seed);
  const arc = (rr * Math.PI) / 2, hang = Math.max(0.002, drop - rr);
  const nf = (len) => Math.max(1, Math.round(len / flatSeg));
  const us = spanSamples([
    [-(hw + arc + hang), -(hw + arc), 4], [-(hw + arc), -hw, 4], [-hw, hw, nf(2 * hw)],
    [hw, hw + arc, 4], [hw + arc, hw + arc + hang, 4],
  ]);
  const zl = z1 - z0;
  const vs = spanSamples(front ? [[0, zl, nf(zl)], [zl, zl + arc, 4], [zl + arc, zl + arc + hang, 4]] : [[0, zl, nf(zl)]]);
  const fold = (s) => {
    if (s <= 0) return [s, 0];
    if (s < arc) { const a = s / rr; return [rr * Math.sin(a), rr * (1 - Math.cos(a))]; }
    const t = s - arc;
    return [rr + t * 0.07, rr + t];
  };
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
  const nu = us.length, nv = vs.length;
  const P = new Float32Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    const ez = vs[j] - zl;
    const [oz, dyz] = front ? fold(ez) : [ez, 0];
    for (let i = 0; i < nu; i++) {
      const su = us[i];
      const [ox, dyx] = fold(Math.abs(su) - hw);
      let x = Math.sign(su) * (hw + ox);
      let z = z1 + oz;
      const dy = Math.max(dyx, dyz);
      let y = top - dy;
      const flat = 1 - smooth(0, rr, dy);
      const fxp = Math.max(0, 1 - (x / (hw + rr * 0.5)) ** 2);
      y += puff * flat * fxp * (0.75 + 0.25 * Math.sin(x * 9 + ph[0]) * Math.sin(z * 6 + ph[1]));
      const hx = smooth(rr * 0.5, drop, dyx), hz = smooth(rr * 0.5, drop, dyz);
      x += Math.sign(su) * wrinkle * hx * Math.sin(z * 24 + ph[2]);
      z += wrinkle * hz * Math.sin(x * 22 + ph[3]);
      P[(j * nu + i) * 3] = x;
      P[(j * nu + i) * 3 + 1] = y;
      P[(j * nu + i) * 3 + 2] = z;
    }
  }
  const id = (i, j) => j * nu + i;
  const N = new Float32Array(nu * nv * 3);
  const a = V3(), b = V3(), du = V3(), dv = V3();
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      a.fromArray(P, id(Math.min(i + 1, nu - 1), j) * 3);
      b.fromArray(P, id(Math.max(i - 1, 0), j) * 3);
      du.subVectors(a, b);
      a.fromArray(P, id(i, Math.min(j + 1, nv - 1)) * 3);
      b.fromArray(P, id(i, Math.max(j - 1, 0)) * 3);
      dv.subVectors(a, b);
      a.crossVectors(dv, du).normalize();
      a.toArray(N, id(i, j) * 3);
    }
  }
  // contorno -> dobladillo
  const loop = [];
  for (let i = 0; i < nu; i++) loop.push(id(i, 0));
  for (let j = 1; j < nv; j++) loop.push(id(nu - 1, j));
  for (let i = nu - 2; i >= 0; i--) loop.push(id(i, nv - 1));
  for (let j = nv - 2; j >= 1; j--) loop.push(id(0, j));
  const base = nu * nv;
  const pos = new Float32Array((base + loop.length) * 3);
  pos.set(P);
  loop.forEach((k, m) => {
    for (let c = 0; c < 3; c++) pos[(base + m) * 3 + c] = P[k * 3 + c] - N[k * 3 + c] * th;
  });
  const idx = [];
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const p0 = id(i, j), p1 = id(i + 1, j), p2 = id(i, j + 1), p3 = id(i + 1, j + 1);
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  for (let m = 0; m < loop.length; m++) {
    const m1 = (m + 1) % loop.length;
    const t0 = loop[m], t1 = loop[m1], h0 = base + m, h1 = base + m1;
    idx.push(t0, t1, h1, t0, h1, h0, t0, h1, t1, t0, h0, h1); // ambas caras del dobladillo
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Hoja (para plantas): eje +Y = largo (base en el origen), cara superior +Z, plegada en V y curvada.
let _leafGeo = null;
function leafGeo() {
  if (_leafGeo) return _leafGeo;
  const nL = 7, cols = [-1, -0.5, 0, 0.5, 1], pos = [], idx = [];
  for (let i = 0; i <= nL; i++) {
    const t = i / nL;
    const half = 0.21 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.75);
    for (const c of cols) pos.push(c * half, t, Math.abs(c) * half * 0.35 - 0.16 * t * t);
  }
  for (let i = 0; i < nL; i++) {
    for (let j = 0; j < 4; j++) {
      const a = i * 5 + j, b = a + 1, c = a + 5, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return (_leafGeo = g);
}

// ---------------------------------------------------------------------------
// Acumulador de piezas por material + AO por vértice
// ---------------------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a1 = V3(), _a2 = V3(), _a3 = V3(), _a4 = V3();

const AO_D = [0.012, 0.035, 0.07, 0.12, 0.2];
const AO_W = [0.3, 0.26, 0.2, 0.14, 0.1];
const AO_MAX = 0.22;

function sdPrim(pr, p) {
  _a4.copy(p).applyMatrix4(pr.inv);
  const qx = Math.abs(_a4.x) - (pr.hx - pr.r);
  const qy = Math.abs(_a4.y) - (pr.hy - pr.r);
  const qz = Math.abs(_a4.z) - (pr.hz - pr.r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - pr.r;
}

/** Acumula piezas por material y las fusiona en un mesh por material. */
class Parts {
  constructor() {
    this.map = new Map();
    this.prims = []; // cajas redondeadas que ocluyen (para la AO de las telas)
    this._prim = null;
    this._tint = null;
  }

  /** Color por pieza (multiplica al color del material) para materiales con vertexColors: así
   *  piezas de varios colores comparten un solo draw call. null = blanco. */
  tint(c) {
    this._tint = c == null ? null : c.isColor ? c : new THREE.Color(c);
    return this;
  }

  addM(geo, mat, m) {
    const g = geo.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.clearGroups();
    g.applyMatrix4(m);
    let pid = -1;
    if (this._prim) {
      pid = this._pushPrim(this._prim, m);
      this._prim = null;
    }
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push({ g, pid, tint: this._tint });
    return this;
  }

  _pushPrim({ hx, hy, hz, r }, m) {
    this.prims.push({
      inv: m.clone().invert(), hx, hy, hz, r,
      c: V3().setFromMatrixPosition(m), br: Math.hypot(hx, hy, hz) * m.getMaxScaleOnAxis(),
    });
    return this.prims.length - 1;
  }

  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    return this.addM(geo, mat, _m4.compose(_p, _q, _s));
  }

  /** Volumen invisible que solo oscurece (AO) a las telas cercanas. */
  occluder(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, r = 0) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(1, 1, 1);
    this._pushPrim({ hx: w / 2, hy: h / 2, hz: d / 2, r }, _m4.compose(_p, _q, _s));
    return this;
  }

  box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    this._prim = { hx: w / 2, hy: h / 2, hz: d / 2, r: 0 };
    return this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  }

  rbox(w, h, d, r, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 2) {
    const rr = Math.max(0.0005, Math.min(r, Math.min(w, h, d) / 2 - 0.0005));
    this._prim = { hx: w / 2, hy: h / 2, hz: d / 2, r: rr };
    return this.add(new RoundedBoxGeometry(w, h, d, seg, rr), mat, x, y, z, rx, ry, rz);
  }

  soft(w, h, d, r, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, opts = {}) {
    this._prim = { hx: w / 2, hy: h / 2, hz: d / 2, r: Math.min(r, Math.min(w, h, d) / 2) };
    return this.add(softBoxGeo(w, h, d, r, opts), mat, x, y, z, rx, ry, rz);
  }

  pillow(w, h, t, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 0.05) {
    this._prim = { hx: w / 2, hy: h / 2, hz: t * 0.38, r: t * 0.3 };
    return this.add(pillowGeo(w, h, t, seg), mat, x, y, z, rx, ry, rz);
  }

  cyl(rt, rb, h, mat, x, y, z, rx = 0, ry = 0, rz = 0, seg = 16) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, rx, ry, rz);
  }

  /** Oclusión ambiental falsa por vértice (gris lineal 0.25..1) en el atributo color. */
  _ao(g, pid, o, tint) {
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const col = new Float32Array(n * 3);
    const cand = [];
    const p = _a1, nn = _a2, q = _a3;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      nn.fromBufferAttribute(nor, i);
      let occ = 0;
      if (o.strength > 0) {
        cand.length = 0;
        for (let k = 0; k < this.prims.length; k++) {
          if (k === pid) continue;
          const pr = this.prims[k];
          if (p.distanceTo(pr.c) - pr.br < AO_MAX) cand.push(pr);
        }
        if (cand.length || (o.floor && p.y < AO_MAX)) {
          for (let s = 0; s < AO_D.length; s++) {
            const d = AO_D[s];
            q.copy(nn).multiplyScalar(d).add(p);
            let sd = o.floor ? q.y : 1e9;
            for (let k = 0; k < cand.length; k++) {
              const v = sdPrim(cand[k], q);
              if (v < sd) sd = v;
            }
            occ += AO_W[s] * clamp((d - sd) / d, 0, 1.5);
          }
        }
      }
      let a = 1 - o.strength * occ;
      if (o.height) a *= 1 - o.height * (1 - smooth(0, 0.45, p.y));
      if (o.fn) a *= o.fn(p, nn);
      a = clamp(a, 0.3, 1);
      col[3 * i] = tint ? a * tint.r : a;
      col[3 * i + 1] = tint ? a * tint.g : a;
      col[3 * i + 2] = tint ? a * tint.b : a;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  build(parent, { shadow = true, ao = {} } = {}) {
    const o = { floor: true, strength: 0.85, height: 0.12, fn: null, ...ao };
    for (const [mat, list] of this.map) {
      const geos = list.map(({ g, pid, tint }) => {
        if (mat.vertexColors) this._ao(g, pid, o, tint);
        return g.index ? g.toNonIndexed() : g;
      });
      let merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      const s = mat.userData.uvScale;
      if (s) merged = applyWorldUV(merged, s[0], s[1], !!mat.userData.uvSwapY);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      const solid = !mat.transparent && !mat.userData.noShadow;
      mesh.castShadow = shadow && solid;
      mesh.receiveShadow = shadow && !mat.transparent;
      parent.add(mesh);
    }
    this.map.clear();
    this.prims.length = 0;
    this._tint = null;
    return parent;
  }
}

function newRoot(name, w, d, h) {
  const g = new THREE.Group();
  g.name = name;
  g.userData.size = { w, d, h };
  return g;
}

// ---------------------------------------------------------------------------
// Texturas procedurales (canvas, compartidas)
// ---------------------------------------------------------------------------

const HAS_DOM = typeof document !== 'undefined';

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makeTex(w, h, draw) {
  if (!HAS_DOM) return null;
  const [c, ctx] = canvas2d(w, h);
  draw(ctx, w, h);
  return toTex(c, true);
}

function lumOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
  return H;
}

/** Normal map tileable a partir de una altura (Float32Array w*h). */
function normalTex(H, w, h, k) {
  if (!HAS_DOM) return null;
  const [c, ctx] = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H[y * w + ((x + 1) % w)] - H[y * w + ((x - 1 + w) % w)]) * k;
      const dy = (H[((y + 1) % h) * w + x] - H[((y - 1 + h) % h) * w + x]) * k;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTex(c, false);
}

/** Dibuja color + deriva normal de la luminancia. */
function texPair(w, h, draw, k) {
  if (!HAS_DOM) return [null, null];
  const [c, ctx] = canvas2d(w, h);
  draw(ctx, w, h);
  return [toTex(c, true), normalTex(lumOf(ctx, w, h), w, h, k)];
}

// Roble natural claro (promedio ~#b48c63), chapa en 4 hojas de ~20 cm con leve variación de tono,
// veta lineal y algunas "catedrales". La textura cubre 0.8 x 1.6 m.
function drawOak(ctx, w, h) {
  const r = rng(7);
  const leaves = 4, lw = w / leaves;
  const tones = [[189, 149, 106], [180, 139, 97], [187, 147, 104], [183, 142, 100]];
  const wavyLine = (x0, amp, k, ph, lwid, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lwid;
    ctx.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin((y / h) * Math.PI * 2 * k + ph) * amp + Math.sin((y / h) * Math.PI * 6 + ph * 2) * amp * 0.25;
      if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  for (let k = 0; k < leaves; k++) {
    const x0 = k * lw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, lw, h);
    ctx.clip();
    const [R, G, B] = tones[k];
    ctx.fillStyle = `rgb(${R},${G},${B})`;
    ctx.fillRect(x0, 0, lw, h);
    // bandas tonales suaves
    for (let i = 0; i < 9; i++) {
      const light = r() < 0.5;
      wavyLine(x0 + r() * lw, 1 + r() * 3, 1, r() * 6.3, 5 + r() * 16,
        light ? `rgba(214,184,142,${0.06 + r() * 0.08})` : `rgba(128,94,62,${0.05 + r() * 0.07})`);
    }
    // catedrales (corte plano) en hojas alternas
    if (k % 2 === 1) {
      const cx = x0 + lw * (0.35 + r() * 0.3);
      const peak = r() * h;
      ctx.lineCap = 'round';
      for (let j = 0; j < 12; j++) {
        const spread = 4 + j * 4.5;
        const y0 = peak + j * 11;
        ctx.strokeStyle = `rgba(112,80,50,${0.08 + r() * 0.12})`;
        ctx.lineWidth = 0.7 + r() * 1.3;
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          for (let s = -1; s <= 1; s += 2) {
            const pts = [];
            for (let y = y0; y <= y0 + h * 0.7; y += 6) {
              const t = Math.sqrt((y - y0) / (h * 0.22));
              pts.push([cx + s * spread * Math.min(t, 2.4) + Math.sin(y * 0.05 + j) * 1.2, y + oy]);
            }
            if (s < 0) pts.reverse();
            pts.forEach(([px, py], i) => (i === 0 && s < 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
          }
          ctx.stroke();
        }
      }
    }
    // veta fina recta
    for (let i = 0; i < 80; i++) {
      const dark = r() < 0.75;
      wavyLine(x0 + r() * lw, 0.4 + r() * 1.6, 1 + Math.floor(r() * 2), r() * 6.3, 0.5 + r() * 1.2,
        dark ? `rgba(98,68,40,${0.05 + r() * 0.14})` : `rgba(220,190,150,${0.04 + r() * 0.08})`);
    }
    // poros
    ctx.fillStyle = 'rgba(86,58,34,0.16)';
    for (let i = 0; i < 260; i++) ctx.fillRect(x0 + r() * lw, r() * h, 0.8, 2 + r() * 7);
    // junta entre hojas de chapa
    ctx.fillStyle = 'rgba(120,88,58,0.18)';
    ctx.fillRect(x0, 0, 1, h);
    ctx.restore();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 7;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function drawMarble(ctx, w, h) {
  // una baldosa de 60x30 cm
  const r = rng(11);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f6f5f2');
  g.addColorStop(1, '#eeede9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 90;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(205,205,208,${0.05 + r() * 0.06})`);
    rg.addColorStop(1, 'rgba(205,205,208,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const base = -0.45 + (r() - 0.5) * 0.4;
  const vein = (x, y, ang, steps, lw, alpha) => {
    const pts = [];
    for (let s = 0; s < steps; s++) {
      pts.push([x, y]);
      ang += (r() - 0.5) * 0.55;
      ang += (base - ang) * 0.08;
      x += Math.cos(ang) * 9;
      y += Math.sin(ang) * 9;
    }
    const path = () => {
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    };
    ctx.shadowColor = 'rgba(130,130,136,0.45)';
    ctx.shadowBlur = 7;
    ctx.strokeStyle = `rgba(160,160,166,${alpha * 0.6})`;
    ctx.lineWidth = lw * 2.2;
    path(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(128,128,136,${alpha})`;
    ctx.lineWidth = lw * 0.5;
    path(); ctx.stroke();
    return pts;
  };
  for (let v = 0; v < 6; v++) {
    const pts = vein(r() * w * 0.4 - 60, r() * h * 1.3, base + (r() - 0.5) * 0.5, 70, 0.8 + r() * 1.6, 0.22 + r() * 0.25);
    const k = Math.floor(r() * pts.length);
    vein(pts[k][0], pts[k][1], base + (r() < 0.5 ? 0.7 : -0.7), 18, 0.6, 0.2);
  }
  // junta
  ctx.strokeStyle = 'rgba(206,204,199,0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

// Cuarzo blanco cálido con grano fino. Cubre 0.5 x 0.5 m.
function drawQuartz(ctx, w, h) {
  const r = rng(17);
  ctx.fillStyle = '#f0ece4';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = r() * w, y = r() * h, rad = 10 + r() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(226,220,208,${0.15 + r() * 0.2})`);
    g.addColorStop(1, 'rgba(226,220,208,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 1400; i++) {
    const t = r();
    ctx.fillStyle = t < 0.5 ? `rgba(170,162,150,${0.15 + r() * 0.25})` : t < 0.8 ? `rgba(206,192,168,${0.2 + r() * 0.3})` : 'rgba(255,255,255,0.6)';
    const s = 0.6 + r() * 1.2;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

function drawJute(ctx, w, h) {
  const r = rng(5);
  ctx.fillStyle = '#c4ad86';
  ctx.fillRect(0, 0, w, h);
  const cell = 8;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const odd = ((x + y) / cell) % 2 === 1;
      const l = (r() - 0.5) * 24;
      ctx.fillStyle = `rgb(${196 + l + (odd ? 8 : -10)},${174 + l + (odd ? 6 : -10)},${136 + l + (odd ? 4 : -10)})`;
      if (odd) ctx.fillRect(x + 0.5, y + 1.5, cell - 1, cell - 3);
      else ctx.fillRect(x + 1.5, y + 0.5, cell - 3, cell - 1);
    }
  }
  ctx.fillStyle = 'rgba(80,60,34,0.14)';
  for (let i = 0; i < 500; i++) ctx.fillRect(r() * w, r() * h, 1, 1);
}

// Tejido plano (trama/urdimbre) como altura: color casi blanco (se tiñe con material.color) + normal.
function weaveHeight(w, h, cell, seed) {
  const r = rng(seed);
  const nc = w / cell, nr = h / cell;
  const colV = Array.from({ length: nc }, () => 0.75 + r() * 0.5);
  const rowV = Array.from({ length: nr }, () => 0.75 + r() * 0.5);
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      const u = ((x % cell) + 0.5) / cell, v = ((y % cell) + 0.5) / cell;
      const a = Math.sin(Math.PI * u), b = Math.sin(Math.PI * v);
      H[y * w + x] = (((cx + cy) & 1) === 0 ? colV[cx] * a * (0.75 + 0.25 * b) : rowV[cy] * b * (0.75 + 0.25 * a))
        + (r() - 0.5) * 0.08;
    }
  }
  return H;
}

function weavePair() {
  if (!HAS_DOM) return [null, null];
  const w = 128, h = 128;
  const H = weaveHeight(w, h, 4, 3);
  const [c, ctx] = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  const r = rng(9);
  const blot = Array.from({ length: 16 }, () => (r() - 0.5) * 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = clamp(238 + H[i] * 14 + blot[((x >> 5) + (y >> 5) * 4) & 15], 0, 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return [toTex(c, true), normalTex(H, w, h, 1.6)];
}

// Acero inoxidable cepillado: rayas horizontales (color sutil + rugosidad variable).
function steelPair() {
  if (!HAS_DOM) return [null, null];
  const w = 256, h = 256;
  const r = rng(13);
  const row = new Float32Array(h);
  for (let y = 0; y < h; y++) row[y] = r() - 0.5;
  const [c1, x1] = canvas2d(w, h), [c2, x2] = canvas2d(w, h);
  const i1 = x1.createImageData(w, h), i2 = x2.createImageData(w, h);
  // rayas largas: ruido por fila + segmentos
  const seg = new Float32Array(w * h);
  for (let s = 0; s < 900; s++) {
    const y = Math.floor(r() * h), x0 = Math.floor(r() * w), len = 20 + r() * 160, v = (r() - 0.5) * 0.9;
    for (let x = 0; x < len; x++) seg[y * w + ((x0 + x) % w)] += v;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = clamp(row[y] * 0.7 + seg[i] * 0.5 + (r() - 0.5) * 0.15, -1, 1);
      const cv = 236 + v * 16;
      i1.data[i * 4] = cv; i1.data[i * 4 + 1] = cv; i1.data[i * 4 + 2] = cv + 2; i1.data[i * 4 + 3] = 255;
      const rv = (0.36 + v * 0.1) * 255;
      i2.data[i * 4] = rv; i2.data[i * 4 + 1] = rv; i2.data[i * 4 + 2] = rv; i2.data[i * 4 + 3] = 255;
    }
  }
  x1.putImageData(i1, 0, 0);
  x2.putImageData(i2, 0, 0);
  return [toTex(c1, true), toTex(c2, false)];
}

const [oakTex, oakNrm] = texPair(512, 512, drawOak, 5);
const marbleTex = makeTex(512, 256, drawMarble);
const quartzTex = makeTex(256, 256, drawQuartz);
const [juteTex, juteNrm] = texPair(256, 256, drawJute, 7);
const [weaveTex, weaveNrm] = weavePair();
const [steelTex, steelRough] = steelPair();

// ---------------------------------------------------------------------------
// Materiales compartidos
// ---------------------------------------------------------------------------

const std = (o) => new THREE.MeshStandardMaterial(o);
const OAK_AVG = new THREE.Color(0xb48c63);
const WOOD_UV = [1 / 0.8, 1 / 1.6];

function wood(tint, roughness) {
  const color = new THREE.Color(tint);
  if (!oakTex) color.multiply(OAK_AVG);
  const m = std({ color, map: oakTex, normalMap: oakNrm, normalScale: V2(0.3, 0.3), roughness, metalness: 0 });
  m.userData.uvScale = WOOD_UV;
  m.userData.uvSwapY = true;
  return m;
}

function fabric(hex, scale = 0.12, nScale = 0.55, extra = {}) {
  const m = std({
    color: hex, map: weaveTex, normalMap: weaveNrm, normalScale: V2(nScale, nScale),
    roughness: 0.93, metalness: 0, vertexColors: true, ...extra,
  });
  m.userData.uvScale = [1 / scale, 1 / scale];
  return m;
}

function steelMat(color, roughness) {
  const m = std({
    color, map: steelTex, roughnessMap: steelRough, metalness: 1,
    roughness: steelRough ? 1 : roughness,
  });
  m.userData.uvScale = [1 / 0.3, 1 / 0.3];
  return m;
}

const quartzMat = std({ color: 0xffffff, map: quartzTex, roughness: 0.26, metalness: 0 });
if (!quartzTex) quartzMat.color.set(0xf0ece4);
quartzMat.userData.uvScale = [2, 2];

const marbleMat = std({ color: marbleTex ? 0xffffff : 0xf3f2ef, map: marbleTex, roughness: 0.16, metalness: 0 });
marbleMat.userData.uvScale = [1 / 0.6, 1 / 0.3];

const juteMat = std({ color: juteTex ? 0xffffff : 0xc4ad86, map: juteTex, normalMap: juteNrm, normalScale: V2(0.9, 0.9), roughness: 1, metalness: 0 });
juteMat.userData.uvScale = [1 / 0.4, 1 / 0.4];

export const materials = {
  oak: wood(0xffffff, 0.6), // roble natural de cocina, closet y puertas
  warmWood: wood(0xd8bfa2, 0.55), // madera algo más tostada para mesas y patas
  oakShade: wood(0xcfc5bb, 0.65), // interior de closet (un poco más oscuro)
  quartz: quartzMat,
  marble: marbleMat,
  black: std({ color: 0x1a1a1b, roughness: 0.5, metalness: 0 }),
  blackGlass: std({ color: 0x050506, roughness: 0.05, metalness: 0 }),
  steel: steelMat(0xc8ccd0, 0.35),
  chrome: std({ color: 0xeef0f2, roughness: 0.12, metalness: 1 }),
  aluminum: std({ color: 0xd4d7da, roughness: 0.38, metalness: 0.75 }),
  glass: std({
    color: 0xe4f0ec, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.14,
    depthWrite: false, side: THREE.DoubleSide,
  }),
  doorGlass: std({
    color: 0x1b2226, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.62,
    depthWrite: false, side: THREE.DoubleSide,
  }),
  mirror: std({ color: 0xe8edf0, roughness: 0.02, metalness: 1 }),
  white: std({ color: 0xf8f8f6, roughness: 0.08, metalness: 0 }), // porcelana esmaltada
  whiteSoft: std({ color: 0xf3f3f0, roughness: 0.3, metalness: 0 }), // plástico (asiento, tapa, liner)
  whiteMatte: std({ color: 0xebe9e4, roughness: 0.8, metalness: 0 }), // melamina interior
  plastic: std({ color: 0xf4f3ef, roughness: 0.38, metalness: 0 }), // tomas, interruptores, citófono
  plasticGray: std({ color: 0xb9b9b6, roughness: 0.4, metalness: 0 }),
  plasticVC: std({ color: 0xf4f3ef, roughness: 0.38, metalness: 0, vertexColors: true }), // ídem, teñible por pieza
  paint: std({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true }), // cerámica/objetos teñibles por pieza
  appliance: std({ color: 0xf5f5f3, roughness: 0.26, metalness: 0 }), // esmalte blanco lavadora
  plinth: std({ color: 0x2c2a28, roughness: 0.85, metalness: 0 }), // zócalo
  groove: std({ color: 0x3a2818, roughness: 0.9, metalness: 0 }), // ranuras de puertas
  gap: std({ color: 0x141312, roughness: 1, metalness: 0 }), // juntas de sombra y zócalos
  cookRing: std({ color: 0x8e8e8e, roughness: 0.35, metalness: 0 }), // serigrafía de inducción
  rubber: std({ color: 0x2b2c2e, roughness: 0.85, metalness: 0 }),
  screen: std({ color: 0x050607, roughness: 0.06, metalness: 0 }),
  led: std({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 1.6, roughness: 0.4 }),
  fabricCream: fabric(0xe9e2d4, 0.12, 0.6),
  fabricSage: fabric(0x66744f, 0.12, 0.6),
  fabricGray: fabric(0x78777a, 0.1, 0.55),
  bedding: fabric(0xf6f4ef, 0.05, 0.35),
  towel: fabric(0xf2efe8, 0.025, 1.0),
  linen: std({ color: 0xefe8da, map: weaveTex, roughness: 1, emissive: 0x2a2418, side: THREE.DoubleSide }),
  jute: juteMat,
  pot: std({ color: 0xdcd5c9, roughness: 0.55, metalness: 0 }),
  soil: std({ color: 0x3b2e24, roughness: 1 }),
  stem: std({ color: 0x4d5a31, roughness: 0.8 }),
  leaf: std({ color: 0x47663a, roughness: 0.5, side: THREE.DoubleSide, vertexColors: true }),
  leafDark: std({ color: 0x34512b, roughness: 0.5, side: THREE.DoubleSide, vertexColors: true }),
  clothes: [0x8a8f96, 0xd8d2c4, 0x3d4a5c, 0x6e7b5a, 0xb9a48a, 0x2f2f33].map((c) => fabric(c, 0.1, 0.5)),
  clothesMix: fabric(0xffffff, 0.1, 0.5), // un solo material para toda la ropa (color por pieza)
};
const CLOTHES = [0x8a8f96, 0xd8d2c4, 0x3d4a5c, 0x6e7b5a, 0xb9a48a, 0x2f2f33, 0xe9e2d4];
const M = materials;
M.linen.userData.uvScale = [1 / 0.08, 1 / 0.08];
M.jute.userData.noShadow = true;
M.led.userData.noShadow = true;

// ---------------------------------------------------------------------------
// Piezas reutilizables
// ---------------------------------------------------------------------------

/** Tirador de barra redonda con dos patas (standoffs). z = cara frontal donde se monta. */
function barHandle(P, len, x, y, z, vertical = true, mat = M.steel) {
  const off = 0.028, br = 0.006, so = 0.0045, inset = Math.min(0.03, len * 0.18);
  if (vertical) {
    P.cyl(br, br, len, mat, x, y, z + off, 0, 0, 0, 12);
    for (const s of [-1, 1]) P.cyl(so, so, off, mat, x, y + s * (len / 2 - inset), z + off / 2, Math.PI / 2, 0, 0, 10);
  } else {
    P.cyl(br, br, len, mat, x, y, z + off, 0, 0, Math.PI / 2, 12);
    for (const s of [-1, 1]) P.cyl(so, so, off, mat, x + s * (len / 2 - inset), y, z + off / 2, Math.PI / 2, 0, 0, 10);
  }
}

/** Puerta de gabinete con bisagra. zBack = plano trasero de la hoja (frente del casco). */
function hingedDoor(parent, { x0, x1, y0, y1, zBack, t = T, hinge = 'left', angle = 85, mat = M.oak, // <90°: no choca con la nevera ni la pared
  handleLen = 0.16, handleY, label = 'Abrir gabinete', labelOpen = 'Cerrar gabinete', dur = 0.8 }) {
  const w = x1 - x0, h = y1 - y0;
  const dir = hinge === 'left' ? 1 : -1;
  const pivot = new THREE.Group();
  pivot.position.set(hinge === 'left' ? x0 : x1, 0, zBack);
  parent.add(pivot);
  const P = new Parts();
  P.rbox(w, h, t, 0.002, mat, (dir * w) / 2, (y0 + y1) / 2, t / 2, 0, 0, 0, 1);
  if (handleLen) barHandle(P, handleLen, dir * (w - 0.035), handleY ?? y1 - handleLen / 2 - 0.05, t, true);
  P.build(pivot);
  const target = -dir * angle * DEG;
  makeInteractive(pivot, { label, labelOpen, onToggle: (open) => tween(pivot, 'rotation.y', open ? target : 0, dur) });
  return pivot;
}

/** Cajón: frente + caja. zFace = cara frontal del frente cerrado. Sale en +Z. handleLen 0 = sin tirador. */
function drawer(parent, { x, y0, y1, w, zFace, t = T, bodyW, bodyD, mat = M.oak, handleLen = 0.2,
  dist = 0.35, label = 'Abrir cajón', labelOpen = 'Cerrar cajón' }) {
  const g = new THREE.Group();
  g.position.set(x, 0, zFace);
  parent.add(g);
  const P = new Parts();
  const h = y1 - y0;
  P.rbox(w, h, t, 0.002, mat, 0, (y0 + y1) / 2, -t / 2, 0, 0, 0, 1);
  const st = 0.012;
  const bh = Math.max(0.05, h - 0.07);
  const by0 = y0 + 0.02;
  const bz = -t - bodyD / 2;
  P.box(st, bh, bodyD, mat, -bodyW / 2 + st / 2, by0 + bh / 2, bz);
  P.box(st, bh, bodyD, mat, bodyW / 2 - st / 2, by0 + bh / 2, bz);
  P.box(bodyW - 2 * st, st, bodyD, mat, 0, by0 + st / 2, bz);
  P.box(bodyW - 2 * st, bh, st, mat, 0, by0 + bh / 2, -t - bodyD + st / 2);
  P.box(bodyW - 2 * st, bh * 0.8, st, mat, 0, by0 + bh * 0.4, -t - st / 2 - 0.002);
  if (handleLen) barHandle(P, handleLen, 0, y1 - 0.045, 0, false);
  P.build(g);
  g.userData.isOpen = false;
  makeInteractive(g, {
    label, labelOpen,
    onToggle: (open) => {
      g.userData.isOpen = open;
      tween(g, 'position.z', zFace + (open ? dist : 0), 0.6);
    },
  });
  return g;
}

/** Marco de hoja corrediza (perfil + vidrio) centrado en (x, y, z). */
function sash(P, w, h, x, y, z, p = 0.045, d = 0.035) {
  const rr = 0.003;
  P.rbox(w, p, d, rr, M.aluminum, x, y + h / 2 - p / 2, z, 0, 0, 0, 1);
  P.rbox(w, p, d, rr, M.aluminum, x, y - h / 2 + p / 2, z, 0, 0, 0, 1);
  P.rbox(p, h - 2 * p + 0.002, d, rr, M.aluminum, x - w / 2 + p / 2, y, z, 0, 0, 0, 1);
  P.rbox(p, h - 2 * p + 0.002, d, rr, M.aluminum, x + w / 2 - p / 2, y, z, 0, 0, 0, 1);
  P.box(w - 2 * p + 0.01, h - 2 * p + 0.01, 0.006, M.glass, x, y, z);
}

function roundRectPath(p, cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}

/** Pieza plana (RingGeometry, PlaneGeometry, CircleGeometry) acostada mirando a +Y. */
function flatY(P, geo, mat, x, y, z, rot = 0) {
  return P.add(geo, mat, x, y, z, -Math.PI / 2, 0, rot);
}

// ---------------------------------------------------------------------------
// 1. Cocina lineal
// ---------------------------------------------------------------------------

function splitDoors(a, b) {
  const w = b - a;
  if (w <= 0.9) return [{ a, b, type: 'doors' }];
  const n = Math.ceil(w / 0.8);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ a: a + (w * i) / n, b: a + (w * (i + 1)) / n, type: 'doors' });
  return out;
}

function splitAround(a, b, f) {
  const CORE = 0.8;
  if (b - a <= 0.9) return [{ a, b, type: f.type }];
  let ca = Math.max(a, f.x - CORE / 2);
  let cb = Math.min(b, ca + CORE);
  ca = Math.max(a, cb - CORE);
  const head = [], tail = [];
  if (ca - a < 0.15) ca = a; else head.push(...splitDoors(a, ca));
  if (b - cb < 0.15) cb = b; else tail.push(...splitDoors(cb, b));
  return [...head, { a: ca, b: cb, type: f.type }, ...tail];
}

function layoutModules(x0, x1, fixtures) {
  const fx = fixtures.filter((f) => Number.isFinite(f.x)).sort((p, q) => p.x - q.x);
  if (!fx.length) return splitDoors(x0, x1);
  const out = [];
  for (let i = 0; i < fx.length; i++) {
    const a = i === 0 ? x0 : (fx[i - 1].x + fx[i].x) / 2;
    const b = i === fx.length - 1 ? x1 : (fx[i].x + fx[i + 1].x) / 2;
    out.push(...splitAround(a, b, fx[i]));
  }
  return out;
}

/**
 * Cocina lineal. Como en el video, los frentes son sin tirador (juntas de sombra y puertas altas
 * que sobresalen 18 mm por debajo para abrir); handles: true pone tiradores de barra.
 */
export function kitchenRun({ length = 1.55, sinkAt = 0.30, cooktopAt = 0.75, handles = false } = {}) {
  const L = length;
  const root = newRoot('kitchenRun', L, 0.6, 2.2);
  const S = new Parts();
  const x0 = -L / 2, x1 = L / 2;
  const zB = -0.30;
  const yK = 0.10; // zócalo
  const yTop = 0.87; // casco bajo el cuarzo
  const zCF = 0.262; // frente del casco (frentes de 18 mm -> cara a 0.28)
  const GK = 0.004; // media junta horizontal entre cajones
  const sinkX = sinkAt == null ? NaN : x0 + sinkAt * L;
  const cookX = cooktopAt == null ? NaN : x0 + cooktopAt * L;
  const mods = layoutModules(x0, x1, [{ x: sinkX, type: 'sink' }, { x: cookX, type: 'cook' }]);
  const sideD = zCF - zB;
  const sideH = yTop - yK;

  // --- muebles bajos
  for (const m of mods) {
    const w = m.b - m.a, cx = (m.a + m.b) / 2;
    const endL = Math.abs(m.a - x0) < 1e-6, endR = Math.abs(m.b - x1) < 1e-6;
    for (const [isEnd, xs] of [[endL, m.a + T / 2], [endR, m.b - T / 2]]) {
      if (isEnd) S.box(T, yTop, sideD, M.oak, xs, yTop / 2, zB + sideD / 2);
      else {
        S.box(T, sideH, sideD - 0.003, M.whiteMatte, xs, yK + sideH / 2, zB + (sideD - 0.003) / 2);
        S.box(T, sideH, 0.002, M.gap, xs, yK + sideH / 2, zCF - 0.002); // canto oscuro visto por la junta
      }
    }
    S.box(w - 2 * T, T, sideD, M.whiteMatte, cx, yK + T / 2, zB + sideD / 2);
    S.box(w - 2 * T, sideH, 0.006, M.whiteMatte, cx, yK + sideH / 2, zB + 0.003);
    const pl = (endL ? T : 0), pr = (endR ? T : 0);
    S.box(w - pl - pr, yK, 0.016, M.gap, cx + (pl - pr) / 2, yK / 2, zCF - 0.06);
    S.box(w - 2 * T, 0.014, 0.014, M.gap, cx, yTop - 0.007, zCF - 0.008); // travesaño bajo el cuarzo
    if (m.type === 'doors') S.box(w - 2 * T, T, sideD - 0.05, M.whiteMatte, cx, yK + sideH * 0.5, zB + 0.006 + (sideD - 0.05) / 2);

    if (m.type === 'cook') {
      const fr = [0.39, 0.35, 0.26];
      let yy = yK;
      fr.forEach((f, k) => {
        const h = sideH * f;
        drawer(root, {
          x: cx, y0: yy + (k === 0 ? GAP : GK), y1: yy + h - GK, w: w - GAP, zFace: zCF + T,
          bodyW: w - 2 * T - 0.026, bodyD: sideD - 0.07, handleLen: handles ? Math.min(0.32, w * 0.45) : 0,
        });
        if (k > 0) S.box(w - 2 * T, 0.012, 0.012, M.gap, cx, yy, zCF - 0.007);
        yy += h;
      });
    } else {
      const n = w > 0.55 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const hinge = n === 2 ? (i === 0 ? 'left' : 'right') : (cx < 0 ? 'left' : 'right');
        hingedDoor(root, {
          x0: m.a + (i * w) / n + GAP / 2, x1: m.a + ((i + 1) * w) / n - GAP / 2,
          y0: yK + GAP, y1: yTop - GK, zBack: zCF, hinge, handleY: yTop - 0.13, handleLen: handles ? 0.16 : 0,
        });
      }
    }
  }

  // --- cubierta de cuarzo con hueco para poceta bajo cubierta
  const sinkMod = mods.find((m) => m.type === 'sink');
  const bw = sinkMod ? Math.min(0.46, sinkMod.b - sinkMod.a - 0.1) : 0;
  const bd = 0.38, bz = 0.0, rr = 0.03;
  const hasSink = sinkMod && bw > 0.2;
  const shape = new THREE.Shape();
  shape.moveTo(x0, -0.3); shape.lineTo(x1, -0.3); shape.lineTo(x1, 0.3); shape.lineTo(x0, 0.3); shape.closePath();
  if (hasSink) shape.holes.push(roundRectPath(new THREE.Path(), sinkX, -bz, bw, bd, rr));
  const top = new THREE.ExtrudeGeometry(shape, {
    depth: 0.024, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6,
  });
  S.add(top, M.quartz, 0, 0.873, 0, -Math.PI / 2, 0, 0);

  // --- salpicadero de mármol
  S.box(L, 1.5 - 0.9, 0.01, M.marble, 0, 1.2, zB + 0.005);

  // --- poceta de acero cepillado bajo cubierta, desagüe y grifo cuello de cisne
  if (hasSink) {
    const dep = 0.19, wt = 0.006, yRim = 0.873, yb0 = yRim - dep;
    const ring = roundRectPath(new THREE.Shape(), sinkX, -bz, bw + 2 * wt, bd + 2 * wt, rr + wt);
    ring.holes.push(roundRectPath(new THREE.Path(), sinkX, -bz, bw, bd, rr));
    S.add(new THREE.ExtrudeGeometry(ring, { depth: dep, bevelEnabled: false, curveSegments: 6 }), M.steel, 0, yb0, 0, -Math.PI / 2, 0, 0);
    const floor = roundRectPath(new THREE.Shape(), sinkX, -bz, bw + 2 * wt, bd + 2 * wt, rr + wt);
    S.add(new THREE.ExtrudeGeometry(floor, { depth: 0.004, bevelEnabled: false, curveSegments: 6 }), M.steel, 0, yb0 - 0.004, 0, -Math.PI / 2, 0, 0);
    const dz = bz + 0.06;
    flatY(S, new THREE.RingGeometry(0.03, 0.043, 32), M.chrome, sinkX, yb0 + 0.0008, dz);
    flatY(S, new THREE.CircleGeometry(0.03, 24), M.steel, sinkX, yb0 + 0.0004, dz);
    flatY(S, new THREE.CircleGeometry(0.011, 16), M.gap, sinkX, yb0 + 0.0009, dz);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      flatY(S, new THREE.PlaneGeometry(0.009, 0.0022), M.gap, sinkX + Math.cos(a) * 0.02, yb0 + 0.0009, dz + Math.sin(a) * 0.02, -a);
    }
    // grifo
    const fx = sinkX, fz = bz - bd / 2 - 0.055, fy0 = 0.9;
    S.cyl(0.026, 0.028, 0.01, M.chrome, fx, fy0 + 0.005, fz, 0, 0, 0, 24);
    S.cyl(0.02, 0.021, 0.12, M.chrome, fx, fy0 + 0.07, fz, 0, 0, 0, 20);
    S.add(new THREE.SphereGeometry(0.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome, fx, fy0 + 0.13, fz);
    // palanca lateral
    S.cyl(0.009, 0.009, 0.026, M.chrome, fx + 0.026, fy0 + 0.1, fz, 0, 0, Math.PI / 2, 12);
    S.rbox(0.011, 0.075, 0.013, 0.005, M.chrome, fx + 0.04, fy0 + 0.135, fz, 0, 0, -0.35, 2);
    // cuello de cisne
    const H0 = fy0 + 0.125, H1 = fy0 + 0.34, R = 0.085;
    const pts = [];
    for (let i = 0; i <= 5; i++) pts.push(V3(fx, H0 + ((H1 - H0) * i) / 5, fz));
    for (let i = 1; i <= 14; i++) {
      const a = (Math.PI * i) / 14;
      pts.push(V3(fx, H1 + R * Math.sin(a), fz + R - R * Math.cos(a)));
    }
    for (let i = 1; i <= 2; i++) pts.push(V3(fx, H1 - (0.045 * i) / 2, fz + 2 * R));
    S.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0105, 12), M.chrome);
    S.cyl(0.0125, 0.0125, 0.02, M.chrome, fx, H1 - 0.045 - 0.008, fz + 2 * R, 0, 0, 0, 16);
    S.add(new THREE.CircleGeometry(0.009, 12), M.gap, fx, H1 - 0.045 - 0.0181, fz + 2 * R, Math.PI / 2, 0, 0);
  }

  // --- cubierta de inducción (2 zonas) en vidrio negro
  const cookMod = mods.find((m) => m.type === 'cook');
  if (cookMod) {
    const cw = Math.min(0.59, cookMod.b - cookMod.a - 0.06), cd = 0.52, gy = 0.9 + 0.003;
    S.rbox(cw, 0.006, cd, 0.0025, M.blackGlass, cookX, gy, 0, 0, 0, 0, 1);
    const ty = gy + 0.0034;
    for (const s of [-1, 1]) {
      const zx = cookX + (s * cw) / 4, zz = -0.035, R1 = s < 0 ? 0.1 : 0.085;
      flatY(S, new THREE.RingGeometry(R1 - 0.0022, R1, 64), M.cookRing, zx, ty, zz);
      flatY(S, new THREE.RingGeometry(R1 * 0.6 - 0.0015, R1 * 0.6, 48), M.cookRing, zx, ty, zz);
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        flatY(S, new THREE.PlaneGeometry(0.012, 0.0015), M.cookRing, zx + Math.cos(a) * (R1 + 0.01), ty, zz + Math.sin(a) * (R1 + 0.01), -a);
      }
    }
    // panel táctil: encendido, zonas, deslizador
    const cz = cd / 2 - 0.04;
    flatY(S, new THREE.RingGeometry(0.0062, 0.0078, 20, 1, Math.PI / 2 + 0.6, Math.PI * 2 - 1.2), M.cookRing, cookX - 0.2, ty, cz);
    flatY(S, new THREE.PlaneGeometry(0.0016, 0.008), M.cookRing, cookX - 0.2, ty, cz - 0.004);
    for (let k = 0; k < 3; k++) flatY(S, new THREE.RingGeometry(0.0055, 0.007, 20), M.cookRing, cookX - 0.13 + k * 0.04, ty, cz);
    flatY(S, new THREE.PlaneGeometry(0.13, 0.0022), M.cookRing, cookX + 0.1, ty, cz);
    for (let k = 0; k < 5; k++) flatY(S, new THREE.PlaneGeometry(0.0014, 0.006), M.cookRing, cookX + 0.04 + k * 0.03, ty, cz + 0.007);
  }

  // --- muebles altos (1.50 a 2.20, fondo 0.35)
  const yU0 = 1.5, yU1 = 2.2, zUF = zB + 0.35 - T, uD = zUF - zB;
  for (const m of mods) {
    const w = m.b - m.a, cx = (m.a + m.b) / 2;
    const endL = Math.abs(m.a - x0) < 1e-6, endR = Math.abs(m.b - x1) < 1e-6;
    const isCook = m.type === 'cook';
    const yc0 = isCook ? 1.6 : yU0;
    for (const [isEnd, xs] of [[endL, m.a + T / 2], [endR, m.b - T / 2]]) {
      if (isEnd) S.box(T, yU1 - yU0, uD, M.oak, xs, (yU0 + yU1) / 2, zB + uD / 2);
      else {
        S.box(T, yU1 - yU0, uD - 0.003, M.whiteMatte, xs, (yU0 + yU1) / 2, zB + (uD - 0.003) / 2);
        S.box(T, yU1 - yU0, 0.002, M.gap, xs, (yU0 + yU1) / 2, zUF - 0.002);
      }
    }
    S.box(w - 2 * T, T, uD, M.oak, cx, yc0 + T / 2, zB + uD / 2); // fondo inferior visible
    S.box(w - 2 * T, T, uD, M.whiteMatte, cx, yU1 - T / 2, zB + uD / 2);
    S.box(w - 2 * T, yU1 - yc0 - 2 * T, 0.006, M.whiteMatte, cx, (yc0 + yU1) / 2, zB + 0.003);
    S.box(w - 2 * T, T, uD - 0.03, M.whiteMatte, cx, (yc0 + yU1) / 2, zB + 0.006 + (uD - 0.03) / 2);
    const n = w > 0.55 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const hinge = n === 2 ? (i === 0 ? 'left' : 'right') : (cx < 0 ? 'left' : 'right');
      hingedDoor(root, {
        x0: m.a + (i * w) / n + GAP / 2, x1: m.a + ((i + 1) * w) / n - GAP / 2,
        y0: isCook ? yc0 + GAP : yc0 - 0.018, y1: yU1 - GAP, zBack: zUF, hinge,
        handleLen: handles ? 0.14 : 0, handleY: yc0 + 0.1,
      });
    }
    if (isCook) {
      // campana slim negra encajada bajo el mueble, frente de vidrio negro levemente inclinado
      const hw = w - 2 * T;
      const zFront = zUF + T;
      const bodyD = zFront - 0.03 - zB;
      S.rbox(hw, 0.09, bodyD, 0.004, M.blackGlass, cx, 1.553, zB + bodyD / 2, 0, 0, 0, 1);
      S.rbox(hw + 0.004, 0.1, 0.03, 0.004, M.blackGlass, cx, 1.551, zFront - 0.017, 0.08, 0, 0, 1);
      S.box(hw - 0.06, 0.002, bodyD - 0.08, M.steel, cx, 1.5075, zB + 0.03 + (bodyD - 0.08) / 2);
      for (let k = 0; k < 6; k++) S.box(hw - 0.08, 0.0006, 0.004, M.gap, cx, 1.5062, zB + 0.06 + k * 0.035);
      for (const s of [-1, 1]) S.cyl(0.02, 0.02, 0.002, M.led, cx + s * hw * 0.3, 1.5075, zFront - 0.075, 0, 0, 0, 16);
      // botones en el canto inferior del vidrio
      for (let k = 0; k < 3; k++) S.cyl(0.004, 0.004, 0.002, M.cookRing, cx + 0.12 + k * 0.022, 1.5015, zFront - 0.012, 0, 0, 0, 10);
    }
  }

  S.build(root);
  return root;
}

// ---------------------------------------------------------------------------
// 2. Closet con puertas corredizas
// ---------------------------------------------------------------------------

export function closet({ width = 1.35, depth = 0.6, height = 2.4, openSide = 'alternate' } = {}) {
  const W = width, D = depth, H = height;
  const root = newRoot('closet', W, D, H);
  const S = new Parts();
  const r = rng(21);
  const zb = -D / 2, zf = D / 2;
  const yb = 0.06;
  const zIn = zf - 0.1; // plano frontal del interior (detrás de las correderas)
  const inD = zIn - zb - 0.008;
  const inZ = zb + 0.008 + inD / 2;
  const xi0 = -W / 2 + T, xi1 = W / 2 - T, Wi = xi1 - xi0;

  // casco (exterior roble, interior un poco más oscuro)
  for (const s of [-1, 1]) S.box(T, H, D, M.oak, s * (W / 2 - T / 2), H / 2, 0);
  S.box(Wi, T, D, M.oak, 0, H - T / 2, 0);
  S.box(Wi, T, D - 0.02, M.oakShade, 0, yb + T / 2, -0.01);
  S.box(Wi, yb, T, M.gap, 0, yb / 2, zf - 0.045);
  S.box(Wi, H - yb - 2 * T, 0.008, M.oakShade, 0, (H + yb) / 2, zb + 0.004);

  // división
  const leftW = Math.min(0.55, Wi * 0.45);
  const xDiv = xi0 + leftW + T / 2;
  const yIn0 = yb + T, yIn1 = H - T;
  S.box(T, yIn1 - yIn0, inD, M.oakShade, xDiv, (yIn0 + yIn1) / 2, inZ);

  // lado izquierdo: cajones + entrepaños
  const lx0 = xi0, lx1 = xDiv - T / 2, lw = lx1 - lx0, lcx = (lx0 + lx1) / 2;
  const shelfTop = H - 0.38;
  const yDr = 0.8;
  for (const y of [yDr, 1.2, 1.6, shelfTop]) S.box(lw, T, inD, M.oakShade, lcx, y - T / 2, inZ);
  const drawers = [];
  const dh = (yDr - T - yIn0) / 3;
  for (let i = 0; i < 3; i++) {
    drawers.push(drawer(root, {
      x: lcx, y0: yIn0 + i * dh + 0.004, y1: yIn0 + (i + 1) * dh - 0.004, w: lw - 2 * GAP, zFace: zIn,
      bodyW: lw - 0.03, bodyD: inD - T - 0.03, handleLen: 0, dist: 0.32,
    }));
  }
  // ropa doblada en entrepaños
  const pick = () => S.tint(CLOTHES[Math.floor(r() * 6)]) && M.clothesMix;
  const stack = (x, y, n) => {
    let yy = y;
    for (let k = 0; k < n; k++) {
      const hh = 0.032 + r() * 0.014;
      S.soft(0.27 + r() * 0.03, hh, 0.3, 0.012, pick(), x + (r() - 0.5) * 0.015, yy + hh / 2, inZ + 0.04, 0, (r() - 0.5) * 0.06, 0,
        { seg: 0.1, band: 1, puff: 0.004, puffSide: 0.004 });
      yy += hh;
    }
  };
  if (lw > 0.34) {
    stack(lx0 + 0.17, 1.2, 4);
    if (lw > 0.62) stack(lx0 + 0.47, 1.2, 3);
    stack(lx0 + 0.17, 1.6, 3);
  }

  // lado derecho: entrepaño alto, barra y ropa colgada
  const rx0 = xDiv + T / 2, rx1 = xi1, rw = rx1 - rx0, rcx = (rx0 + rx1) / 2;
  S.box(rw, T, inD, M.oakShade, rcx, shelfTop - T / 2, inZ);
  const rodY = shelfTop - 0.07;
  S.cyl(0.0125, 0.0125, rw, M.chrome, rcx, rodY, inZ, 0, 0, Math.PI / 2, 14);
  for (const s of [-1, 1]) S.cyl(0.02, 0.02, 0.006, M.chrome, rcx + s * (rw / 2 - 0.003), rodY, inZ, 0, 0, Math.PI / 2, 14);
  const nC = Math.max(2, Math.min(9, Math.floor((rw - 0.12) / 0.07)));
  const span = (rw - 0.14) * 0.85;
  const hook = new THREE.TorusGeometry(0.017, 0.0018, 4, 10, Math.PI);
  for (let k = 0; k < nC; k++) {
    const x = rx0 + 0.07 + (span * k) / (nC - 1) + (r() - 0.5) * 0.02;
    const len = 0.55 + r() * 0.5;
    const th = 0.03 + r() * 0.03;
    const yTopC = rodY - 0.06;
    S.soft(th, len, 0.4 + r() * 0.04, Math.min(th * 0.45, 0.012), pick(), x, yTopC - len / 2, inZ, 0, (r() - 0.5) * 0.12, 0, {
      seg: 0.12, band: 1, puffSide: 0.006,
      deform: (v, hx, hy, hz) => { // hombros caídos
        if (v.y > 0) v.y -= 0.045 * (v.z / hz) ** 2 * smooth(hy - 0.12, hy, v.y);
      },
    });
    S.tint(null);
    S.rbox(0.009, 0.014, 0.42, 0.004, M.warmWood, x, rodY - 0.05, inZ, 0, 0, 0, 1);
    S.cyl(0.0018, 0.0018, 0.03, M.chrome, x, rodY - 0.028, inZ, 0, 0, 0, 6);
    S.add(hook, M.chrome, x, rodY, inZ, 0, Math.PI / 2, 0);
  }
  // cajas de guardado arriba
  if (rw > 0.4) {
    S.tint(CLOTHES[6]);
    S.soft(0.3, 0.2, 0.34, 0.012, M.clothesMix, rx0 + 0.18, shelfTop + 0.1, inZ, 0, 0, 0, { seg: 0.15, band: 1, puffSide: 0.003 });
    if (rw > 0.7) S.soft(0.3, 0.2, 0.34, 0.012, M.clothesMix, rx0 + 0.5, shelfTop + 0.1, inZ, 0, 0, 0, { seg: 0.15, band: 1, puffSide: 0.003 });
    S.tint(null);
  }

  // rieles
  S.rbox(Wi, 0.04, 0.075, 0.003, M.aluminum, 0, H - T - 0.02, zf - 0.0375, 0, 0, 0, 1);
  S.box(Wi, 0.008, 0.07, M.aluminum, 0, yb + T + 0.004, zf - 0.04);

  S.build(root);

  // puertas corredizas con tirador embutido (no choca al cruzarse)
  const dW = Wi / 2 + 0.015;
  const dy0 = yb + T + 0.01, dy1 = H - T - 0.012, dhh = dy1 - dy0;
  const xA = xi0 + dW / 2, xB = xi1 - dW / 2;
  const doors = new THREE.Group();
  root.add(doors);
  const mk = (x, z, handleSide) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const P = new Parts();
    P.rbox(dW, dhh, 0.018, 0.002, M.oak, 0, dy0 + dhh / 2, 0, 0, 0, 0, 1);
    const hx = handleSide * (dW / 2 - 0.045);
    P.rbox(0.026, 0.2, 0.0025, 0.001, M.steel, hx, 1.05, 0.0095, 0, 0, 0, 1);
    P.rbox(0.014, 0.18, 0.002, 0.0008, M.steel, hx, 1.05, 0.0112, 0, 0, 0, 1);
    P.build(g);
    doors.add(g);
    return g;
  };
  const doorA = mk(xA, zf - 0.055, -1); // riel trasero, cubre la izquierda
  const doorB = mk(xB, zf - 0.025, 1); // riel delantero, cubre la derecha
  let next = openSide === 'right' ? 'A' : 'B';
  makeInteractive(doors, {
    label: 'Abrir closet', labelOpen: 'Cerrar closet',
    onToggle: (open) => {
      if (open) {
        if (next === 'B') tween(doorB, 'position.x', xA, 1.0); // descubre la ropa colgada
        else tween(doorA, 'position.x', xB, 1.0); // descubre cajones y entrepaños
        if (openSide === 'alternate') next = next === 'B' ? 'A' : 'B';
      } else {
        tween(doorA, 'position.x', xA, 1.0);
        tween(doorB, 'position.x', xB, 1.0);
        for (const d of drawers) if (d.userData.isOpen) d.userData.toggle();
      }
    },
  });
  return root;
}

// ---------------------------------------------------------------------------
// 3. Puerta con marco
// ---------------------------------------------------------------------------

export function doorLeaf({ width = 0.85, height = 2.1, wallThickness = 0.15, style = 'oak', hinge = 'left', swing = 1 } = {}) {
  const W = width, H = height, t = wallThickness, s = swing >= 0 ? 1 : -1;
  const isBlack = style === 'black';
  const frameMat = isBlack ? M.black : M.oak;
  const leafMat = isBlack ? M.black : M.oak;
  const hwMat = isBlack ? M.black : M.steel;
  const root = newRoot('doorLeaf', W + 0.1, t + 0.024, H + 0.05);
  const F = new Parts();
  const J = 0.02;
  // forro del vano
  F.box(J, H, t, frameMat, -W / 2 + J / 2, H / 2, 0);
  F.box(J, H, t, frameMat, W / 2 - J / 2, H / 2, 0);
  F.box(W - 2 * J, J, t, frameMat, 0, H - J / 2, 0);
  // molduras (cantos redondeados) en ambas caras
  const cw = 0.07, ct = 0.012;
  for (const f of [-1, 1]) {
    const z = f * (t / 2 + ct / 2);
    const vh = H - J + cw;
    for (const sx of [-1, 1]) F.rbox(cw, vh, ct, 0.003, frameMat, sx * (W / 2 - J + cw / 2), vh / 2, z, 0, 0, 0, 1);
    F.rbox(W - 2 * J + 2 * cw, cw, ct, 0.003, frameMat, 0, H - J + cw / 2, z, 0, 0, 0, 1);
  }
  // tope
  const zs = s * (t / 2 - 0.005); // cara de la hoja hacia donde abre
  const lt = 0.04;
  const zStop = zs - s * (lt + 0.006);
  for (const sx of [-1, 1]) F.box(0.012, H - J, 0.012, frameMat, sx * (W / 2 - J - 0.006), (H - J) / 2, zStop);
  F.box(W - 2 * J, 0.012, 0.012, frameMat, 0, H - J - 0.006, zStop);

  // hoja
  const lw = W - 2 * J - 0.006, lh = H - J - 0.003 - 0.01, ly0 = 0.01;
  const dir = hinge === 'left' ? 1 : -1;
  const px = hinge === 'left' ? -(W / 2 - J) + 0.003 : W / 2 - J - 0.003;
  // bisagras: nudillo + aletas
  for (const y of [0.22, 1.05, lh - 0.22]) {
    F.cyl(0.0075, 0.0075, 0.1, hwMat, px - dir * 0.002, y, zs, 0, 0, 0, 12);
    for (const e of [-1, 1]) F.cyl(0.0085, 0.0085, 0.004, hwMat, px - dir * 0.002, y + e * 0.051, zs, 0, 0, 0, 12);
    F.box(0.012, 0.09, 0.002, hwMat, px - dir * 0.009, y, zs - s * 0.0005);
  }
  F.build(root);

  const pivot = new THREE.Group();
  pivot.position.set(px, 0, zs);
  root.add(pivot);
  const P = new Parts();
  const lcx = (dir * lw) / 2, lcz = (-s * lt) / 2;
  P.rbox(lw, lh, lt, 0.003, leafMat, lcx, ly0 + lh / 2, lcz, 0, 0, 0, 1);
  const hy = 0.92;
  if (!isBlack) {
    // dos ranuras horizontales a la altura de la manija (como en el video)
    for (const y of [0.8, 1.02]) P.box(lw + 0.0004, 0.004, lt + 0.0008, M.groove, lcx, y, lcz);
  } else {
    // mirilla
    P.cyl(0.009, 0.009, lt + 0.01, M.chrome, lcx, 1.52, lcz, Math.PI / 2, 0, 0, 12);
  }
  // manijas de palanca en ambas caras
  const hxl = dir * (lw - 0.065);
  const hyy = isBlack ? 1.0 : hy;
  for (const [face, n] of [[0, s], [-s * lt, -s]]) {
    P.cyl(0.026, 0.026, 0.008, M.steel, hxl, hyy, face + n * 0.004, Math.PI / 2, 0, 0, 24);
    P.cyl(0.0085, 0.0085, 0.05, M.steel, hxl, hyy, face + n * 0.028, Math.PI / 2, 0, 0, 12);
    P.rbox(0.13, 0.017, 0.015, 0.0065, M.steel, hxl - dir * 0.055, hyy, face + n * 0.05, 0, 0, 0, 2);
    // cerradura
    P.cyl(0.011, 0.011, 0.006, M.steel, hxl, hyy - 0.07, face + n * 0.003, Math.PI / 2, 0, 0, 16);
    if (isBlack) P.cyl(0.02, 0.02, 0.012, M.steel, hxl, hyy + 0.14, face + n * 0.006, Math.PI / 2, 0, 0, 20);
  }
  P.build(pivot);
  const target = -dir * s * 95 * DEG;
  makeInteractive(pivot, {
    label: 'Abrir puerta', labelOpen: 'Cerrar puerta',
    onToggle: (open) => tween(pivot, 'rotation.y', open ? target : 0, 1.0),
  });
  return root;
}

// ---------------------------------------------------------------------------
// 4. Ventana corrediza
// ---------------------------------------------------------------------------

export function slidingWindow({ width = 1.2, height = 1.1 } = {}) {
  const W = width, H = height, D = 0.08, f = 0.04;
  const root = newRoot('slidingWindow', W, D, H);
  const S = new Parts();
  S.rbox(W, f, D, 0.003, M.aluminum, 0, f / 2, 0, 0, 0, 0, 1);
  S.rbox(W, f, D, 0.003, M.aluminum, 0, H - f / 2, 0, 0, 0, 0, 1);
  for (const s of [-1, 1]) S.rbox(f, H - 2 * f + 0.002, D, 0.003, M.aluminum, s * (W / 2 - f / 2), H / 2, 0, 0, 0, 0, 1);
  // rieles
  for (const z of [-0.017, 0.017]) S.box(W - 2 * f, 0.006, 0.004, M.aluminum, 0, f + 0.003, z);
  const wi = W - 2 * f, hi = H - 2 * f;
  const sw = wi / 2 + 0.02;
  const xL = -wi / 2 + sw / 2, xR = wi / 2 - sw / 2;
  sash(S, sw, hi, xL, H / 2, -0.017, 0.035, 0.025);
  S.build(root);

  const g = new THREE.Group();
  g.position.set(xR, 0, 0.017);
  root.add(g);
  const P = new Parts();
  sash(P, sw, hi, 0, H / 2, 0, 0.035, 0.025);
  P.rbox(0.016, 0.09, 0.02, 0.005, M.aluminum, -sw / 2 + 0.0175, H / 2, 0.022, 0, 0, 0, 1);
  P.build(g);
  const openX = xR - (sw - 0.07);
  makeInteractive(g, {
    label: 'Abrir ventana', labelOpen: 'Cerrar ventana',
    onToggle: (open) => tween(g, 'position.x', open ? openX : xR, 0.9),
  });
  return root;
}

// ---------------------------------------------------------------------------
// 5. Puerta-ventana del balcón (4 hojas, las 2 centrales corren)
// ---------------------------------------------------------------------------

export function balconyDoor({ width = 3.0, height = 2.25 } = {}) {
  const W = width, H = height, f = 0.05, D = 0.1, sill = 0.03;
  const root = newRoot('balconyDoor', W, D, H);
  const S = new Parts();
  S.rbox(W, f, D, 0.003, M.aluminum, 0, H - f / 2, 0, 0, 0, 0, 1);
  for (const s of [-1, 1]) S.rbox(f, H - f, D, 0.003, M.aluminum, s * (W / 2 - f / 2), (H - f) / 2, 0, 0, 0, 0, 1);
  S.rbox(W - 2 * f, sill, D, 0.003, M.aluminum, 0, sill / 2, 0, 0, 0, 0, 1);
  const wi = W - 2 * f, hi = H - f - sill;
  for (const z of [-0.024, 0.024]) S.box(wi, 0.008, 0.006, M.aluminum, 0, sill + 0.004, z);
  const pw = wi / 4 + 0.025, step = (wi - pw) / 3;
  const xs = [0, 1, 2, 3].map((k) => -wi / 2 + pw / 2 + k * step);
  const yc = sill + hi / 2;
  sash(S, pw, hi, xs[0], yc, -0.024);
  sash(S, pw, hi, xs[3], yc, -0.024);
  S.build(root);

  const sliders = new THREE.Group();
  root.add(sliders);
  const mk = (k) => {
    const g = new THREE.Group();
    g.position.set(xs[k], 0, 0.024);
    const P = new Parts();
    sash(P, pw, hi, 0, yc, 0);
    const hx = k === 1 ? pw / 2 - 0.0225 : -pw / 2 + 0.0225;
    P.rbox(0.018, 0.24, 0.022, 0.006, M.aluminum, hx, 1.05, 0.028, 0, 0, 0, 1);
    P.build(g);
    sliders.add(g);
    return g;
  };
  const g1 = mk(1), g2 = mk(2);
  makeInteractive(sliders, {
    label: 'Abrir puerta del balcón', labelOpen: 'Cerrar puerta del balcón',
    onToggle: (open) => {
      tween(g1, 'position.x', open ? xs[0] : xs[1], 1.2);
      tween(g2, 'position.x', open ? xs[3] : xs[2], 1.2);
    },
  });
  return root;
}

// ---------------------------------------------------------------------------
// 6. Baño
// ---------------------------------------------------------------------------

export function toilet() {
  const root = newRoot('toilet', 0.385, 0.69, 0.81);
  const S = new Parts();
  const bz = 0.12, ks = 1.22;
  // taza (con labio y fondo interior)
  S.add(lathe([[0.11, 0], [0.113, 0.03], [0.128, 0.16], [0.152, 0.28], [0.176, 0.365], [0.183, 0.388], [0.179, 0.4],
    [0.162, 0.401], [0.13, 0.37], [0.07, 0.27], [0, 0.25]], 40), M.white, 0, 0, bz, 0, 0, 0, 1, 1, ks);
  // pedestal y tanque
  S.soft(0.29, 0.4, 0.26, 0.07, M.white, 0, 0.2, -0.1, 0, 0, 0, { seg: 0.07 });
  S.soft(0.37, 0.37, 0.17, 0.035, M.white, 0, 0.585, -0.255, 0, 0, 0, { seg: 0.08 });
  S.box(0.362, 0.004, 0.162, M.gap, 0, 0.772, -0.255); // junta tanque / tapa
  S.rbox(0.385, 0.03, 0.185, 0.012, M.white, 0, 0.789, -0.255, 0, 0, 0, 2);
  // pulsador doble
  S.cyl(0.024, 0.024, 0.005, M.chrome, 0, 0.8065, -0.255, 0, 0, 0, 28);
  S.box(0.0016, 0.0012, 0.047, M.gap, 0.004, 0.8092, -0.255);
  // asiento, junta con la taza, tapa cerrada y junta asiento/tapa
  S.add(new THREE.TorusGeometry(0.165, 0.0035, 3, 32), M.gap, 0, 0.404, bz, -Math.PI / 2, 0, 0, 1, ks, 1);
  S.add(new THREE.TorusGeometry(0.15, 0.02, 8, 36), M.whiteSoft, 0, 0.414, bz, -Math.PI / 2, 0, 0, 1, ks, 0.45);
  S.add(new THREE.TorusGeometry(0.178, 0.0025, 3, 32), M.gap, 0, 0.4235, bz + 0.005, -Math.PI / 2, 0, 0, 1, ks, 1);
  S.add(lathe([[0, 0], [0.176, 0], [0.184, 0.006], [0.182, 0.016], [0.17, 0.021], [0, 0.023]], 40), M.whiteSoft, 0, 0.424, bz + 0.005, 0, 0, 0, 1, 1, ks);
  for (const s of [-1, 1]) S.rbox(0.03, 0.022, 0.035, 0.008, M.chrome, s * 0.085, 0.428, -0.085, 0, 0, 0, 2);
  S.build(root);
  return root;
}

export function vanity({ width = 0.6 } = {}) {
  const W = width, D = 0.46;
  const root = newRoot('vanity', W, D, 1.85);
  const S = new Parts();
  const y0 = 0.42, y1 = 0.82, zb = -D / 2, zf = D / 2, cd = D - T;
  for (const s of [-1, 1]) S.rbox(T, y1 - y0, cd, 0.002, M.oak, s * (W / 2 - T / 2), (y0 + y1) / 2, zb + cd / 2, 0, 0, 0, 1);
  S.box(W - 0.002, T, cd, M.oak, 0, y1 - T / 2, zb + cd / 2);
  S.rbox(W, T, cd, 0.002, M.oak, 0, y0 + T / 2, zb + cd / 2, 0, 0, 0, 1);
  S.box(W - 2 * T, y1 - y0 - 2 * T, 0.01, M.oak, 0, (y0 + y1) / 2, zb + 0.005);
  // cubierta blanca + lavamanos de sobreponer
  S.rbox(W, 0.014, D, 0.004, M.quartz, 0, y1 + 0.007, 0, 0, 0, 0, 2);
  const by = y1 + 0.014;
  const bx = Math.min(0.46, W - 0.08) / 0.4, bzS = 0.34 / 0.4;
  S.add(lathe([[0, 0], [0.12, 0], [0.17, 0.04], [0.195, 0.1], [0.2, 0.128], [0.197, 0.133], [0.19, 0.13], [0.183, 0.1],
    [0.16, 0.045], [0.11, 0.015], [0, 0.015]], 48), M.white, 0, by, 0.02, 0, 0, 0, bx, 1, bzS);
  S.cyl(0.018, 0.018, 0.004, M.chrome, 0, by + 0.017, 0.02, 0, 0, 0, 20);
  S.add(new THREE.CircleGeometry(0.007, 12), M.gap, 0, by + 0.0192, 0.02, -Math.PI / 2, 0, 0);
  // grifo alto de lavamanos
  const fz = 0.02 - 0.2 * bzS - 0.035;
  S.cyl(0.022, 0.024, 0.012, M.chrome, 0, by + 0.006, fz, 0, 0, 0, 20);
  S.cyl(0.015, 0.015, 0.26, M.chrome, 0, by + 0.142, fz, 0, 0, 0, 20);
  const pts = [V3(0, by + 0.27, fz), V3(0, by + 0.295, fz + 0.01), V3(0, by + 0.3, fz + 0.06), V3(0, by + 0.292, fz + 0.13), V3(0, by + 0.27, fz + 0.16)];
  S.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 12), M.chrome);
  S.add(new THREE.SphereGeometry(0.012, 12, 6), M.chrome, 0, by + 0.27, fz + 0.16);
  S.add(new THREE.CircleGeometry(0.008, 12), M.gap, 0, by + 0.2645, fz + 0.164, Math.PI / 2 + 0.6, 0, 0);
  S.rbox(0.012, 0.012, 0.07, 0.005, M.chrome, 0.022, by + 0.235, fz, 0, 0, -0.3, 2);
  // sifón cromado bajo el mueble flotante
  S.cyl(0.016, 0.016, 0.1, M.chrome, 0, y0 - 0.05, -0.06, 0, 0, 0, 14);
  S.cyl(0.016, 0.016, -0.06 - zb, M.chrome, 0, y0 - 0.1, (zb - 0.06) / 2, Math.PI / 2, 0, 0, 14);
  S.add(new THREE.SphereGeometry(0.016, 14, 8), M.chrome, 0, y0 - 0.1, -0.06);
  S.cyl(0.03, 0.03, 0.008, M.chrome, 0, y0 - 0.1, zb + 0.004, Math.PI / 2, 0, 0, 20);
  // espejo de canto pulido sobre platina
  S.box(W, 0.8, 0.005, M.mirror, 0, 1.45, zb + 0.0105);
  S.rbox(W + 0.004, 0.804, 0.006, 0.0015, M.chrome, 0, 1.45, zb + 0.005, 0, 0, 0, 1);
  S.build(root);
  drawer(root, {
    x: 0, y0: y0 + GAP, y1: y1 - GAP, w: W - 2 * GAP, zFace: zf, bodyW: W - 2 * T - 0.02, bodyD: cd - 0.08,
    handleLen: Math.min(0.3, W * 0.45), dist: 0.3,
  });
  return root;
}

export function showerScreen({ width = 0.75, depth = 0.9, side = 'right' } = {}) {
  const W = width, D = depth, sx = side === 'left' ? -1 : 1;
  const root = newRoot('showerScreen', W, D, 2.2);
  const S = new Parts();
  const zb = -D / 2, zf = D / 2, gt = 0.008, gy0 = 0.041, GH = 1.95;
  // plato + rejilla de desagüe
  S.rbox(W, 0.035, D, 0.006, M.white, 0, 0.0175, 0, 0, 0, 0, 2);
  S.box(0.1, 0.002, 0.1, M.chrome, 0, 0.036, zb + 0.15);
  for (let k = 0; k < 6; k++) S.box(0.08, 0.0006, 0.004, M.gap, 0, 0.0371, zb + 0.115 + k * 0.014);
  // panel fijo frontal + lateral
  const fw = Math.max(0.2, W * 0.36);
  S.box(fw, GH, gt, M.glass, sx * (W / 2 - fw / 2), gy0 + GH / 2, zf - gt / 2);
  S.box(gt, GH, D - gt, M.glass, sx * (W / 2 - gt / 2), gy0 + GH / 2, -gt / 2);
  S.rbox(0.02, GH, 0.02, 0.004, M.chrome, sx * (W / 2 - 0.01), gy0 + GH / 2, zb + 0.01, 0, 0, 0, 1);
  for (const y of [0.35, GH - 0.2]) S.rbox(0.03, 0.05, 0.03, 0.006, M.chrome, sx * (W / 2 - gt / 2), gy0 + y, zf - gt / 2, 0, 0, 0, 2);
  S.cyl(0.008, 0.008, D - 0.02, M.chrome, sx * (W / 2 - fw / 2), gy0 + GH - 0.04, 0, Math.PI / 2, 0, 0, 12);
  // ducha tipo lluvia: brazo cromado y regadera cuadrada negra
  S.cyl(0.026, 0.026, 0.01, M.chrome, 0, 2.13, zb + 0.005, Math.PI / 2, 0, 0, 20);
  S.cyl(0.01, 0.01, 0.3, M.chrome, 0, 2.13, zb + 0.15, Math.PI / 2, 0, 0, 12);
  S.cyl(0.01, 0.01, 0.025, M.chrome, 0, 2.118, zb + 0.3, 0, 0, 0, 12);
  S.rbox(0.22, 0.014, 0.22, 0.006, M.black, 0, 2.1, zb + 0.3, 0, 0, 0, 2);
  // mezclador: roseta cromada con palanca hacia abajo (f17)
  S.cyl(0.035, 0.035, 0.008, M.chrome, 0, 1.1, zb + 0.004, Math.PI / 2, 0, 0, 28);
  S.cyl(0.013, 0.015, 0.035, M.chrome, 0, 1.1, zb + 0.025, Math.PI / 2, 0, 0, 16);
  S.rbox(0.011, 0.07, 0.012, 0.005, M.black, 0, 1.07, zb + 0.042, 0, 0, 0, 2);
  // jabonera esquinera (f17)
  const cxw = -sx * W / 2, th0 = sx > 0 ? 0 : -Math.PI / 2;
  S.add(new THREE.CylinderGeometry(0.09, 0.09, 0.006, 16, 1, false, th0, Math.PI / 2), M.white, cxw, 1.05, zb, 0, 0, 0);
  S.add(new THREE.TorusGeometry(0.09, 0.004, 4, 12, Math.PI / 2), M.chrome, cxw, 1.053, zb, Math.PI / 2, 0, sx > 0 ? 0 : Math.PI / 2);
  // bisagras de muro
  const px = -sx * W / 2 + sx * 0.012;
  for (const y of [0.35, GH - 0.35]) S.rbox(0.012, 0.08, 0.05, 0.003, M.chrome, -sx * W / 2 + sx * 0.006, gy0 + y, zf - gt / 2, 0, 0, 0, 1);
  S.build(root);

  // puerta batiente
  const dw = W - fw - 0.028;
  const pivot = new THREE.Group();
  pivot.position.set(px, 0, zf - gt / 2);
  root.add(pivot);
  const P = new Parts();
  P.box(dw, GH - 0.01, gt, M.glass, sx * (0.01 + dw / 2), gy0 + 0.005 + (GH - 0.01) / 2, 0);
  for (const y of [0.35, GH - 0.35]) P.rbox(0.06, 0.08, 0.026, 0.005, M.chrome, sx * 0.03, gy0 + y, 0, 0, 0, 0, 2);
  const hx = sx * (0.01 + dw - 0.06);
  for (const z of [-0.032, 0.032]) P.cyl(0.009, 0.009, 0.3, M.chrome, hx, 1.05, z, 0, 0, 0, 12);
  for (const y of [-0.12, 0.12]) P.cyl(0.006, 0.006, 0.064, M.chrome, hx, 1.05 + y, 0, Math.PI / 2, 0, 0, 10);
  P.build(pivot);
  makeInteractive(pivot, {
    label: 'Abrir ducha', labelOpen: 'Cerrar ducha',
    onToggle: (open) => tween(pivot, 'rotation.y', open ? -sx * 90 * DEG : 0, 0.9),
  });
  return root;
}

/** Toallero de aro con toalla de mano. Origen = centro de la roseta en el muro (z=0); el aro cuelga debajo. */
export function towelRing({ towel = true } = {}) {
  const root = newRoot('towelRing', 0.3, 0.08, 0.6);
  const S = new Parts();
  const R = 0.085, zr = 0.06;
  S.cyl(0.025, 0.025, 0.01, M.chrome, 0, 0, 0.005, Math.PI / 2, 0, 0, 24);
  S.cyl(0.0075, 0.0075, zr - 0.01, M.chrome, 0, 0, 0.01 + (zr - 0.01) / 2, Math.PI / 2, 0, 0, 12);
  S.cyl(0.009, 0.009, 0.016, M.chrome, 0, -0.004, zr, 0, 0, 0, 12);
  S.add(new THREE.TorusGeometry(R, 0.0055, 6, 36), M.chrome, 0, -R - 0.012, zr);
  if (towel) {
    const yr = -2 * R - 0.012; // fondo del aro
    S.soft(0.13, 0.03, 0.04, 0.014, M.towel, 0, yr + 0.002, zr, 0, 0, 0, { seg: 0.03, puff: 0.004 });
    const th = 0.4;
    S.soft(0.3, th, 0.03, 0.013, M.towel, 0, yr - th / 2 + 0.006, zr, 0, 0, 0, {
      seg: 0.06, puffSide: 0.006,
      deform: (v, hx, hy) => {
        const ty = (v.y + hy) / (2 * hy);
        v.x *= 1 - 0.55 * smooth(0.7, 1, ty);
        v.z *= 1 + 0.7 * smooth(0.65, 1, ty);
        v.y += 0.006 * Math.sin(v.x * 30) * (1 - smooth(0, 0.1, ty));
      },
    });
  }
  S.build(root, { ao: { floor: false, height: 0 } });
  return root;
}

// ---------------------------------------------------------------------------
// 7. Mobiliario de ambientación
// ---------------------------------------------------------------------------

export function bedQueen() {
  const root = newRoot('bedQueen', 1.74, 2.1, 1.2);
  const S = new Parts();
  const ml = 2.0, mw = 1.6, zc = 0.03;
  const zHead = zc - ml / 2, zFoot = zc + ml / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.cyl(0.025, 0.018, 0.085, M.warmWood, sx * 0.74, 0.0425, zc + sz * 0.93, 0, 0, 0, 12);
  // base tapizada y colchón
  S.soft(1.66, 0.24, 2.04, 0.03, M.fabricCream, 0, 0.2, zc, 0, 0, 0, { seg: 0.16, puffSide: 0.004 });
  S.soft(mw, 0.22, ml, 0.06, M.bedding, 0, 0.43, zc, 0, 0, 0, { seg: 0.14, puff: 0.01, puffSide: 0.008 });
  const mTop = 0.54;
  // edredón que cae por los lados y el pie, doblado hacia atrás en la cabecera
  const dz0 = zHead + 0.5;
  const dTop = mTop + 0.035;
  S.add(drapeGeo({ hw: 0.76, z0: dz0, z1: zFoot - 0.04, top: dTop, drop: 0.25, rr: 0.07, th: 0.035, puff: 0.014, wrinkle: 0.008, seed: 3 }), M.bedding);
  S.soft(1.7, 0.07, 0.28, 0.034, M.bedding, 0, dTop + 0.012, dz0 + 0.09, 0, 0, 0, { seg: 0.12, puff: 0.012, puffSide: 0.01 });
  // pie de cama salvia doblado sobre el pie
  S.add(drapeGeo({ hw: 0.76, z0: zFoot - 0.6, z1: zFoot - 0.04, top: dTop + 0.03, drop: 0.29, rr: 0.1, th: 0.012, puff: 0.012, wrinkle: 0.01, seed: 5 }), M.fabricSage);
  // almohadas apoyadas en el cabecero + cojines salvia
  for (const s of [-1, 1]) S.pillow(0.66, 0.42, 0.17, M.bedding, s * 0.39, mTop + 0.2, zHead + 0.17, -0.45, s * 0.04, s * 0.03, 0.08);
  for (const s of [-1, 1]) S.pillow(0.44, 0.42, 0.14, M.fabricSage, s * 0.25, mTop + 0.2, zHead + 0.36, -0.35, -s * 0.12, s * 0.02, 0.08);
  // cabecero tapizado por canales
  const hbW = 1.74, nCh = 6, hbH = 1.12, hbZ = zc - 1.02 - 0.04, hy = 0.06 + hbH / 2;
  S.soft(hbW, hbH, 0.04, 0.01, M.fabricCream, 0, hy, hbZ - 0.01, 0, 0, 0, { seg: 0.25 });
  for (let i = 0; i < nCh; i++) {
    S.soft(hbW / nCh - 0.004, hbH - 0.02, 0.07, 0.03, M.fabricCream, -hbW / 2 + (i + 0.5) * (hbW / nCh), hy, hbZ + 0.01, 0, 0, 0,
      { seg: 0.18, puffSide: 0.012 });
  }
  S.build(root);
  return root;
}

export function nightstand({ lamp = true } = {}) {
  const W = 0.45, D = 0.38, H = 0.52, legH = 0.16;
  const root = newRoot('nightstand', W, D, lamp ? H + 0.41 : H);
  const S = new Parts();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      S.cyl(0.015, 0.009, legH + 0.01, M.warmWood, sx * (W / 2 - 0.045), (legH + 0.01) / 2, sz * (D / 2 - 0.045), -sz * 0.06, 0, sx * 0.06, 12);
    }
  }
  S.rbox(W, T + 0.004, D, 0.006, M.warmWood, 0, H - (T + 0.004) / 2, 0, 0, 0, 0, 2);
  S.box(W - 0.002, T, D - 0.002, M.warmWood, 0, legH + T / 2, 0);
  for (const s of [-1, 1]) S.rbox(T, H - legH - T, D, 0.002, M.warmWood, s * (W / 2 - T / 2), (H + legH - T) / 2 - 0.002, 0, 0, 0, 0, 1);
  S.box(W - 2 * T, H - legH - 2 * T, 0.006, M.warmWood, 0, (H + legH) / 2, -D / 2 + 0.003);
  if (lamp) {
    const lx = 0.06, lz = -0.04;
    S.add(lathe([[0, 0], [0.045, 0], [0.05, 0.006], [0.074, 0.07], [0.074, 0.12], [0.06, 0.17], [0.022, 0.205], [0.013, 0.215], [0.013, 0.235], [0, 0.235]], 32), M.pot, lx, H, lz);
    S.cyl(0.0045, 0.0045, 0.12, M.steel, lx, H + 0.28, lz, 0, 0, 0, 8);
    S.add(new THREE.CylinderGeometry(0.1, 0.13, 0.18, 32, 1, true), M.linen, lx, H + 0.32, lz);
    for (const [rad, y] of [[0.1, H + 0.41], [0.13, H + 0.23]]) S.add(new THREE.TorusGeometry(rad, 0.0025, 3, 32), M.pot, lx, y, lz, Math.PI / 2, 0, 0);
  }
  S.build(root);
  drawer(root, {
    x: 0, y0: legH + T + GAP, y1: H - T - GAP - 0.004, w: W - 2 * T - 2 * GAP, zFace: D / 2, mat: M.warmWood,
    bodyW: W - 2 * T - 0.02, bodyD: D - T - 0.04, handleLen: 0.1, dist: 0.24,
  });
  return root;
}

export function sofa({ width = 1.9 } = {}) {
  const W = width, D = 0.88, legH = 0.06, armW = 0.16;
  const root = newRoot('sofa', W, D, 0.85);
  const S = new Parts();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) S.cyl(0.018, 0.011, legH + 0.012, M.warmWood, sx * (W / 2 - 0.08), (legH + 0.012) / 2, sz * (D / 2 - 0.08), -sz * 0.08, 0, sx * 0.08, 12);
  }
  S.soft(W - 0.02, 0.2, D - 0.02, 0.035, M.fabricCream, 0, legH + 0.1, 0, 0, 0, 0, { seg: 0.16 });
  for (const s of [-1, 1]) S.soft(armW, 0.6, D, 0.065, M.fabricCream, s * (W / 2 - armW / 2), legH + 0.3, 0, 0, 0, 0, { seg: 0.12, puffSide: 0.008 });
  S.soft(W - 2 * armW + 0.02, 0.74, 0.18, 0.05, M.fabricCream, 0, legH + 0.37, -D / 2 + 0.09, 0, 0, 0, { seg: 0.16 });
  const seatW = (W - 2 * armW) / 2 - 0.006, sd = D - 0.2;
  for (const s of [-1, 1]) {
    const x = s * (seatW / 2 + 0.003);
    S.soft(seatW, 0.17, sd, 0.06, M.fabricCream, x, 0.345, -D / 2 + 0.18 + sd / 2 + 0.01, 0, 0, 0, { seg: 0.1, puff: 0.014, puffSide: 0.006 });
    S.soft(seatW, 0.46, 0.18, 0.075, M.fabricCream, x, 0.645, -D / 2 + 0.18 + 0.09, -0.15, 0, 0, { seg: 0.1, puffSide: 0.022 });
    S.pillow(0.42, 0.42, 0.13, M.fabricSage, s * (W / 2 - armW - 0.25), 0.62, -D / 2 + 0.18 + 0.17 + 0.07, -0.22, -s * 0.28, 0, 0.08);
  }
  S.build(root);
  return root;
}

function book(S, bx, by, bz, ry, w, t, d, coverHex) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const cover = M.paint;
  S.tint(coverHex);
  const at = (lx, lz) => [bx + lx * c + lz * s, bz - lx * s + lz * c];
  for (const e of [-1, 1]) {
    const [x, z] = at(0, 0);
    S.rbox(w, 0.003, d, 0.0012, cover, x, by + e * (t / 2 - 0.0015), z, 0, ry, 0, 1);
  }
  let [x, z] = at(-w / 2 + 0.002, 0);
  S.rbox(0.004, t, d, 0.0018, cover, x, by, z, 0, ry, 0, 1);
  [x, z] = at(0.002, 0);
  S.tint(0xf1ede3);
  S.box(w - 0.01, t - 0.006, d - 0.008, M.paint, x, by, z, 0, ry, 0);
  S.tint(null);
}

export function coffeeTable({ diameter = 0.7, height = 0.4, decor = true } = {}) {
  const R = diameter / 2;
  const root = newRoot('coffeeTable', diameter, diameter, height);
  const S = new Parts();
  S.add(lathe([[0, 0], [R - 0.012, 0], [R - 0.002, 0.004], [R, 0.014], [R, 0.024], [R - 0.003, 0.032], [R - 0.009, 0.035], [0, 0.035]], 64), M.warmWood, 0, height - 0.035, 0);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    S.cyl(0.022, 0.013, height - 0.035, M.warmWood, Math.cos(a) * R * 0.68, (height - 0.035) / 2, Math.sin(a) * R * 0.68, 0, 0, 0, 14);
  }
  if (decor) {
    book(S, 0.08, height + 0.014, 0.05, 0.3, 0.24, 0.028, 0.17, 0x5f6d4a);
    book(S, 0.085, height + 0.028 + 0.012, 0.05, 0.15, 0.21, 0.024, 0.15, 0xd9cfbd);
    S.tint(0xdcd5c9);
    S.add(lathe([[0, 0], [0.035, 0], [0.042, 0.005], [0.07, 0.045], [0.074, 0.05], [0.068, 0.05], [0.036, 0.01], [0, 0.01]], 32), M.paint, -0.13, height, -0.08);
    S.tint(null);
  }
  S.build(root, { ao: { floor: false, height: 0 } });
  return root;
}

export function rug({ width = 2.0, depth = 1.4 } = {}) {
  const root = newRoot('rug', width, depth, 0.012);
  const S = new Parts();
  S.rbox(width, 0.012, depth, 0.004, M.jute, 0, 0.006, 0, 0, 0, 0, 1);
  // flecos en los extremos cortos (±Z)
  const r = rng(Math.round(width * 100 + depth * 7));
  const n = Math.floor(width / 0.011);
  const strand = new THREE.PlaneGeometry(0.0035, 1);
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + ((i + 0.5) * width) / n + (r() - 0.5) * 0.003;
      const len = 0.045 + r() * 0.014;
      S.add(strand, M.jute, x, 0.0016 + r() * 0.0008, s * (depth / 2 + len / 2 - 0.003), -Math.PI / 2, 0, (r() - 0.5) * 0.14, 1, len, 1);
    }
  }
  S.build(root);
  return root;
}

export function diningTable({ width = 1.0, depth = 0.65, height = 0.75 } = {}) {
  const W = width, D = depth, H = height;
  const root = newRoot('diningTable', W, D, H);
  const S = new Parts();
  S.rbox(W, 0.03, D, 0.006, M.warmWood, 0, H - 0.015, 0, 0, 0, 0, 2);
  for (const s of [-1, 1]) {
    S.box(W - 0.12, 0.07, 0.02, M.warmWood, 0, H - 0.065, s * (D / 2 - 0.05));
    S.box(0.02, 0.07, D - 0.12, M.warmWood, s * (W / 2 - 0.05), H - 0.065, 0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) S.cyl(0.024, 0.015, H - 0.03, M.warmWood, sx * (W / 2 - 0.055), (H - 0.03) / 2, sz * (D / 2 - 0.055), 0, 0, 0, 14);
  }
  S.build(root, { ao: { floor: false, height: 0 } });
  return root;
}

export function diningChair() {
  const root = newRoot('diningChair', 0.44, 0.46, 0.84);
  const S = new Parts();
  const sh = 0.46;
  // patas cónicas con leve apertura
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = sh - 0.05;
      S.cyl(0.016, 0.01, h, M.warmWood, sx * 0.18, h / 2, sz * 0.175, -sz * 0.07, 0, sx * 0.07, 12);
    }
  }
  S.rbox(0.38, 0.045, 0.37, 0.01, M.warmWood, 0, sh - 0.065, 0, 0, 0, 0, 2);
  // asiento tapizado
  S.soft(0.45, 0.07, 0.44, 0.03, M.fabricSage, 0, sh - 0.01, 0.01, 0, 0, 0, { seg: 0.06, puff: 0.009, puffSide: 0.004 });
  // respaldo curvo tapizado sobre dos postes
  for (const s of [-1, 1]) S.cyl(0.011, 0.012, 0.24, M.warmWood, s * 0.15, 0.56, -0.2, -0.08, 0, 0, 10);
  S._prim = { hx: 0.22, hy: 0.15, hz: 0.03, r: 0.02 };
  S.add(bendGeo(softBoxGeo(0.44, 0.3, 0.05, 0.022, { seg: 0.05, puffSide: 0.006 }), 0.32), M.fabricSage, 0, 0.67, -0.19, -0.08, 0, 0);
  S.build(root);
  return root;
}

export function desk({ width = 1.0, depth = 0.55, laptop = true } = {}) {
  const W = width, D = depth, H = 0.75;
  const root = newRoot('desk', W, D, H);
  const S = new Parts();
  S.rbox(W, 0.025, D, 0.005, M.oak, 0, H - 0.0125, 0, 0, 0, 0, 2);
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.05);
    for (const z of [-1, 1]) S.rbox(0.03, H - 0.025, 0.03, 0.004, M.black, x, (H - 0.025) / 2, z * (D / 2 - 0.04), 0, 0, 0, 1);
    S.rbox(0.03, 0.03, D - 0.08, 0.004, M.black, x, H - 0.04, 0, 0, 0, 0, 1);
    S.rbox(0.03, 0.02, D - 0.04, 0.004, M.black, x, 0.01, 0, 0, 0, 0, 1);
  }
  S.rbox(W - 0.1, 0.05, 0.02, 0.004, M.black, 0, H - 0.06, -D / 2 + 0.04, 0, 0, 0, 1);
  if (laptop) {
    const lx = 0.05, lz = 0.03, by = H + 0.007;
    S.rbox(0.31, 0.014, 0.215, 0.005, M.aluminum, lx, by, lz, 0, 0, 0, 2);
    S.box(0.27, 0.0008, 0.1, M.screen, lx, H + 0.0142, lz - 0.035); // teclado
    S.box(0.1, 0.0006, 0.065, M.screen, lx, H + 0.0141, lz + 0.065); // trackpad
    const hz = lz - 0.1075, hy = H + 0.014, a = 15 * DEG;
    const cy = hy + Math.cos(a) * 0.1075, cz = hz - Math.sin(a) * 0.1075;
    S.rbox(0.31, 0.215, 0.006, 0.004, M.aluminum, lx, cy, cz, -a, 0, 0, 2);
    S.box(0.29, 0.19, 0.001, M.screen, lx, cy + Math.sin(a) * 0.0035, cz + Math.cos(a) * 0.0035, -a, 0, 0);
  }
  S.build(root);
  return root;
}

export function deskChair() {
  const root = newRoot('deskChair', 0.62, 0.62, 1.12);
  const S = new Parts();
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    S.rbox(0.042, 0.028, 0.29, 0.01, M.black, Math.sin(a) * 0.15, 0.075, Math.cos(a) * 0.15, 0, a, 0, 1);
    S.add(new THREE.SphereGeometry(0.022, 10, 6), M.black, Math.sin(a) * 0.28, 0.024, Math.cos(a) * 0.28);
    S.cyl(0.006, 0.006, 0.03, M.chrome, Math.sin(a) * 0.28, 0.05, Math.cos(a) * 0.28, 0, 0, 0, 8);
  }
  S.cyl(0.03, 0.035, 0.06, M.black, 0, 0.1, 0, 0, 0, 0, 16);
  S.cyl(0.022, 0.022, 0.28, M.chrome, 0, 0.27, 0, 0, 0, 0, 16);
  S.rbox(0.2, 0.04, 0.2, 0.01, M.black, 0, 0.42, 0, 0, 0, 0, 1);
  S.soft(0.48, 0.08, 0.46, 0.035, M.fabricGray, 0, 0.48, 0.02, 0, 0, 0, { seg: 0.08, puff: 0.01, puffSide: 0.004 });
  S.rbox(0.05, 0.36, 0.025, 0.008, M.black, 0, 0.62, -0.23, -0.1, 0, 0, 1);
  S._prim = { hx: 0.23, hy: 0.25, hz: 0.03, r: 0.03 };
  S.add(bendGeo(softBoxGeo(0.46, 0.5, 0.06, 0.03, { seg: 0.08, puffSide: 0.008 }), 0.5), M.fabricGray, 0, 0.86, -0.27, -0.1, 0, 0);
  for (const s of [-1, 1]) {
    S.rbox(0.025, 0.2, 0.025, 0.008, M.black, s * 0.25, 0.6, -0.02, 0, 0, 0, 1);
    S.rbox(0.06, 0.025, 0.24, 0.01, M.black, s * 0.25, 0.71, 0.01, 0, 0, 0, 1);
  }
  S.build(root);
  return root;
}

const _bx = V3(), _by = V3(), _bz = V3(), _upY = V3(0, 1, 0), _mm = new THREE.Matrix4();
function placeLeaf(S, mat, pos, dir, len, twist) {
  _by.copy(dir).normalize();
  _bz.copy(_upY).addScaledVector(_by, -_upY.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  if (twist) { _bx.applyAxisAngle(_by, twist); _bz.applyAxisAngle(_by, twist); }
  _mm.makeBasis(_bx.multiplyScalar(len), _by.multiplyScalar(len), _bz.multiplyScalar(len)).setPosition(pos);
  S.addM(leafGeo(), mat, _mm);
}

export function plant({ height = 0.7, seed = 1 } = {}) {
  const h = height;
  const r = rng(seed * 9973 + 17);
  const potH = clamp(h * 0.34, 0.12, 0.42), potR = potH * 0.62;
  const root = newRoot('plant', potR * 2.2, potR * 2.2, h);
  const S = new Parts();
  // maceta de cerámica mate con borde
  S.tint(0xdcd5c9);
  S.add(lathe([[0, 0], [potR * 0.74, 0], [potR * 0.78, 0.008], [potR * 0.97, potH * 0.94], [potR * 1.02, potH * 0.985],
    [potR, potH], [potR * 0.93, potH], [potR * 0.9, potH * 0.9]], 32), M.paint);
  S.tint(0x3b2e24);
  S.cyl(potR * 0.91, potR * 0.91, 0.01, M.paint, 0, potH * 0.88, 0, 0, 0, 0, 24);
  // tallos arqueados con hojas alternas
  const fh = h - potH;
  const nStem = 5 + Math.floor(r() * 3);
  const leafLen = clamp(fh * 0.26, 0.07, 0.22);
  const cy = potH + fh * 0.55;
  for (let s = 0; s < nStem; s++) {
    const a = (s / nStem) * Math.PI * 2 + r() * 0.8;
    const lean = 0.18 + r() * 0.35;
    const sh = fh * (0.55 + r() * 0.4);
    const p0 = V3((r() - 0.5) * potR * 0.4, potH * 0.88, (r() - 0.5) * potR * 0.4);
    const p1 = V3(p0.x + Math.cos(a) * sh * lean * 0.15, p0.y + sh * 0.6, p0.z + Math.sin(a) * sh * lean * 0.15);
    const p2 = V3(p0.x + Math.cos(a) * sh * lean, p0.y + sh, p0.z + Math.sin(a) * sh * lean);
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    S.tint(0xd8c8a0);
    S.add(new THREE.TubeGeometry(curve, 8, 0.004 + h * 0.003, 5), M.leaf);
    const nl = 5 + Math.floor(r() * 3);
    for (let k = 0; k < nl; k++) {
      const t = 0.3 + 0.7 * Math.pow(k / (nl - 1), 0.8);
      const pos = curve.getPoint(t), tan = curve.getTangent(t);
      const side = k % 2 ? 1 : -1;
      const b = a + side * 1.1 + (r() - 0.5) * 0.6;
      const dir = V3(Math.cos(b), 0.25 + r() * 0.3, Math.sin(b)).addScaledVector(tan, 0.6 + t * 0.5);
      const len = leafLen * (0.75 + 0.35 * r()) * (k === nl - 1 ? 0.8 : 1);
      S.tint(r() < 0.5 ? 0xffffff : 0xc4ccbc);
      placeLeaf(S, M.leaf, pos, dir, len, (r() - 0.5) * 0.8);
    }
  }
  // AO del follaje: hojas interiores más oscuras
  S.build(root, {
    ao: {
      floor: false, height: 0, strength: 0,
      fn: (p) => 0.5 + 0.5 * smooth(0, fh * 0.45, Math.hypot(p.x, (p.y - cy) * 0.8, p.z)),
    },
  });
  return root;
}

export function washer() {
  const W = 0.6, D = 0.6, H = 0.85;
  const root = newRoot('washer', W, D, H);
  const S = new Parts();
  const zf = 0.29;
  S.soft(W, H - 0.015, D - 0.01, 0.022, M.appliance, 0, 0.015 + (H - 0.015) / 2, -0.005, 0, 0, 0, { seg: 0.3 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.cyl(0.02, 0.02, 0.015, M.rubber, sx * 0.25, 0.0075, sz * 0.24, 0, 0, 0, 12);
  // panel de control
  S.box(W - 0.03, 0.002, 0.003, M.gap, 0, H - 0.13, zf + 0.0005);
  S.box(0.204, 0.079, 0.004, M.gap, -0.17, H - 0.07, zf);
  S.rbox(0.2, 0.075, 0.012, 0.005, M.appliance, -0.17, H - 0.07, zf + 0.003, 0, 0, 0, 2);
  S.rbox(0.07, 0.012, 0.004, 0.002, M.gap, -0.17, H - 0.097, zf + 0.009, 0, 0, 0, 1);
  S.rbox(0.095, 0.038, 0.003, 0.003, M.screen, 0.03, H - 0.07, zf + 0.001, 0, 0, 0, 1);
  S.cyl(0.033, 0.035, 0.022, M.chrome, 0.19, H - 0.07, zf + 0.011, Math.PI / 2, 0, 0, 32);
  S.cyl(0.026, 0.026, 0.003, M.appliance, 0.19, H - 0.07, zf + 0.0225, Math.PI / 2, 0, 0, 32);
  for (let k = 0; k < 3; k++) S.cyl(0.005, 0.005, 0.003, M.chrome, 0.085 + k * 0.018, H - 0.1, zf + 0.0015, Math.PI / 2, 0, 0, 10);
  // aro de la escotilla y fuelle
  const dy = 0.44;
  S.cyl(0.178, 0.178, 0.004, M.gap, 0, dy, zf + 0.001, Math.PI / 2, 0, 0, 48);
  S.add(new THREE.TorusGeometry(0.15, 0.012, 6, 36), M.rubber, 0, dy, zf - 0.004);
  S.cyl(0.14, 0.14, 0.002, M.chrome, 0, dy, zf - 0.06, Math.PI / 2, 0, 0, 40);
  S.build(root);

  const pivot = new THREE.Group();
  pivot.position.set(-0.19, dy, zf);
  root.add(pivot);
  const P = new Parts();
  P.add(new THREE.TorusGeometry(0.165, 0.028, 10, 40), M.appliance, 0.19, 0, 0.03);
  P.add(new THREE.TorusGeometry(0.142, 0.008, 6, 40), M.chrome, 0.19, 0, 0.052);
  P.add(new THREE.SphereGeometry(0.14, 32, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.doorGlass, 0.19, 0, 0.045, -Math.PI / 2, 0, 0, 1, 0.35, 1);
  P.cyl(0.14, 0.14, 0.004, M.doorGlass, 0.19, 0, 0.045, Math.PI / 2, 0, 0, 40);
  P.rbox(0.03, 0.08, 0.03, 0.01, M.chrome, 0.37, 0, 0.03, 0, 0, 0, 2);
  P.rbox(0.03, 0.1, 0.03, 0.01, M.appliance, 0.0, 0, 0.02, 0, 0, 0, 2);
  P.build(pivot);
  makeInteractive(pivot, {
    label: 'Abrir lavadora', labelOpen: 'Cerrar lavadora',
    onToggle: (open) => tween(pivot, 'rotation.y', open ? -100 * DEG : 0, 0.8),
  });
  return root;
}

export function fridge({ hinge = 'right' } = {}) {
  const W = 0.6, D = 0.65, H = 1.7, dt = 0.05;
  const root = newRoot('fridge', W, D, H);
  const S = new Parts();
  const zF = D / 2 - dt, zB = -D / 2, bodyD = zF - zB, bz = zB + bodyD / 2;
  const y0 = 0.03, wt = 0.04;
  for (const s of [-1, 1]) {
    S.box(wt - 0.004, H - y0, bodyD, M.whiteMatte, s * (W / 2 - 0.004 - (wt - 0.004) / 2), y0 + (H - y0) / 2, bz);
    S.rbox(0.006, H - y0, bodyD, 0.002, M.steel, s * (W / 2 - 0.003), y0 + (H - y0) / 2, bz, 0, 0, 0, 1);
  }
  S.box(W - 0.008, wt - 0.004, bodyD, M.whiteMatte, 0, H - 0.004 - (wt - 0.004) / 2, bz);
  S.rbox(W, 0.006, bodyD, 0.002, M.steel, 0, H - 0.003, bz, 0, 0, 0, 1);
  S.box(W - 0.008, wt, bodyD, M.whiteMatte, 0, y0 + wt / 2, bz);
  S.box(W - 0.008, H - y0 - wt, wt, M.whiteMatte, 0, y0 + (H - y0) / 2, zB + wt / 2);
  S.box(W, y0, bodyD, M.black, 0, y0 / 2, bz);
  for (let k = 0; k < 4; k++) S.box(W - 0.08, 0.003, 0.004, M.black, 0, 0.007 + k * 0.005, zF + 0.0005);
  const yDiv = H - 0.48;
  const inW = W - 2 * wt, inD = bodyD - wt, inZ = zB + wt + inD / 2;
  S.box(inW, 0.05, inD, M.whiteMatte, 0, yDiv, inZ);
  const shD = inD - 0.12, shZ = zB + wt + shD / 2;
  for (const y of [0.62, 0.95, yDiv + 0.22]) S.box(inW - 0.004, 0.006, shD, M.glass, 0, y, shZ);
  S.rbox(inW - 0.01, 0.2, shD - 0.02, 0.01, M.whiteSoft, 0, y0 + wt + 0.105, shZ, 0, 0, 0, 2);

  S.build(root);

  const dir = hinge === 'left' ? 1 : -1;
  const hx = hinge === 'left' ? -W / 2 : W / 2;
  const mkDoor = (yA, yB, label, labelOpen, handleTop) => {
    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, zF);
    root.add(pivot);
    const P = new Parts();
    const h = yB - yA, yc = (yA + yB) / 2, dw = W - 0.004, cx = dir * (dw / 2 + 0.002);
    P.rbox(dw, h, dt, 0.008, M.steel, cx, yc, dt / 2, 0, 0, 0, 2);
    P.rbox(dw - 0.03, h - 0.03, 0.01, 0.004, M.whiteSoft, cx, yc, -0.003, 0, 0, 0, 1); // empaque
    P.rbox(dw - 0.09, h - 0.09, 0.02, 0.01, M.whiteSoft, cx, yc, -0.012, 0, 0, 0, 1);
    const nb = h > 0.8 ? 3 : 1;
    for (let i = 0; i < nb; i++) {
      const y = nb === 1 ? yc : yA + 0.15 + (i * (h - 0.32)) / (nb - 1);
      P.rbox(dw - 0.14, 0.07, 0.07, 0.006, M.whiteSoft, cx, y, -0.055, 0, 0, 0, 1);
    }
    const hl = handleTop ? 0.36 : 0.22;
    const hy = handleTop ? yB - hl / 2 - 0.08 : yA + hl / 2 + 0.06;
    barHandle(P, hl, dir * (dw - 0.035), hy, dt, true);
    P.build(pivot);
    makeInteractive(pivot, {
      label, labelOpen,
      onToggle: (open) => tween(pivot, 'rotation.y', open ? -dir * 100 * DEG : 0, 0.9),
    });
  };
  mkDoor(yDiv + 0.003, H - 0.003, 'Abrir congelador', 'Cerrar congelador', false);
  mkDoor(y0 + 0.003, yDiv - 0.003, 'Abrir nevera', 'Cerrar nevera', true);
  return root;
}

export function tvStand({ width = 1.6 } = {}) {
  const W = width, D = 0.4, H = 0.45, legH = 0.12;
  const root = newRoot('tvStand', W, D, H);
  const S = new Parts();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) S.cyl(0.016, 0.011, legH, M.black, sx * (W / 2 - 0.06), legH / 2, sz * (D / 2 - 0.05), 0, 0, 0, 12);
  }
  S.rbox(W, H - legH, D, 0.008, M.warmWood, 0, legH + (H - legH) / 2, 0, 0, 0, 0, 2);
  for (let i = 1; i < 3; i++) S.box(0.003, H - legH - 0.02, 0.002, M.gap, -W / 2 + (i * W) / 3, legH + (H - legH) / 2, D / 2 + 0.0005);
  S.box(W - 0.04, 0.003, 0.002, M.gap, 0, H - 0.05, D / 2 + 0.0005);
  S.build(root);
  return root;
}

/** TV de 55" sobre patas. Origen = centro bajo las patas (ponerlo sobre tvStand a y=0.45). */
export function tv({ width = 1.23, height = 0.71 } = {}) {
  const W = width, H = height, fy = 0.075;
  const root = newRoot('tv', W, 0.2, H + fy);
  const S = new Parts();
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.15);
    S.rbox(0.25, 0.012, 0.2, 0.004, M.black, x, 0.006, 0, 0, s * 0.35, 0, 1);
    S.rbox(0.02, fy, 0.02, 0.004, M.black, x, fy / 2, 0, 0, 0, 0, 1);
  }
  S.rbox(W, H, 0.03, 0.005, M.black, 0, fy + H / 2, -0.004, 0, 0, 0, 2);
  S.box(W - 0.012, H - 0.012, 0.002, M.screen, 0, fy + H / 2, 0.0115);
  S.build(root);
  return root;
}

/** Panel LED redondo de sobreponer. Origen = punto de anclaje en el techo; mira hacia -Y. */
export function ceilingLight({ diameter = 0.17 } = {}) {
  const r = diameter / 2;
  const root = newRoot('ceilingLight', diameter, diameter, 0.024);
  const S = new Parts();
  S.add(lathe([[0, 0], [r - 0.004, 0], [r, -0.004], [r, -0.018], [r - 0.004, -0.022], [0, -0.022]], 28), M.whiteMatte);
  S.cyl(r - 0.008, r - 0.008, 0.002, M.led, 0, -0.0225, 0, 0, 0, 0, 28);
  S.build(root, { shadow: false });
  return root;
}

// ---------------------------------------------------------------------------
// 8. Piezas de pared (origen = centro de la cara trasera, z=0; miran a +Z)
// ---------------------------------------------------------------------------

/** Toma doble colombiana (NEMA 5-15), placa blanca 0.07 x 0.115 m. Un solo draw call (color por pieza). */
const WALL_AO = { floor: false, height: 0, strength: 0.5 };
const DARK = 0x262524;
export function outlet() {
  const W = 0.07, H = 0.115, D = 0.008;
  const root = newRoot('outlet', W, D + 0.002, H);
  const S = new Parts();
  const P = M.plasticVC;
  S.rbox(W, H, D, 0.003, P, 0, 0, D / 2, 0, 0, 0, 1);
  for (const sy of [-1, 1]) {
    const y = sy * 0.026;
    S.tint(null).add(new THREE.CylinderGeometry(0.0185, 0.0195, 0.002, 24), P, 0, y, D + 0.001, Math.PI / 2, 0, 0);
    S.tint(DARK);
    for (const sx of [-1, 1]) S.box(sx < 0 ? 0.0028 : 0.0022, 0.0075, 0.0006, P, sx * 0.0064, y + 0.003, D + 0.0019);
    S.add(new THREE.CircleGeometry(0.0026, 10), P, 0, y - 0.0085, D + 0.0021);
  }
  S.tint(0xd8d7d3).cyl(0.0025, 0.0025, 0.001, P, 0, 0, D + 0.0003, Math.PI / 2, 0, 0, 8); // tornillo
  S.build(root, { shadow: false, ao: WALL_AO });
  return root;
}

/** Interruptor de tecla(s) blanca(s), placa 0.07 x 0.115 m. gangs = 1..3 teclas lado a lado. */
export function switchPlate({ gangs = 1 } = {}) {
  const W = 0.07, H = 0.115, D = 0.008;
  const n = clamp(Math.round(gangs), 1, 3);
  const root = newRoot('switchPlate', W, D + 0.004, H);
  const S = new Parts();
  const P = M.plasticVC;
  S.rbox(W, H, D, 0.003, P, 0, 0, D / 2, 0, 0, 0, 1);
  const aw = 0.044, ah = 0.07, g = 0.0016;
  S.tint(0x6a6966).box(aw + 0.003, ah + 0.003, 0.0008, P, 0, 0, D + 0.0002);
  const rw = (aw - (n - 1) * g) / n;
  for (let i = 0; i < n; i++) {
    const x = -aw / 2 + rw / 2 + i * (rw + g);
    S.tint(null).rbox(rw, ah, 0.005, 0.0015, P, x, 0, D + 0.0025, 0.05, 0, 0, 1);
    S.tint(0xb9b8b4).box(Math.min(0.004, rw * 0.3), 0.0012, 0.0005, P, x, ah * 0.33, D + 0.0052, 0.05, 0, 0);
  }
  S.build(root, { shadow: false, ao: WALL_AO });
  return root;
}

/** Citófono blanco de pared con auricular colgado y cable en espiral (~0.09 x 0.20 m). */
export function intercom() {
  const W = 0.09, H = 0.2, D = 0.014;
  const root = newRoot('intercom', W, 0.05, H);
  const S = new Parts();
  const P = M.plasticVC;
  S.rbox(W, H, D, 0.009, P, 0, 0, D / 2, 0, 0, 0, 2);
  // auricular
  const hx = -0.012, hz = D + 0.017;
  S.soft(0.048, 0.19, 0.03, 0.013, P, hx, 0.002, hz, 0, 0, 0, {
    seg: 0.04,
    deform: (v, hxh, hy) => {
      const e = (Math.abs(v.y) / hy) ** 2;
      v.x *= 0.72 + 0.4 * e;
      v.z *= 1 + 0.3 * e * e;
    },
  });
  S.tint(DARK);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    S.add(new THREE.CircleGeometry(0.0016, 6), P, hx + Math.cos(a) * 0.009, 0.07 + Math.sin(a) * 0.009, hz + 0.0196);
  }
  S.box(0.06, 0.0012, 0.004, P, -0.012, 0.0, D + 0.0012); // junta auricular/base
  // botones (portería, puerta) y gancho
  S.tint(0xb9b8b4);
  for (const y of [-0.05, -0.075]) S.cyl(0.0055, 0.0055, 0.004, P, 0.031, y, D + 0.002, Math.PI / 2, 0, 0, 14);
  S.rbox(0.008, 0.016, 0.004, 0.0015, P, 0.031, 0.06, D + 0.002, 0, 0, 0, 1);
  // cable en espiral que cuelga
  S.tint(null);
  const a0 = V3(hx, -0.09, hz - 0.004), a1 = V3(0.0, -0.2, 0.022), a2 = V3(0.03, -0.1, 0.008);
  const path = new THREE.QuadraticBezierCurve3(a0, a1, a2);
  const coil = [];
  const turns = 18, steps = turns * 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, c = path.getPoint(t), a = t * turns * Math.PI * 2;
    coil.push(V3(c.x + Math.cos(a) * 0.0045, c.y, c.z + Math.sin(a) * 0.0045));
  }
  S.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), steps, 0.0012, 3), P);
  S.build(root, { shadow: false, ao: WALL_AO });
  return root;
}

/** Alféizar de cuarzo blanco. Origen = centro de la cara trasera (a media altura del espesor de 2 cm). */
export function windowSill({ width = 1.0, depth = 0.12 } = {}) {
  const root = newRoot('windowSill', width, depth, 0.02);
  const S = new Parts();
  S.rbox(width, 0.02, depth, 0.004, M.quartz, 0, 0, depth / 2, 0, 0, 0, 2);
  S.build(root);
  return root;
}
