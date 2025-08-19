// src/lib/labels.js
import { db } from "../firebase";
import { doc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";

// Lista fija (slugs que se guardan en conversations/{id}.labels)
export const PRESET_LABELS = [
  { slug: "cliente-potencial", name: "Cliente potencial", color: "neutral" },
  { slug: "cliente-vip",      name: "Cliente VIP",        color: "warning" },
  { slug: "en-seguimiento",   name: "En seguimiento",     color: "info" },
  { slug: "no-vender",        name: "No vender",          color: "error" },
  { slug: "posible-venta",    name: "Posible venta",      color: "accent" },
  { slug: "vendido",          name: "Vendido",            color: "success" },


  // Compatibilidad con datos viejos
  { slug: "vip",              name: "Cliente VIP",        color: "warning" },
];

export async function listLabels() {
  // No lee/escribe en /labels (evita problemas de permisos)
  return PRESET_LABELS;
}

export async function addLabelToConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayUnion(slug) });
}

export async function removeLabelFromConversation(conversationId, slug) {
  const ref = doc(db, "conversations", String(conversationId));
  await updateDoc(ref, { labels: arrayRemove(slug) });
}
