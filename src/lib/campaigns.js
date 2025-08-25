// src/lib/campaigns.js
import { db } from "../firebase";
import { addDoc, collection } from "firebase/firestore";

/** Registra una campaña programada mínima */
export async function createCampaign(c) {
  const payload = {
    ...c,
    status: "scheduled",
    createdAt: new Date().toISOString(),
  };
  await addDoc(collection(db, "campaigns"), payload);
  return true;
}
