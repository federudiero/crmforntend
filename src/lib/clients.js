// src/lib/clients.js
import { db } from "../firebase";
import {
  collection, doc,  getDocs, query, setDoc, where, limit
} from "firebase/firestore";

/** Obtiene o crea una ficha básica de cliente basada en phone */
export async function getOrCreateClientByPhone(phone, defaults = {}) {
  if (!phone) return null;
  const q = query(collection(db, "contacts"), where("phone", "==", phone), limit(1));
  const snap = await getDocs(q);
  if (snap.size > 0) {
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  }
  const id = phone.replace(/\D/g, "");
  const ref = doc(db, "contacts", id);
  const data = { phone, ...defaults, createdAt: new Date() };
  await setDoc(ref, data, { merge: true });
  return { id, ...data };
}
