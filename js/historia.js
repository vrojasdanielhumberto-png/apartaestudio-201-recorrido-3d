// Recorrido con scroll: la página (index.html) tiene una sección .paso por espacio. Mientras la
// persona baja, la cámara pasa por las "tomas" de cada espacio en orden (sin giros automáticos) y
// abre/cierra sola lo importante: puerta de entrada, ventana, gabinetes, closet, balcón.
// También: arrastrar a los lados para mirar (vuelve al centro al bajar), "Ver plano 3D" y "Amoblado".
//
// Cómo armar las tomas de otro apartamento (regla general):
//  - 1 toma de detalle por espacio, a la altura de los ojos, con la tarjeta de texto.
//  - 1 toma amplia por cuarto (no por espacio): centrada, un poco más alta (1.9–2.2 m) y separada
//    de las paredes; si dos espacios comparten cuarto (alcoba + closet, cocina + ropas) van en la misma.
//  - Puntos "via" solo para cruzar puertas sin atravesar muros.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const E = 1.6; // altura de los ojos
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Tomas por sección. hold = qué parte de su tramo se queda quieta antes de seguir (lectura).
// cel / celLook = variante para pantallas angostas (celular).
export const SHOTS = {
  inicio: [{ pos: V(7.7, 7.3, 11.0), look: V(2.4, 0.3, 4.4) }],
  distribucion: [{ pos: V(-1.6, 6.4, 9.0), look: V(2.2, 0, 4.5) }],
  entrada: [
    // afuera, en el pasillo, frente a la puerta: la puerta se abre y entras
    { pos: V(0.55, E, 0.75), look: V(0.55, 1.35, 3.4), via: [V(0.5, 3.4, -0.6)], hold: 0.5 },
    { pos: V(0.65, 1.62, 3.0), look: V(2.7, 1.15, 4.9) },
  ],
  sala: [
    { pos: V(2.95, 1.65, 2.55), look: V(2.5, 1.0, 5.3), cel: V(2.55, 1.75, 2.5), celLook: V(3.15, 0.95, 5.2) },
    // paneo desde la esquina entre la puerta de la alcoba y la sala: comedor y cocina → sofá
    { pos: V(1.6, 2.0, 5.25), posTo: V(1.75, 2.0, 5.05), look: V(3.3, 0.9, 3.2), lookTo: V(0.9, 0.8, 3.4), hold: 0.6,
      cel: V(1.5, 2.05, 5.3), celLook: V(3.0, 0.85, 3.3), celLookTo: V(0.9, 0.75, 3.5) },
  ],
  cocina: [
    { pos: V(2.40, E, 3.40), look: V(4.3, 1.15, 3.35), cel: V(1.70, E, 3.45) },
    // paneo: cocina completa → nevera y lavadora
    { pos: V(1.5, 1.85, 4.9), posTo: V(1.7, 1.85, 4.6), look: V(4.0, 0.95, 3.3), lookTo: V(4.0, 0.95, 2.1), hold: 0.6,
      cel: V(1.35, 1.9, 5.0), celLook: V(3.9, 0.9, 3.2), celLookTo: V(3.9, 0.9, 2.0) },
  ],
  ropas: [{ pos: V(3.00, E, 2.85), look: V(4.3, 0.9, 1.8) }],
  bano: [
    { pos: V(2.95, E, 1.75), look: V(3.45, 0.9, 0.2), cel: V(2.95, 2.05, 1.66), celLook: V(3.5, 0.45, 0.35) },
    // paneo: todo el baño, del lavamanos a la ducha
    { pos: V(2.93, 2.0, 1.62), look: V(2.8, 0.55, 0.3), lookTo: V(3.95, 0.6, 0.5), hold: 0.6 },
  ],
  alcoba: [
    { pos: V(0.45, E, 6.0), look: V(3.2, 1.0, 8.2), cel: V(0.4, 1.95, 5.8), celLook: V(2.6, 0.45, 7.55), via: [V(2.7, E, 2.9), V(1.2, E, 4.8), V(0.55, E, 5.4)] },
    // paneo desde la esquina junto a la cabecera: alcoba completa con closet → balcón
    { pos: V(3.9, 2.1, 6.05), posTo: V(3.75, 2.1, 6.25), look: V(1.9, 0.8, 7.7), lookTo: V(2.9, 0.9, 8.7), hold: 0.6,
      cel: V(3.95, 2.15, 6.0), celLook: V(0.9, 0.9, 8.0), celLookTo: V(2.8, 0.9, 8.8) },
  ],
  closet: [{ pos: V(2.35, E, 6.75), look: V(0.7, 1.1, 8.45) }],
  balcon: [
    { pos: V(2.75, E, 7.75), look: V(3.0, 1.15, 11.0), cel: V(2.55, 1.65, 7.0), celLook: V(3.0, 1.15, 10.5) },
    // afuera, mirando los árboles
    { pos: V(2.9, 1.65, 8.7), look: V(2.6, 1.05, 12.5), cel: V(2.9, 1.6, 8.55), celLook: V(2.6, 1.75, 12.5) },
  ],
  // al salir del balcón la cámara retrocede y sube sin darse la vuelta (sigue mirando hacia el balcón)
  zonas: [{ pos: V(2.2, 7.4, -3.4), look: V(2.2, 0, 5.4), cel: V(2.2, 8.6, -5.0), via: [V(2.9, 1.7, 7.9), V(2.6, E, 6.6), V(2.4, 3.3, 4.2)] }],
  ubicacion: [{ pos: V(2.2, 12.0, -0.6), look: V(2.2, 0, 5.0), cel: V(2.2, 14.5, -2.0) }],
  contacto: [{ pos: V(-3.2, 7.2, -2.2), look: V(2.2, 0.2, 5.0), cel: V(-4.4, 8.6, -3.6) }],
};

