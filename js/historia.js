// Recorrido con scroll: la página (index.html) tiene una sección .paso por espacio. Mientras la
// persona baja, la cámara vuela de un espacio al siguiente y abre sola lo importante (closet,
// gabinetes, puerta del balcón). También: tocar objetos para abrirlos, arrastrar para mirar a los
// lados, botón "Ver plano 3D" (vista libre desde arriba) y botón "Amoblado".
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { findInteractive } from './anim.js';

const E = 1.6; // altura de los ojos
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Pose de la cámara por sección. via = puntos intermedios para no atravesar muros al llegar.
export const STOPS = {
  inicio:       { pos: V(7.7, 7.3, 11.0), look: V(2.4, 0.3, 4.4) },
  distribucion: { pos: V(-1.6, 6.4, 9.0), look: V(2.2, 0, 4.5) },
  entrada:      { pos: V(0.55, E, 2.75), look: V(3.0, 1.3, 4.8), via: [V(0.6, 4.0, 3.2)], wide: { pos: V(2.1, 2.2, 5.25), look: V(0.9, 0.9, 2.35) } },
  // sala: sofá, comedor y la ventana (que se abre sola) en la misma vista
  sala:         { pos: V(2.95, 1.65, 2.55), look: V(2.5, 1.0, 5.3), cel: V(2.55, 1.75, 2.5), celLook: V(3.15, 0.95, 5.2), wide: { pos: V(4.0, 2.2, 5.25), look: V(0.6, 0.7, 3.6) } },
  cocina:       { pos: V(2.40, E, 3.40), look: V(4.3, 1.15, 3.35), cel: V(1.70, E, 3.45), wide: { pos: V(0.7, 2.15, 5.15), look: V(4.0, 0.9, 2.9) } },
  ropas:        { pos: V(3.00, E, 2.85), look: V(4.3, 0.9, 1.8), wide: { pos: V(2.75, 2.1, 3.95), look: V(3.7, 0.8, 1.5) } },
  bano:         { pos: V(2.95, E, 1.75), look: V(3.45, 0.9, 0.2), cel: V(2.95, 2.05, 1.66), celLook: V(3.5, 0.45, 0.35), wide: { pos: V(2.92, 2.3, 1.95), look: V(3.45, 0.3, 0.45) } },
  alcoba:       { pos: V(0.45, E, 6.0), look: V(3.2, 1.0, 8.2), cel: V(0.4, 1.95, 5.8), celLook: V(2.6, 0.45, 7.55), via: [V(2.7, E, 2.9), V(1.2, E, 4.8), V(0.55, E, 5.4)], wide: { pos: V(0.45, 2.25, 7.95), look: V(3.0, 0.55, 6.3) } },
  closet:       { pos: V(2.35, E, 6.75), look: V(0.7, 1.1, 8.45), wide: { pos: V(3.7, 2.1, 6.1), look: V(0.9, 0.9, 8.4) } },
  balcon:       { pos: V(2.75, E, 7.75), look: V(3.0, 1.15, 11.0), cel: V(2.55, 1.65, 7.0), celLook: V(3.0, 1.15, 10.5), wide: { pos: V(3.45, 1.75, 8.85), look: V(1.4, 0.6, 9.1) } },
  // al salir del balcón la cámara retrocede y sube sin darse la vuelta (sigue mirando hacia el balcón)
  zonas:        { pos: V(2.2, 7.4, -3.4), look: V(2.2, 0, 5.4), cel: V(2.2, 8.6, -5.0), via: [V(3.0, 1.7, 7.9), V(2.6, E, 6.6), V(2.4, 3.3, 4.2)] },
  ubicacion:    { pos: V(2.2, 12.0, -0.6), look: V(2.2, 0, 5.0), cel: V(2.2, 14.5, -2.0) },
  contacto:     { pos: V(-3.2, 7.2, -2.2), look: V(2.2, 0.2, 5.0), cel: V(-4.4, 8.6, -3.6) },
};

