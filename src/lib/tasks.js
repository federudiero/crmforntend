// src/lib/tasks.js
import { db } from "../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export async function createTask({ title, dueAt, note, contactId, conversationId, assignedToUid, assignedToName, provinciaId }) {
  const payload = {
    title, dueAt, note: note || "",
    contactId: contactId || "", conversationId: conversationId || "",
    assignedToUid: assignedToUid || "", assignedToName: assignedToName || "",
    provinciaId: provinciaId || "",
    createdAt: serverTimestamp(), done: false
  };
  await addDoc(collection(db, "tasks"), payload);
  return true;
}
