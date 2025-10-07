// src/services/api.js
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

/**
 * Enviar mensaje flexible:
 *  - text: string
 *  - image: { link, caption? }  ó { id }
 *  - audio: { link }            ó { id }
 *  - template: { name, ... }
 */
export async function sendMessage({ to, text, image, audio, template, conversationId, replyTo }) {
  const payload = { to, conversationId };
  if (text) payload.text = text;
  if (image) payload.image = image;
  if (audio) payload.audio = audio;
  if (template) payload.template = template;
  if (replyTo) payload.replyTo = replyTo;

  const r = await fetch(`${BASE}/api/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { console.error(e); }
  if (!r.ok) {
    const msg = data?.error?.message || raw || "Error desconocido";
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return data;
}
