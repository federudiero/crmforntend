// src/lib/templates.js
import { db } from "../firebase";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs, query, orderBy
} from "firebase/firestore";

/**
 * Estructura de plantilla:
 * {
 *   id, name, folder, body, vars: ['nombre','vendedor','fecha','link'],
 *   updatedAt: serverTimestamp()
 * }
 */

const coll = collection(db, "templates");

export async function listTemplates() {
  const q = query(coll, orderBy("folder", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createTemplate(data) {
  // data: {name, folder, body, vars?}
  return await addDoc(coll, {
    name: data.name || "Sin título",
    folder: data.folder || "General",
    body: data.body || "",
    vars: Array.isArray(data.vars) ? data.vars : [],
    updatedAt: Date.now()
  });
}

export async function updateTemplate(id, data) {
  await updateDoc(doc(db, "templates", String(id)), {
    ...data,
    updatedAt: Date.now()
  });
}

export async function deleteTemplate(id) {
  await deleteDoc(doc(db, "templates", String(id)));
}

/** Reemplaza {variable} en body */
export function renderTemplate(body = "", values = {}) {
  return body.replace(/\{(\w+)\}/g, (_, k) => {
    const v = values[k];
    return v == null ? `{${k}}` : String(v);
  });
}
