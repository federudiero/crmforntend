// src/services/api.js
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export async function sendMessage({ to, text, conversationId }) {
  const r = await fetch(`${BASE}/api/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text, conversationId }),
  });
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (e){console.error(e)}
  if (!r.ok) {
    const msg = data?.error?.message || raw || "Error desconocido";
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return data;
}
