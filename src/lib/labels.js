// src/lib/labels.js
import { db } from "../firebase";
import {
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  getDocs,
  addDoc,
  updateDoc as upd,
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
   Presets
   ========================= */
export const PRESET_LABELS = [
  { slug: "vendido", name: "Vendido", color: "success" },
  { slug: "posible-venta", name: "Posible venta", color: "info" },
  { slug: "en-seguimiento", name: "En seguimiento", color: "primary" },
  { slug: "no-vender", name: "No vender", color: "error" },
  { slug: "cliente-no-responde", name: "Cliente no responde", color: "warning" },
  { slug: "sin-respuesta", name: "Sin respuesta", color: "secondary" },
  { slug: "zonas", name: "Zonas", color: "accent" },
  { slug: "cerca", name: "Seguir de cerca", color: "accent" },

  { slug: "dia-lunes", name: "Día lunes", color: "neutral" },
  { slug: "dia-martes", name: "Día martes", color: "neutral" },
  { slug: "dia-miercoles", name: "Día miércoles", color: "neutral" },
  { slug: "dia-jueves", name: "Día jueves", color: "neutral" },
  { slug: "dia-viernes", name: "Día viernes", color: "neutral" },
  { slug: "dia-sabado", name: "Día sábado", color: "neutral" },

  { slug: "cliente-potencial", name: "Cliente potencial", color: "info" },
  { slug: "__none__", name: "Sin etiqueta", color: "neutral" },
];

const coll = collection(db, "labels");

// Mapa para fallback rápido
const PRESET_BY_SLUG = new Map(PRESET_LABELS.map((l) => [l.slug, l]));

/* =========================
   Listado (con fallback de color)
   ========================= */
export async function listLabels() {
  try {
    const q = query(coll, orderBy("name", "asc"));
    const snap = await getDocs(q);

    const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!raw.length) return PRESET_LABELS;

    const hydrated = raw.map((l) => {
      const slug = normalizeSlug(l.slug || l.name || "");
      const preset = PRESET_BY_SLUG.get(slug);

      return {
        ...l,
        slug,
        name: String(l.name || preset?.name || slug || "").trim(),
        color: l.color || preset?.color || "neutral",
      };
    });

    return dedupeBySlug(hydrated);
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
