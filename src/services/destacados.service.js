import {
  collection, query, where, addDoc, deleteDoc, getDocs, serverTimestamp, doc,
} from "firebase/firestore";
import { db } from "../firebase"; // usa el mismo import que tu ChatWindow.jsx

const PREVIEW_LEN = 140;

// Listar: si hay email lo usamos; si no, listamos por UID
export async function listarDestacadosDeUsuario({ chatId, userEmail, userUid }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  let q;
  if (userEmail) {
    q = query(col, where("userEmail", "==", String(userEmail).toLowerCase()));
  } else {
    q = query(col, where("userUid", "==", String(userUid || "")));
  }
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Buscar uno por messageId + (email o UID)
export async function buscarDestacado({ chatId, userEmail, userUid, messageId }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  let q;
  if (userEmail) {
    q = query(
      col,
      where("userEmail", "==", String(userEmail).toLowerCase()),
      where("messageId", "==", String(messageId))
    );
  } else {
    q = query(
      col,
      where("userUid", "==", String(userUid || "")),
      where("messageId", "==", String(messageId))
    );
  }
  const snap = await getDocs(q);
  if (snap.empty) return { existe: false, docId: null };
  const d = snap.docs[0];
  return { existe: true, docId: d.id };
}

// Crear
export async function crearDestacado({ chatId, userEmail, userUid, messageId, texto }) {
  const col = collection(db, "conversations", String(chatId), "destacados");
  const preview = (texto || "").slice(0, PREVIEW_LEN);
  await addDoc(col, {
    messageId: String(messageId),
    userEmail: String(userEmail || "").toLowerCase(),
    userUid: String(userUid || ""),
    preview,
    createdAt: serverTimestamp(),
  });
}

// Borrar
export async function eliminarDestacado({ chatId, docId }) {
  const ref = doc(db, "conversations", String(chatId), "destacados", String(docId));
  await deleteDoc(ref);
}

// Toggle
export async function toggleDestacado({ chatId, userEmail, userUid, messageId, texto }) {
  const current = await buscarDestacado({ chatId, userEmail, userUid, messageId });
  if (current.existe) {
    await eliminarDestacado({ chatId, docId: current.docId });
    return false;
  } else {
    await crearDestacado({ chatId, userEmail, userUid, messageId, texto });
    return true;
  }
}
