import { auth } from "../firebase.js";

const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

async function buildAuthHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };

  const user = auth.currentUser;
  if (user) {
    const idToken = await user.getIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

export async function sendMessage({
  to,
  text,
  image,
  audio,
  audioMeta,
  document,
  template,
  conversationId,
  replyTo,
  sellerName,
  fromWaPhoneId,
  phoneId,
}) {
  const payload = { to, conversationId };

  if (text) payload.text = text;
  if (image) payload.image = image;
  if (audio) payload.audio = audio;
  if (audioMeta) payload.audioMeta = audioMeta;
  if (document) payload.document = document;
  if (template) payload.template = template;
  if (replyTo) payload.replyTo = replyTo;
  if (sellerName) payload.sellerName = sellerName;
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

export async function checkTemplateEligibility({
  phone,
  templateName,
  languageCode = "es_AR",
  conversationId,
  fromWaPhoneId,
  phoneId,
}) {
  const payload = {
    phone,
    templateName,
    languageCode,
  };

  if (conversationId) payload.conversationId = conversationId;
  if (fromWaPhoneId) payload.fromWaPhoneId = fromWaPhoneId;
  if (phoneId) payload.phoneId = phoneId;

  const r = await fetch(`${BASE}/api/check-template-eligibility`, {
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
