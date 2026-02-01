// src/services/api.js
import { auth } from "../firebase.js"; // ajustá la ruta si tu firebase está en otro lado

const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

// Helper: arma headers con Bearer si hay usuario logueado
async function buildAuthHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };

  const user = auth.currentUser;
  if (user) {
    const idToken = await user.getIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

/**
 * Enviar mensaje flexible:
 *  - text: string
 *  - image: { link, caption? }  ó { id }
 *  - audio: { link }            ó { id }
 *  - document: { link, caption?, filename? } ó { id }
 *  - template: { name, language:{code}, components:[...] }
 */
export async function sendMessage({
  to,
  text,
  image,
  audio,
  document,
  template,
  conversationId,
  replyTo,
  sellerName,
  fromWaPhoneId, // opcional
  phoneId,       // opcional
}) {
  const payload = { to, conversationId };

  if (text) payload.text = text;
  if (image) payload.image = image;
  if (audio) payload.audio = audio;
  if (document) payload.document = document;
  if (template) payload.template = template;
  if (replyTo) payload.replyTo = replyTo;
  if (sellerName) payload.sellerName = sellerName;

  // opcional: si querés forzar un emisor específico
  if (fromWaPhoneId) payload.fromWaPhoneId = fromWaPhoneId;
  if (phoneId) payload.phoneId = phoneId;

  const r = await fetch(`${BASE}/api/sendMessage`, {
    method: "POST",
    headers: await buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const raw = await r.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || raw || "Error desconocido";
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }

  return data;
}

/**
 * (Opcional) Si tu remarketing usa /api/send-template:
 * Mantengo el nombre por claridad.
 */
export async function sendTemplate({
  phone,
  templateName,
  languageCode = "es_AR",
  components = [],
  sellerName,
  conversationId,
  v1,
  v2,
  v3,
}) {
  const payload = {
    phone,
    templateName,
    languageCode,
    components,
    sellerName,
    conversationId,
    v1,
    v2,
    v3,
  };

  const r = await fetch(`${BASE}/api/send-template`, {
    method: "POST",
    headers: await buildAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const raw = await r.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }

  if (!r.ok) {
    const msg = data?.error?.message || data?.error || raw || "Error desconocido";
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }

  return data;
}
