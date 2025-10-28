// src/lib/labels.js
import { db } from "../firebase";
import {
  doc, updateDoc, arrayUnion, arrayRemove,
  collection, getDocs, addDoc, updateDoc as upd, deleteDoc, query, orderBy
} from "firebase/firestore";

// Presets por si no hay colección /labels o fallan permisos
export const PRESET_LABELS = [
  { slug: "vendido",            name: "Vendido",            color: "success" },
  { slug: "posible-venta",      name: "Posible venta",      color: "info" },
  { slug: "en-seguimiento",     name: "En seguimiento",     color: "primary" },
  { slug: "no-vender",          name: "No vender",          color: "error" },
  { slug: "cliente-no-responde",name: "Cliente no responde",color: "warning" },
  { slug: "sin-respuesta",      name: "Sin respuesta",      color: "secondary" },
  { slug: "zonas",              name: "Zonas",              color: "accent" },
  { slug: "cerca",              name: "Cerca",              color: "accent" },
  { slug: "dia-lunes",          name: "día-lunes",          color: "neutral" },
  { slug: "dia-martes",         name: "día-martes",         color: "neutral" },
  { slug: "dia-miercoles",      name: "día-miercoles",      color: "neutral" },
  { slug: "dia-jueves",         name: "día-jueves",         color: "neutral" },
  { slug: "dia-viernes",        name: "día-viernes",        color: "neutral" },
  { slug: "dia-sabado",         name: "día-sabado",         color: "neutral" },
  { slug: "cliente-potencial",  name: "Cliente potencial",  color: "info" },
  { slug: "__none__",           name: "Sin etiqueta",       color: "neutral" },
];
const coll = collection(db, "labels");

export async function listLabels() {
  try {
    const q = query(coll, orderBy("name", "asc"));
    const snap = await getDocs(q);
    const arr = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (!arr.length) return PRESET_LABELS;
    return arr;
  } catch {
    return PRESET_LABELS;
  }
}

// Para el admin (CRUD completo)
export async function listAllLabels() { return await listLabels(); }
export async function createLabel({ name, slug, color }) {
  return await addDoc(coll, { name, slug, color });
}
export async function updateLabel(id, data) {
  await upd(doc(db, "labels", String(id)), data);
}
export async function deleteLabel(id) {
  await deleteDoc(doc(db, "labels", String(id)));
}

// Etiquetar conversación
export async function addLabelToConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayUnion(slug) });
}
export async function removeLabelFromConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayRemove(slug) });
}