// [grupo, desde, hasta] (parte de la sección, 0–1) en que está abierto. Fuera de ese tramo se cierra.
const AUTO = {
  entrada: [['puerta-entrada', 0.06, 1]],
  sala: [['ventana-sala', 0.1, 0.9]],
  cocina: [['cocina-superiores', 0.06, 0.82], ['cocina-inferiores', 0.3, 0.82]],
  alcoba: [['closet', 0.55, 1]],
  closet: [['closet', 0, 0.85]],
  balcon: [['balcon', 0.03, 1]],
};

export function setupHistoria({ camera, renderer, world, apt, parts, onFurnished }) {
  const host = document.getElementById('escena') || document.body;
  host.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';

  const style = document.createElement('style');
  style.textContent = `
    #escena{position:fixed;inset:0;z-index:0}
    /* viñeta suave, como el borde de una foto de cámara */
    #escena::after{content:"";position:absolute;inset:0;pointer-events:none;
      background:radial-gradient(ellipse 85% 80% at 50% 45%, transparent 58%, rgba(40,30,20,.14) 100%)}
    #historia{position:relative;z-index:1;pointer-events:none}
    #historia .tarjeta,#historia a,#historia button,#historia input,#historia [data-interactivo]{pointer-events:auto}
    :root{--alto-paso:170vh}
    html.hs-listo #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel) .tarjeta{
      transition:opacity .28s ease, transform .32s ease}
    #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel):not(.leyendo) .tarjeta{
      opacity:0 !important;pointer-events:none}
    /* las tarjetas de otros espacios se esconden al instante (nunca se ven dos a la vez) */
    #historia:has(.paso.activo) .paso:not(.activo):not(.paso--inicio):not(.paso--panel) .tarjeta{transition:none !important}
    @media (max-width:899px){
      /* En celular las tarjetas quedan fijas en pantalla: no se mueven con el scroll, solo cambian */
      #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel) .tarjeta{
        position:fixed;left:max(12px,env(safe-area-inset-left,0px));right:max(12px,env(safe-area-inset-right,0px));
        width:auto;top:auto;bottom:calc(var(--nav-h) + var(--seg-abajo) + 10px);z-index:5;transform:translateY(12px)}
      #historia:has(.paso.activo) .paso.leyendo:not(.paso--inicio):not(.paso--panel) .tarjeta{transform:none}
    }
    @media (min-width:900px){
      #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel):not(.leyendo) .tarjeta{transform:translateX(-14px)}
    }
    .hs-sigue{position:fixed;left:50%;bottom:calc(var(--nav-h, 56px) + env(safe-area-inset-bottom,0px) + 18px);z-index:6;
      display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;pointer-events:none;
      font:600 13px/1 Inter,system-ui,sans-serif;color:#fff;background:rgba(24,24,26,.82);
      box-shadow:0 6px 18px rgba(0,0,0,.18);opacity:0;transform:translate(-50%,8px);transition:opacity .35s, transform .35s}
    .hs-sigue.on{opacity:1;transform:translate(-50%,0)}
    .hs-sigue svg{animation:hs-baja 1.2s ease-in-out infinite}
    @keyframes hs-baja{0%,100%{transform:translateY(-2px)}50%{transform:translateY(3px)}}
    @media (min-width:900px){.hs-sigue{left:calc(50% + 210px)}}
    @media (max-width:899px){body:has(.paso.leyendo:not(.paso--inicio):not(.paso--panel)) .hs-sigue{bottom:auto;top:calc(var(--barra-h, 56px) + env(safe-area-inset-top,0px) + 12px)}}
    @media (prefers-reduced-motion:reduce){.hs-sigue svg{animation:none}}
    .hs-cinta{display:none}
    @media (max-width:899px){
      .hs-cinta{display:block;position:fixed;right:5px;width:4px;z-index:6;pointer-events:none;border-radius:4px;
        top:calc(var(--barra-h, 56px) + env(safe-area-inset-top,0px) + 14px);
        bottom:calc(var(--nav-h, 56px) + env(safe-area-inset-bottom,0px) + 16px);background:rgba(30,30,32,.16)}
      .hs-cinta-llena{position:absolute;inset:0;border-radius:4px;background:rgba(30,30,32,.78);transform-origin:top;transform:scaleY(0)}
      .hs-cinta b{position:absolute;left:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;
        background:#fff;box-shadow:0 0 0 1.5px rgba(30,30,32,.35)}
      .hs-cinta b.on{background:rgba(30,30,32,.85);box-shadow:0 0 0 1.5px #fff}
    }`;
  document.head.appendChild(style);
  // las transiciones de las tarjetas se activan después de cargar (si no, se ven un instante todas juntas)
  setTimeout(() => document.documentElement.classList.add('hs-listo'), 900);

  // ---------- Secciones y tomas ----------
  const sections = [...document.querySelectorAll('#historia .paso')].filter((s) => SHOTS[s.dataset.paso]);
  const keys = sections.map((s) => s.dataset.paso);
  const easeK = (t) => t * t * (3 - 2 * t);
  let segs = [], kf = [];
  const kfStart = [];
  function shotFor(sh, portrait) {
    let pos = portrait && sh.cel ? sh.cel : sh.pos;
    if (portrait && !sh.cel && pos.y > 2.5) pos = sh.look.clone().addScaledVector(pos.clone().sub(sh.look), 1.55);
    const look = (portrait && sh.celLook) || sh.look;
    const posTo = (portrait && sh.cel) ? (sh.celPosTo || pos) : (sh.posTo || pos);
    const lookTo = (portrait && sh.celLookTo) || sh.lookTo || look;
    return { pos, look, posTo, lookTo, via: sh.via, hold: sh.hold };
  }
  function buildSegs(portrait) {
    kf = [];
    keys.forEach((k, i) => {
      kfStart[i] = kf.length;
      for (const sh of SHOTS[k]) kf.push(shotFor(sh, portrait));
    });
    segs = kf.slice(0, -1).map((a, j) => {
      const b = kf[j + 1];
      const pts = [a.posTo, ...(b.via || []), b.pos];
      return { curve: pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : new THREE.LineCurve3(pts[0], pts[1]), a, b };
    });
  }
  // (sección i, avance u de 0 a 1) → q. Cada toma j ocupa [2j, 2j+2): de 2j a 2j+1 se queda
  // (o hace su paneo suave) y de 2j+1 a 2j+2 viaja a la siguiente toma.
  function kfParam(i, u) {
    const m = SHOTS[keys[i]].length, slot = 1 / m;
    const k = Math.min(m - 1, Math.floor(u / slot));
    const t = (u - k * slot) / slot;
    const j = kfStart[i] + k;
    const h = kf[j]?.hold ?? (k === 0 ? 0.3 : 0.25);
    const q = 2 * j + (t < h ? t / h : 1 + easeK((t - h) / (1 - h)));
    return Math.min(q, 2 * (kf.length - 1) + 1);
  }

  // ---------- Qué se abre solo ----------
  const inter = (root) => { const out = []; root?.traverse((o) => { if (o.userData.interactive && o.userData.toggle) out.push(o); }); return out; };
  const isOpen = (o) => o.userData._closedLabel !== undefined && o.userData.getLabel() !== o.userData._closedLabel;
  const wy = new THREE.Vector3();
  const kitchenAll = inter(parts.kitchen);
  const cy = (o) => new THREE.Box3().setFromObject(o).getCenter(wy).y; // el pivote está en el piso: se usa el centro
  const GROUPS = {
    'puerta-entrada': inter(parts.entryDoor),
    'ventana-sala': inter(parts.salaWindow),
    'cocina-superiores': kitchenAll.filter((o) => cy(o) > 1.3),
    'cocina-inferiores': kitchenAll.filter((o) => cy(o) <= 1.3),
    closet: inter(parts.closet).filter((o) => /closet/i.test(o.userData.getLabel())),
    balcon: inter(parts.balconyDoor),
  };
  Object.values(GROUPS).flat().forEach((o) => { if (o.userData._closedLabel === undefined) o.userData._closedLabel = o.userData.getLabel(); });
  // Lo que se pide abrir/cerrar se revisa al momento de ejecutarlo (si se baja y se sube rápido,
  // nada queda abierto por una orden vieja). Además, cada medio segundo se reconcilia todo.
  const desired = {};
  const setOpen = (id, open) => {
    desired[id] = open;
    (GROUPS[id] || []).forEach((o, i) => setTimeout(() => {
      if (desired[id] === open && isOpen(o) !== open) o.userData.toggle();
    }, i * 90));
  };
  let reconT = 0;
  function reconcile(dt) {
    reconT += dt;
    if (reconT < 0.6) return;
    reconT = 0;
    for (const id of Object.keys(GROUPS)) {
      const d = !!desired[id];
      for (const o of GROUPS[id]) if (isOpen(o) !== d) o.userData.toggle();
    }
  }
  const autoState = {};
  function autoOpen(key, u) {
    const want = {};
    for (const [id, from, to] of AUTO[key] || []) want[id] = want[id] || (u >= from && u < to);
    for (const id of Object.keys(GROUPS)) {
      const w = !!want[id];
      if (autoState[id] !== w && (w || autoState[id])) setOpen(id, w);
      autoState[id] = w;
    }
  }

  // ---------- Botones de la página ----------
  document.addEventListener('click', (e) => {
    const ir = e.target.closest('[data-ir]');
    if (ir) {
      const sec = document.getElementById(ir.dataset.ir);
      if (sec) { e.preventDefault(); exitPlanta(); sec.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    }
    const cta = e.target.closest('a[href^="#"]:not([data-ir])');
    if (cta && cta.getAttribute('href').length > 1) {
      const t = document.getElementById(cta.getAttribute('href').slice(1));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => t.focus?.({ preventScroll: true }), 600); }
    }
    const ac = e.target.closest('[data-accion]');
    if (ac) {
      if (ac.dataset.accion === 'planta') { planta ? exitPlanta() : enterPlanta(); }
      if (ac.dataset.accion === 'amoblado') {
        const on = ac.getAttribute('aria-pressed') !== 'true';
        document.querySelectorAll('[data-accion="amoblado"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
        onFurnished(on);
      }
    }
  });

  // ---------- Vista libre "plano 3D" ----------
  let planta = false;
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false;
  orbit.enableDamping = true;
  orbit.target.set(2.2, 0, 4.6);
  orbit.minDistance = 4; orbit.maxDistance = 22;
  orbit.maxPolarAngle = Math.PI * 0.42;
  orbit.enablePan = false;
  // OrbitControls bloquea el scroll táctil sobre el lienzo al crearse: se devuelve el permiso
  canvas.style.touchAction = 'pan-y';
  function enterPlanta() {
    planta = true;
    orbit.enabled = true;
    camera.position.set(2.2 + 6, 10, 4.6 + 8);
    orbit.target.set(2.2, 0, 4.6);
    orbit.update();
    canvas.style.touchAction = 'none';
    document.querySelectorAll('[data-accion="planta"]').forEach((b) => b.setAttribute('aria-pressed', 'true'));
  }
  function exitPlanta() {
    if (!planta) return;
    planta = false;
    orbit.enabled = false;
    canvas.style.touchAction = 'pan-y';
    document.querySelectorAll('[data-accion="planta"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }

  // ---------- Mirar a los lados arrastrando (vuelve al centro al bajar) ----------
  let yaw = 0, yawTarget = 0, usedLook = false;
  const drag = { id: null, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => { drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; });
  canvas.addEventListener('pointermove', (e) => {
    // con el dedo, el movimiento vertical es scroll (lo maneja el navegador) y el horizontal mira a los lados
    if (drag.id !== e.pointerId || planta) return;
    if (e.pointerType !== 'mouse' && Math.abs(e.clientX - drag.x) < Math.abs(e.clientY - drag.y)) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX; drag.y = e.clientY;
    yawTarget = THREE.MathUtils.clamp(yawTarget + dx * (e.pointerType === 'mouse' ? 0.006 : 0.009), -1.3, 1.3);
    usedLook = true;
  });
  canvas.addEventListener('pointerup', () => { drag.id = null; });
  canvas.addEventListener('pointercancel', () => { drag.id = null; });

  // ---------- Tamaño y encuadre (en celular el 3D se ve arriba; en PC a la derecha de las tarjetas) ----------
  let lastW = 0, lastH = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && w === lastW && Math.abs(h - lastH) < 220) return; // solo se movió la barra del navegador
    lastW = w; lastH = h;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 78 : w / h < 1.2 ? 66 : 58;
    if (w < 900) camera.setViewOffset(w, h, 0, Math.round(h * 0.17), w, h);
    else camera.setViewOffset(w, h, -Math.round(Math.min(230, w * 0.16)), 0, w, h);
    camera.updateProjectionMatrix();
    buildSegs(w / h < 0.8);
  }
  addEventListener('resize', resize);
  resize();

  // ---------- Progreso de scroll ----------
  let s = 0, active = -1, current = 0, localU = 0;
  function scrollParam() {
    const line = innerHeight * 0.5;
    for (let i = 0; i < sections.length; i++) {
      const r = sections[i].getBoundingClientRect();
      if (line >= r.top && line < r.bottom) {
        current = i;
        localU = (line - r.top) / Math.max(1, r.height);
        return kfParam(i, localU);
      }
    }
    current = sections.length && sections[0].getBoundingClientRect().top > line ? 0 : sections.length - 1;
    localU = current === 0 ? 0 : 0.999;
    return kfParam(current, localU);
  }
  let navPending = null, lastScrollT = 0;
  addEventListener('scroll', () => { lastScrollT = performance.now(); }, { passive: true });
  function centerNav() {
    if (!navPending || performance.now() - lastScrollT < 300) return;
    const b = navPending, fila = b.parentElement;
    navPending = null;
    if (fila && fila.scrollWidth > fila.clientWidth) fila.scrollTo({ left: b.offsetLeft - fila.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
  }
  function setActive(i) {
    if (i === active) return;
    const key = keys[i];
    sections.forEach((sec, k) => sec.classList.toggle('activo', k === i));
    document.querySelectorAll('#espacios [data-ir]').forEach((b) => {
      if (b.dataset.ir === key) { b.setAttribute('aria-current', 'true'); navPending = b; }
      else b.removeAttribute('aria-current');
    });
    // En la lista de áreas se resalta el espacio que se está viendo
    const zona = { cocina: 'sala', sala: 'sala', alcoba: 'alcoba', closet: 'closet', balcon: 'balcon', bano: 'bano', ropas: 'ropas' }[key];
    document.querySelectorAll('.areas [data-zona]').forEach((r) => r.classList.toggle('activa', r.dataset.zona === zona));
    active = i;
  }
  const look = new THREE.Vector3();
  function poseAt(q) {
    const j = Math.max(0, Math.min(Math.floor(q / 2), kf.length - 1));
    const r = q - 2 * j;
    if (r < 1 || j >= segs.length) {
      const t = easeK(THREE.MathUtils.clamp(r, 0, 1)), k = kf[j];
      camera.position.lerpVectors(k.pos, k.posTo, t);
      return look.lerpVectors(k.look, k.lookTo, t);
    }
    const t = THREE.MathUtils.clamp(r - 1, 0, 1), sg = segs[j];
    sg.curve.getPoint(t, camera.position);
    return look.lerpVectors(sg.a.lookTo, sg.b.look, easeK(t));
  }

  // ---------- Aviso "Sigue bajando" ----------
  const sigue = document.createElement('div');
  sigue.className = 'hs-sigue';
  sigue.setAttribute('aria-hidden', 'true');
  sigue.innerHTML = '<span>Sigue bajando</span><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(sigue);
  let lastY = scrollY, idle = 0, sigueOn = false, sigueTxt = 'Sigue bajando';
  function hint(dt) {
    if (Math.abs(scrollY - lastY) > 2) { idle = 0; lastY = scrollY; } else idle += dt;
    const fin = keys[current] === 'contacto' || keys[current] === 'ubicacion';
    const m = SHOTS[keys[current]].length;
    const enAmplia = m > 1 && localU > 1 / m && camera.position.y < 2.45;
    const texto = enAmplia && !usedLook && matchMedia('(pointer: coarse)').matches ? 'Desliza a los lados para mirar' : 'Sigue bajando';
    if (texto !== sigueTxt) { sigueTxt = texto; sigue.firstChild.textContent = texto; }
    const on = !planta && !fin && idle > 1.3;
    if (on !== sigueOn) { sigueOn = on; sigue.classList.toggle('on', on); }
  }

  // Cinta lateral: muestra en qué parte del recorrido vas y cuánto falta
  const cintaEl = document.createElement('div');
  cintaEl.className = 'hs-cinta';
  cintaEl.setAttribute('aria-hidden', 'true');
  cintaEl.innerHTML = '<i class="hs-cinta-llena"></i>' + sections.map(() => '<b></b>').join('');
  document.body.appendChild(cintaEl);
  const llena = cintaEl.querySelector('.hs-cinta-llena');
  const puntos = [...cintaEl.querySelectorAll('b')];
  let cintaMax = 1, lastProg = -1, lastPunto = -1;
  function medirCinta() {
    cintaMax = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    sections.forEach((sec, k) => { puntos[k].style.top = (100 * Math.min(1, sec.offsetTop / cintaMax)).toFixed(2) + '%'; });
  }
  addEventListener('resize', medirCinta);
  addEventListener('load', medirCinta);
  setTimeout(medirCinta, 1200);
  medirCinta();
  function cinta() {
    const prog = Math.min(1, Math.max(0, scrollY / cintaMax));
    if (Math.abs(prog - lastProg) > 0.001) { lastProg = prog; llena.style.transform = 'scaleY(' + prog.toFixed(4) + ')'; }
    if (current !== lastPunto) { puntos.forEach((p, k) => p.classList.toggle('on', k <= current)); lastPunto = current; }
  }

  const lamps = []; world.traverse((o) => { if (o.userData.lamparaTecho) lamps.push(o); });
  const UP = new THREE.Vector3(0, 1, 0);
  let first = true, lastLeyendo = null, lastLeyIdx = -1;
  return {
    update(dt) {
      if (planta) {
        orbit.update();
        apt.ceilings.visible = apt.surroundings.visible = false;
        for (const l of lamps) l.visible = false;
        return;
      }
      const target = scrollParam();
      s = first ? target : s + (target - s) * (1 - Math.exp(-7 * dt));
      if (Math.abs(target - s) < 0.0004) s = target; // se detiene del todo: permite la imagen nítida en reposo
      first = false;
      setActive(current);
      if (Math.abs(target - s) > 0.02) yawTarget *= Math.exp(-3 * dt); // al bajar, la mirada vuelve al frente
      yaw += (yawTarget - yaw) * (1 - Math.exp(-8 * dt));
      if (Math.abs(yawTarget - yaw) < 0.0005) yaw = yawTarget;
      if (Math.abs(yawTarget) < 0.0005) yawTarget = 0;
      const lk = poseAt(s);
      autoOpen(keys[current], localU);
      reconcile(dt);
      cinta();
      // la tarjeta se ve en la primera toma de cada espacio y se esconde en la vista amplia
      const m = SHOTS[keys[current]].length;
      const leyendo = m > 1 ? localU < 0.55 / m : localU < 0.62;
      if (leyendo !== lastLeyendo || current !== lastLeyIdx) {
        sections.forEach((sec, k) => sec.classList.toggle('leyendo', k === current && leyendo));
        lastLeyendo = leyendo; lastLeyIdx = current;
      }
      hint(dt);
      centerNav();
      camera.lookAt(lk);
      if (Math.abs(yaw) > 1e-4) camera.rotateOnWorldAxis(UP, yaw);
      // techos y exterior se esconden cuando la cámara está por encima (vista de maqueta)
      const above = camera.position.y > 2.45;
      apt.ceilings.visible = !above;
      apt.surroundings.visible = !above;
      for (const l of lamps) l.visible = !above;
    },
  };
}
