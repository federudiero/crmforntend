// src/services/chatDestacados.js
import {
  collection, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, doc,
} from "firebase/firestore";
// Usá la misma export que en el resto de tu app:
import { db } from "../firebase"; // <-- si tu db está en "../firebase/firebase", ajustá este import

const PREVIEW_LEN = 140;

export async function listarDestacadosDeUsuario({ chatId, userEmail }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  const q = query(col, where("userEmail", "==", (userEmail || "").toLowerCase()));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function estaDestacado({ chatId, userEmail, messageId }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  const q = query(
    col,
    where("userEmail", "==", (userEmail || "").toLowerCase()),
    where("messageId", "==", String(messageId))
  );
  const snap = await getDocs(q);
  if (snap.empty) return { destacado: false, docId: null };
  const d = snap.docs[0];
  return { destacado: true, docId: d.id };
}

export async function destacarMensaje({ chatId, userEmail, messageId, texto }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  const preview = (texto || "").slice(0, PREVIEW_LEN);
  await addDoc(col, {
    messageId: String(messageId),
    userEmail: (userEmail || "").toLowerCase(),
    preview,
    createdAt: serverTimestamp(),
  });
}

export async function quitarDestacado({ chatId, docId }) {
  const ref = doc(db, "conversations", String(chatId), "destacados", String(docId));
  await deleteDoc(ref);
}

/** Toggle: devuelve true si quedó destacado, false si se quitó */
export async function toggleDestacado({ chatId, userEmail, messageId, texto }) {
  const current = await estaDestacado({ chatId, userEmail, messageId });
  if (current.destacado) {
    await quitarDestacado({ chatId, docId: current.docId });
    return false;
  } else {
    await destacarMensaje({ chatId, userEmail, messageId, texto });
    return true;
  }
}
