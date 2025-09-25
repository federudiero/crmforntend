// src/services/storage.js
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";

async function uploadViaBackend(file, conversationId) {
  const base = import.meta.env.VITE_API_BASE;
  const fd = new FormData();
  fd.append("conversationId", conversationId);
  fd.append("file", file, file.name);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000); // 15s timeout
  const resp = await fetch(`${base}/api/upload`, { method: "POST", body: fd, signal: ctrl.signal });
  clearTimeout(t);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.ok) throw new Error(data?.error || `Upload failed (${resp.status})`);
  return { url: data.url, path: data.path, contentType: data.contentType, size: data.size };
}

async function uploadViaSDK(file, destPath, opts = {}) {
  const type = (file?.type || "").toLowerCase();
  const r = ref(storage, destPath);
  const task = uploadBytesResumable(r, file, {
    contentType: type,
    cacheControl: "public, max-age=31536000",
  });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (opts.onProgress && snap.totalBytes) {
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
          opts.onProgress(Math.round(pct));
        }
      },
      (error) => reject(error),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({ url, path: r.fullPath, contentType: type, size: file.size || 0 });
      }
    );
  });
}

/**
 * API estable: uploadFile(file, destPath, opts?) -> { url, path, contentType, size }
 */
export async function uploadFile(file, destPath, opts = {}) {
  if (!file) throw new Error("Archivo requerido");
  const allowed = opts.allowed || [
    "image/jpeg","image/png","image/webp","image/gif",
    "audio/mpeg","audio/ogg","audio/wav","audio/mp4","audio/aac",
  ];
  const maxBytes = opts.maxBytes || 25 * 1024 * 1024;
  const type = (file.type || "").toLowerCase();
  if (!allowed.includes(type)) throw new Error(`Tipo no permitido: ${type}`);
  if (file.size > maxBytes) throw new Error("Archivo > 25MB");

  // conversationId viene en destPath: 'uploads/{conversationId}/...'
  const parts = String(destPath || "").split("/");
  const conversationId = parts.length > 1 ? parts[1] : "";

  // 1) intenta backend (robusto PC/móvil) → 2) si falla, SDK (habilitado por reglas)
  try {
    return await uploadViaBackend(file, conversationId);
  } catch (e) {console.error(e)
    // opcional: console.warn("Backend upload falló, usando SDK:", e?.message);
    return await uploadViaSDK(file, destPath, opts);
  }
}
