// src/lib/labels.js
import { db } from "../firebase";
import {
  doc, updateDoc, arrayUnion, arrayRemove,
  collection, getDocs, addDoc, updateDoc as upd, deleteDoc, query, orderBy
} from "firebase/firestore";

// Presets por si no hay colección /labels o fallan permisos
export const PRESET_LABELS = [
  { slug: "cliente-potencial", name: "Cliente potencial", color: "neutral" },
  { slug: "cliente-vip",      name: "Cliente VIP",        color: "warning" },
  { slug: "en-seguimiento",   name: "En seguimiento",     color: "info" },
  { slug: "no-vender",        name: "No vender",          color: "error" },
  { slug: "posible-venta",    name: "Posible venta",      color: "accent" },
  { slug: "vendido",          name: "Vendido",            color: "success" },
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
