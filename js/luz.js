// Luz horneada: lee js/luz.bin (generado con hornear.html) y la pinta en los vértices de
// paredes, pisos y techos. En tiempo real ya no se calcula luz ni sombras para la estructura:
// el celular solo multiplica textura × luz guardada, que es lo más barato que existe.
import * as THREE from 'three';

/** Mallas horneables en orden estable (el mismo que usa el horno). */
export function bakeTargets(aptGroup) {
  const list = [];
  aptGroup.traverse((o) => { if (o.isMesh && o.userData.bake) list.push(o); });
  return list;
}

/** Formato: [u32 largo del encabezado][encabezado JSON][relleno a 2 bytes][Uint16 RGB por vértice…] */
export function encodeBaked(header, variants) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 + json.length) % 2;
  const total = variants.reduce((s, v) => s + v.length, 0);
  const buf = new ArrayBuffer(4 + json.length + pad + total * 2);
  new DataView(buf).setUint32(0, json.length, true);
  new Uint8Array(buf, 4, json.length).set(json);
  let off = 4 + json.length + pad;
  for (const v of variants) { new Uint16Array(buf, off, v.length).set(v); off += v.length * 2; }
  return buf;
}

export async function loadBaked(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // luz.txt = el mismo binario en base64 (el hosting de artifacts no sirve .bin)
    const buf = url.endsWith('.txt')
      ? Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0)).buffer
      : await res.arrayBuffer();
    const len = new DataView(buf).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    const off = 4 + len + ((4 + len) % 2);
    const per = header.counts.reduce((s, c) => s + c, 0) * 3;
    const variants = header.variants.map((_, i) => new Uint16Array(buf, off + i * per * 2, per));
    return { header, variants };
  } catch (e) {
    console.warn('Sin luz horneada', e);
    return null;
  }
}

/**
 * Aplica la luz a la estructura. Devuelve setVariant(i) para cambiar entre
 * "amoblado" (0) y "vacío" (1), o null si el archivo no corresponde a esta geometría.
 */
export function applyBaked(aptGroup, baked) {
  const targets = bakeTargets(aptGroup);
  const { header, variants } = baked;
  if (targets.length !== header.counts.length || targets.some((m, i) => m.geometry.attributes.position.count !== header.counts[i])) {
    console.warn('La luz horneada no coincide con la geometría; hay que volver a hornear.');
    return null;
  }
  const perMesh = targets.map((m, i) => {
    const start = header.counts.slice(0, i).reduce((s, c) => s + c, 0) * 3;
    const attrs = variants.map((v) => new THREE.BufferAttribute(v.subarray(start, start + header.counts[i] * 3), 3, true));
    const src = m.material;
    m.userData.srcMat = src;
    m.material = new THREE.MeshBasicMaterial({
      map: src.map || null,
      color: (src.color ? src.color.clone() : new THREE.Color(1, 1, 1)).multiplyScalar(header.M),
      vertexColors: true,
    });
    m.geometry.setAttribute('color', attrs[0]);
    return { m, attrs };
  });
  // Piezas delgadas que no se hornean (guardaescobas, corte superior de muros): tono fijo
  aptGroup.traverse((o) => {
    if (o.isMesh && !o.userData.bake && o.userData.flatTone !== false && o.material.color && !o.material.isMeshBasicMaterial) {
      o.material = new THREE.MeshBasicMaterial({ color: o.material.color.clone().multiplyScalar(1.7) });
    }
  });
  return (i) => { for (const { m, attrs } of perMesh) m.geometry.setAttribute('color', attrs[i]); };
}
