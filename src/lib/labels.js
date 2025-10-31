// src/lib/labels.js
import { db } from "../firebase";
import {
  doc,
  updateDoc,               // lo usamos en add/remove a conversación
  arrayUnion,
  arrayRemove,
  collection,
  getDocs,
  addDoc,
  updateDoc as upd,         // alias para updateLabel()
  deleteDoc,
  query,
  orderBy,
} from "firebase/firestore";

/* =========================
   Helpers de normalización
   ========================= */
const normalizeSlug = (s = "") =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/\s+/g, "-")            // espacios -> guiones
    .toLowerCase()
    .trim();

const dedupeBySlug = (arr = []) => {
  const seen = new Set();
  const out = [];
  for (const it of arr) {
    const key = normalizeSlug(it.slug || it.name || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, slug: key });
  }
  return out;
};

/* =========================
   Presets (sin duplicados)
   ========================= */
// Nombres visibles consistentes; slugs sin acentos
export const PRESET_LABELS = [
  { slug: "vendido",             name: "Vendido",             color: "success" },
  { slug: "posible-venta",       name: "Posible venta",       color: "info" },
  { slug: "en-seguimiento",      name: "En seguimiento",      color: "primary" },
  { slug: "no-vender",           name: "No vender",           color: "error" },
  { slug: "cliente-no-responde", name: "Cliente no responde", color: "warning" },
  { slug: "sin-respuesta",       name: "Sin respuesta",       color: "secondary" },
  { slug: "zonas",               name: "Zonas",               color: "accent" },
  { slug: "cerca",               name: "Seguir de cerca",     color: "accent" },

  // Días — un solo slug por día (sin tildes); nombre visible con tildes
  { slug: "dia-lunes",           name: "Día lunes",           color: "neutral" },
  { slug: "dia-martes",          name: "Día martes",          color: "neutral" },
  { slug: "dia-miercoles",       name: "Día miércoles",       color: "neutral" },
  { slug: "dia-jueves",          name: "Día jueves",          color: "neutral" },
  { slug: "dia-viernes",         name: "Día viernes",         color: "neutral" },
  { slug: "dia-sabado",          name: "Día sábado",          color: "neutral" },

  { slug: "cliente-potencial",   name: "Cliente potencial",   color: "info" },
  { slug: "__none__",            name: "Sin etiqueta",        color: "neutral" },
];

const coll = collection(db, "labels");

/* =========================
   Listado (con dedupe)
   ========================= */
export async function listLabels() {
  try {
    const q = query(coll, orderBy("name", "asc"));
    const snap = await getDocs(q);
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!arr.length) return PRESET_LABELS;
    // ⚠️ Defensa: si en Firestore hay variantes (con/son tildes), las unificamos
    return dedupeBySlug(arr);
  } catch {
    return PRESET_LABELS;
  }
}

// Admin (CRUD)
export async function listAllLabels() {
  return await listLabels();
}

export async function createLabel({ name, slug, color }) {
  const clean = {
    name: String(name || slug || "").trim(),
    slug: normalizeSlug(slug || name),
    color: color || "neutral",
  };
  if (!clean.slug) throw new Error("Slug requerido");
  return await addDoc(coll, clean);
}

export async function updateLabel(id, data) {
  const clean = {
    ...(data || {}),
    name: String(data?.name || data?.slug || "").trim(),
    slug: normalizeSlug(data?.slug || data?.name),
    color: data?.color || "neutral",
  };
  if (!clean.slug) throw new Error("Slug requerido");
  await upd(doc(db, "labels", String(id)), clean);
}

export async function deleteLabel(id) {
  await deleteDoc(doc(db, "labels", String(id)));
}

/* =========================
   Etiquetado de conversaciones
   ========================= */
export async function addLabelToConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayUnion(normalizeSlug(slug)) });
}

export async function removeLabelFromConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayRemove(normalizeSlug(slug)) });
}
