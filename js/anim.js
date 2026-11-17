// Mini sistema de animaciones e interacción compartido por todos los módulos.
// - tween(): anima una propiedad numérica de un objeto (ej. rotation.y, position.x)
// - makeInteractive(): marca un mesh/grupo como clickeable (puertas, closets, cajones)
// - updateAnimations(dt): lo llama main.js en cada frame

const active = [];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Anima obj[prop] hasta `to` en `duration` segundos.
 * prop puede ser "rotation.y", "position.x", "scale.z", etc.
 */
export function tween(obj, prop, to, duration = 0.8) {
  const parts = prop.split('.');
  const key = parts.pop();
  const target = parts.reduce((o, k) => o[k], obj);
  // cancela una animación previa sobre la misma propiedad
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i].target === target && active[i].key === key) active.splice(i, 1);
  }
  active.push({ target, key, from: target[key], to, t: 0, duration });
}

export const isAnimating = () => active.length > 0;

export function updateAnimations(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    a.t = Math.min(1, a.t + dt / a.duration);
    a.target[a.key] = a.from + (a.to - a.from) * ease(a.t);
    if (a.t >= 1) active.splice(i, 1);
  }
}

/**
 * Marca `object` (y todos sus hijos) como interactivo.
 * Al hacer click/tap en cualquiera de sus meshes, controls.js llama toggle().
 * opts: { label: 'Abrir closet', labelOpen: 'Cerrar closet', onToggle(open) }
 */
export function makeInteractive(object, { label, labelOpen, onToggle }) {
  const state = { open: false };
  object.userData.interactive = true;
  object.userData.getLabel = () => (state.open ? labelOpen || label : label);
  object.userData.toggle = () => {
    state.open = !state.open;
    onToggle(state.open);
  };
  return object;
}

/** Sube por la jerarquía hasta encontrar el objeto interactivo dueño de un mesh. */
export function findInteractive(obj) {
  while (obj) {
    if (obj.userData && obj.userData.interactive) return obj;
    obj = obj.parent;
  }
  return null;
}