export function setupHistoria({ camera, renderer, scene, world, apt, parts, onFurnished }) {
  const host = document.getElementById('escena') || document.body;
  host.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.touchAction = 'pan-y';       // el dedo vertical hace scroll de la página
  canvas.style.display = 'block';

  // La historia deja pasar los toques al 3D salvo en tarjetas, botones y enlaces
  const style = document.createElement('style');
  style.textContent = `
    #escena{position:fixed;inset:0;z-index:0}
    #historia{position:relative;z-index:1;pointer-events:none}
    #historia .tarjeta,#historia a,#historia button,#historia input,#historia [data-interactivo]{pointer-events:auto}
    .hs-punto{position:fixed;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;
      border:0;padding:0;background:transparent;cursor:pointer;z-index:2;display:none}
    .hs-punto::before{content:"";position:absolute;inset:9px;border-radius:50%;background:#fff;
      box-shadow:0 1px 6px rgba(0,0,0,.35)}
    .hs-punto::after{content:"";position:absolute;inset:4px;border-radius:50%;border:2px solid rgba(255,255,255,.85);
      animation:hs-pulso 1.8s ease-out infinite}
    .hs-punto:focus-visible{outline:2px solid #fff;outline-offset:2px}
    @keyframes hs-pulso{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.5);opacity:0}}
    @media (prefers-reduced-motion:reduce){.hs-punto::after{animation:none}}
    .hs-tip{position:fixed;z-index:3;pointer-events:none;padding:5px 9px;border-radius:8px;font:500 12px/1.2 Inter,system-ui,sans-serif;
      background:rgba(20,20,22,.82);color:#fff;transform:translate(12px,12px);display:none;white-space:nowrap}
    :root{--alto-paso:170vh}
    html.hs-listo #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel) .tarjeta{
      transition:opacity .28s ease, transform .32s ease}
    #historia:has(.paso.activo) .paso:not(.paso--inicio):not(.paso--panel):not(.leyendo) .tarjeta{
      opacity:0 !important;pointer-events:none}
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
    @media (prefers-reduced-motion:reduce){.hs-sigue svg{animation:none}}`;
  document.head.appendChild(style);
  // las transiciones de las tarjetas se activan después de cargar (si no, se ven un instante todas juntas)
  setTimeout(() => document.documentElement.classList.add('hs-listo'), 900);

  // ---------- Secciones ----------
  const sections = [...document.querySelectorAll('#historia .paso')].filter((s) => STOPS[s.dataset.paso]);
  const keys = sections.map((s) => s.dataset.paso);
  // Curva por tramo (i → i+1) con puntos intermedios. En pantallas angostas (celular) las vistas
  // de maqueta se alejan y algunas paradas usan una posición propia (cel) para que quepa el espacio.
  let segs = [];
  function stopFor(k, portrait) {
    const st = STOPS[k];
    let pos = portrait && st.cel ? st.cel : st.pos;
    if (portrait && !st.cel && pos.y > 2.5) pos = st.look.clone().addScaledVector(pos.clone().sub(st.look), 1.55);
    return { pos, look: (portrait && st.celLook) || st.look, via: st.via };
  }
  // Cada espacio tiene dos fotogramas: A (detalle, con la tarjeta de texto) y W (vista amplia, sin texto)
  const kfStart = [], hasWide = keys.map((k) => !!STOPS[k].wide);
  function buildSegs(portrait) {
    const kf = [];
    keys.forEach((k, i) => {
      kfStart[i] = kf.length;
      kf.push(stopFor(k, portrait));
      if (STOPS[k].wide) kf.push({ pos: STOPS[k].wide.pos, look: STOPS[k].wide.look });
    });
    segs = kf.slice(0, -1).map((a, j) => {
      const b = kf[j + 1];
      const pts = [a.pos, ...(b.via || []), b.pos];
      return { curve: pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : new THREE.LineCurve3(pts[0], pts[1]), a, b };
    });
  }
  // (sección i, avance u de 0 a 1) → posición en los fotogramas. Casi siempre hay algo moviéndose.
  const easeK = (t) => t * t * (3 - 2 * t);
  const SWEEP = 0.6; // radianes (~34°) hacia cada lado en la vista amplia
  let sweep = 0, sweepS = 0;
  function kfParam(i, u) {
    const A = kfStart[i];
    let p;
    sweep = 0;
    if (hasWide[i]) {
      if (u < 0.16) p = A;
      else if (u < 0.4) p = A + easeK((u - 0.16) / 0.24);
      else if (u < 0.7) {
        p = A + 1;
        // la cámara mira a un lado y al otro, y vuelve al centro
        sweep = SWEEP * Math.sin(2 * Math.PI * ((u - 0.4) / 0.3));
      } else p = A + 1 + easeK((u - 0.7) / 0.3);
    } else p = A + easeK(THREE.MathUtils.clamp((u - 0.2) / 0.8, 0, 1));
    return Math.min(p, segs.length);
  }

  // ---------- Qué se abre solo en cada sección ----------
  const inter = (root) => { const out = []; root?.traverse((o) => { if (o.userData.interactive && o.userData.toggle) out.push(o); }); return out; };
  const isOpen = (o) => o.userData.getLabel && o.userData._closedLabel !== undefined && o.userData.getLabel() !== o.userData._closedLabel;
  const prime = (list) => list.forEach((o) => { if (o.userData._closedLabel === undefined) o.userData._closedLabel = o.userData.getLabel(); });
  const wy = new THREE.Vector3();
  const kitchenAll = inter(parts.kitchen);
  const cy = (o) => new THREE.Box3().setFromObject(o).getCenter(wy).y; // el pivote está en el piso: se usa el centro
  const kitchenUpper = kitchenAll.filter((o) => cy(o) > 1.3);
  const kitchenLower = kitchenAll.filter((o) => cy(o) <= 1.3);
  const GROUPS = {
    closet: inter(parts.closet).filter((o) => /closet/i.test(o.userData.getLabel())),
    'cocina-superiores': kitchenUpper,
    'cocina-inferiores': kitchenLower,
    'ventana-sala': inter(parts.salaWindow),
    balcon: inter(parts.balconyDoor),
    'puerta-bano': inter(parts.bathDoor),
  };
  Object.values(GROUPS).forEach(prime);
  const setOpen = (id, open) => (GROUPS[id] || []).forEach((o, i) => {
    if (isOpen(o) !== open) setTimeout(() => o.userData.toggle(), i * 90);
  });
  const toggleGroup = (id) => { const g = GROUPS[id] || []; setOpen(id, !(g.length && isOpen(g[0]))); };
  // [grupo, desde qué parte de la sección se abre]. Al salir de la sección se cierra.
  const AUTO = {
    sala: [['ventana-sala', 0.12]],
    cocina: [['cocina-superiores', 0.1], ['cocina-inferiores', 0.42]],
    closet: [['closet', 0.1]],
    balcon: [['balcon', 0.08]],
  };
  const autoState = {};
  function autoOpen(key, u) {
    const want = {};
    for (const [id, from] of AUTO[key] || []) want[id] = u >= from;
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
    const ab = e.target.closest('[data-abrir]');
    if (ab) { e.preventDefault(); toggleGroup(ab.dataset.abrir); }
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

  // ---------- Mirar a los lados arrastrando ----------
  let yaw = 0, yawTarget = 0, usedLook = false;
  const drag = { id: null, x: 0, y: 0, moved: 0, t: 0 };
  canvas.addEventListener('pointerdown', (e) => { drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0; drag.t = performance.now(); });
  canvas.addEventListener('pointermove', (e) => {
    hover(e);
    // con el dedo, el movimiento vertical es scroll (lo maneja el navegador) y el horizontal mira a los lados
    if (drag.id !== e.pointerId || planta) return;
    if (e.pointerType !== 'mouse' && Math.abs(e.clientX - drag.x) < Math.abs(e.clientY - drag.y)) return;
    const dx = e.clientX - drag.x;
    drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    yawTarget = THREE.MathUtils.clamp(yawTarget + dx * (e.pointerType === 'mouse' ? 0.006 : 0.009), -1.3, 1.3);
    usedLook = true;
  });
  const endDrag = (e) => {
    if (drag.id !== e.pointerId) return;
    drag.id = null;
    if (drag.moved < 8 && performance.now() - drag.t < 400) tap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { drag.id = null; });

  // ---------- Tocar objetos ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(world, true);
    for (const h of hits) {
      if (!visibleChain(h.object)) continue;
      const m = h.object.material;
      if (m && m.transparent && m.opacity < 0.35 && !findInteractive(h.object)) continue; // vidrio
      const it = findInteractive(h.object);
      return it && (planta || h.distance < 5) ? it : null;
    }
    return null;
  }
  function tap(x, y) { const it = pick(x, y); if (it) it.userData.toggle(); }
  const tip = document.createElement('div'); tip.className = 'hs-tip'; document.body.appendChild(tip);
  let hoverT = 0;
  function hover(e) {
    if (e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - hoverT < 60) return;
    hoverT = now;
    const it = pick(e.clientX, e.clientY);
    canvas.style.cursor = it ? 'pointer' : '';
    tip.style.display = it ? 'block' : 'none';
    if (it) { tip.textContent = it.userData.getLabel(); tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; }
  }
  const visibleChain = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

  // ---------- Puntos que invitan a tocar (solo lo importante) ----------
  const spotTargets = [
    ...GROUPS.closet.slice(0, 1), ...kitchenUpper, ...kitchenLower, ...GROUPS['ventana-sala'],
    ...GROUPS.balcon.slice(0, 1), ...inter(parts.bathDoor), ...inter(parts.bedDoor),
    ...inter(parts.closet).filter((o) => !GROUPS.closet.includes(o)),
  ];
  const spots = spotTargets.map((o) => {
    const b = document.createElement('button');
    b.className = 'hs-punto';
    b.type = 'button';
    b.addEventListener('click', () => o.userData.toggle());
    document.body.appendChild(b);
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    return { o, b, c, vis: false, occluded: false };
  });
  let rr = 0;
  const pv = new THREE.Vector3(), dir = new THREE.Vector3();
  function updateSpots() {
    const show = !planta && camera.position.y < 2.4;
    for (let k = 0; k < 2 && spots.length; k++) {   // 2 pruebas de oclusión por cuadro
      const s = spots[rr++ % spots.length];
      dir.subVectors(s.c, camera.position);
      const d = dir.length();
      ray.set(camera.position, dir.normalize());
      ray.far = d;
      const h = ray.intersectObject(world, true).find((x) => visibleChain(x.object) && !(x.object.material?.transparent && x.object.material.opacity < 0.35));
      ray.far = Infinity;
      s.occluded = !!h && findInteractive(h.object) !== s.o && h.distance < d - 0.12;
    }
    for (const s of spots) {
      s.b.setAttribute('aria-label', s.o.userData.getLabel());
      pv.copy(s.c).project(camera);
      const d = camera.position.distanceTo(s.c);
      const on = show && !s.occluded && pv.z < 1 && Math.abs(pv.x) < 0.95 && Math.abs(pv.y) < 0.92 && d < 4.2 && visibleChain(s.o);
      if (on !== s.vis) { s.b.style.display = on ? 'block' : 'none'; s.vis = on; }
      if (on) s.b.style.transform = `translate(${((pv.x + 1) / 2) * innerWidth}px, ${((1 - pv.y) / 2) * innerHeight}px)`;
    }
  }

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

  // ---------- Progreso de scroll → posición de cámara ----------
  let s = 0, active = -1;
  const look = new THREE.Vector3(), lookA = new THREE.Vector3(), lookB = new THREE.Vector3();
  const ease = (t) => t * t * (3 - 2 * t);
  let current = 0, localU = 0;
  function scrollParam() {
    const line = innerHeight * 0.5;
    for (let i = 0; i < sections.length; i++) {
      const r = sections[i].getBoundingClientRect();
      if (line >= r.top && line < r.bottom) {
        current = i;
        const u = (line - r.top) / Math.max(1, r.height);
        localU = u;
        return kfParam(i, u);
      }
    }
    current = sections.length && sections[0].getBoundingClientRect().top > line ? 0 : sections.length - 1;
    localU = current === 0 ? 0 : 1;
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
      if (b.dataset.ir === key) {
        b.setAttribute('aria-current', 'true');
        navPending = b; // se centra en la barra cuando el scroll se detenga
      } else b.removeAttribute('aria-current');
    });
    // En la lista de áreas se resalta el espacio que se está viendo
    const zona = { cocina: 'sala', sala: 'sala', alcoba: 'alcoba', closet: 'closet', balcon: 'balcon', bano: 'bano', ropas: 'ropas' }[key];
    document.querySelectorAll('.areas [data-zona]').forEach((r) => r.classList.toggle('activa', r.dataset.zona === zona));
    active = i;
  }
  function poseAt(p) {
    const i = Math.max(0, Math.min(Math.floor(p), segs.length - 1)), t = THREE.MathUtils.clamp(p - i, 0, 1);
    if (!segs.length) { camera.position.copy(STOPS[keys[0]].pos); return look.copy(STOPS[keys[0]].look); }
    const sg = segs[Math.max(0, i)];
    sg.curve.getPoint(t, camera.position);
    // la mirada cambia más tarde que la posición: llega mirando hacia adelante
    lookA.copy(sg.a.look); lookB.copy(sg.b.look);
    return look.lerpVectors(lookA, lookB, ease(t));
  }

  // Los botones "Abrir…" muestran si lo suyo está abierto
  const chips = [...document.querySelectorAll('[data-abrir]')];
  let chipT = 0;
  function syncChips(dt) {
    chipT += dt;
    if (chipT < 0.25) return;
    chipT = 0;
    for (const c of chips) { const g = GROUPS[c.dataset.abrir] || []; c.setAttribute('aria-pressed', String(!!(g.length && isOpen(g[0])))); }
  }

  const dirV = new THREE.Vector3();
  const lamps = []; world.traverse((o) => { if (o.userData.lamparaTecho) lamps.push(o); });
  // Aviso "Sigue bajando": aparece si la persona deja de bajar un momento
  const sigue = document.createElement('div');
  sigue.className = 'hs-sigue';
  sigue.setAttribute('aria-hidden', 'true');
  sigue.innerHTML = '<span>Sigue bajando</span><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(sigue);
  let lastY = scrollY, idle = 0, sigueOn = false, sigueTxt = 'Sigue bajando';
  function hint(dt) {
    if (Math.abs(scrollY - lastY) > 2) { idle = 0; lastY = scrollY; } else idle += dt;
    const fin = keys[current] === 'contacto' || keys[current] === 'ubicacion';
    const enAmplia = hasWide[current] && localU > 0.4 && localU < 0.7;
    const texto = enAmplia && !usedLook && matchMedia('(pointer: coarse)').matches ? 'Desliza a los lados para mirar' : 'Sigue bajando';
    if (texto !== sigueTxt) { sigueTxt = texto; sigue.firstChild.textContent = texto; }
    const on = !planta && !fin && idle > 1.3;
    if (on !== sigueOn) { sigueOn = on; sigue.classList.toggle('on', on); }
  }

  let first = true, lastLeyendo = null, lastLeyIdx = -1;
  return {
    update(dt) {
      if (planta) {
        orbit.update();
        apt.ceilings.visible = apt.surroundings.visible = false;
        updateSpots();
        syncChips(dt);
        return;
      }
      const target = scrollParam();
      s = first ? target : s + (target - s) * (1 - Math.exp(-7 * dt));
      first = false;
      setActive(current);
      if (Math.abs(target - s) > 0.02) yawTarget *= Math.exp(-3 * dt); // al moverse, la mirada vuelve al frente
      yaw += (yawTarget - yaw) * (1 - Math.exp(-8 * dt));
      const lk = poseAt(s);
      autoOpen(keys[current], localU);
      const leyendo = hasWide[current] ? localU < 0.26 : localU < 0.62;
      if (leyendo !== lastLeyendo || current !== lastLeyIdx) {
        sections.forEach((sec, k) => sec.classList.toggle('leyendo', k === current && leyendo));
        lastLeyendo = leyendo; lastLeyIdx = current;
      }
      hint(dt);
      centerNav();
      camera.lookAt(lk);
      sweepS += (sweep - sweepS) * (1 - Math.exp(-6 * dt));
      const giro = yaw + sweepS;
      if (Math.abs(giro) > 1e-4) camera.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), giro);
      // techos y exterior se esconden cuando la cámara está por encima (vista de maqueta)
      const above = camera.position.y > 2.45;
      apt.ceilings.visible = !above;
      apt.surroundings.visible = !above;
      for (const l of lamps) l.visible = !above;
      updateSpots();
      syncChips(dt);
    },
  };
}
