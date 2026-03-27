// src/services/storage.js

async function uploadViaBackend(file, conversationId, opts = {}) {
  const base = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  if (!base) {
    throw new Error("Falta VITE_API_BASE para subir archivos al backend");
  }

  const fd = new FormData();
  fd.append("conversationId", conversationId);
  fd.append("file", file, file.name);

  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs || 90000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetch(`${base}/api/upload`, {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
    });

    const raw = await resp.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!resp.ok || !data?.ok) {
      const msg =
        data?.error ||
        data?.message ||
        raw ||
        `Upload failed (${resp.status})`;
      throw new Error(msg);
    }

    return {
      url: data.url,
      path: data.path,
      contentType: data.contentType,
      originalContentType: data.originalContentType || file.type || "",
      detectedContentType: data.detectedContentType || file.type || "",
      converted: !!data.converted,
      size: data.size,
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error("La subida del archivo tardó demasiado y fue cancelada.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * API estable:
 * uploadFile(file, destPath, opts?) -> { url, path, contentType, size, converted }
 *
 * IMPORTANTE:
 * - Ya NO usamos Firebase SDK como fallback.
 * - Todo pasa por backend/api/upload para detectar y convertir
 *   antes de guardar/enviar a WhatsApp.
 */
export async function uploadFile(file, destPath, opts = {}) {
  if (!file) throw new Error("Archivo requerido");

  const allowed =
    opts.allowed || [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",

      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/mp4",
      "audio/aac",
      "audio/webm",
      "audio/webm;codecs=opus",

      "application/pdf",
    ];

  const maxBytes = opts.maxBytes || 25 * 1024 * 1024;
  const rawType = String(file.type || "").toLowerCase().trim();
  const baseType = rawType.split(";")[0];

  const isAllowed = allowed.includes(rawType) || allowed.includes(baseType);

  if (!isAllowed) {
    throw new Error(`Tipo no permitido: ${rawType || "desconocido"}`);
  }

  if ((file.size || 0) > maxBytes) {
    throw new Error("Archivo > 25MB");
  }

  const parts = String(destPath || "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean);

  const conversationId = opts.conversationId || parts[1] || "";

  if (!conversationId) {
    throw new Error("No pude resolver conversationId para el upload");
  }

  return uploadViaBackend(file, conversationId, opts);
}
