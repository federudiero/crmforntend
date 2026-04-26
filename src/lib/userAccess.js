import { collection, getDocs, limit, query, where } from "firebase/firestore";

const FALLBACK_ADMIN_EMAILS = [
  "federudiero@gmail.com",
  "fede_rudiero@gmail.com",
  "alainismael95@gmail.com",
].map((v) => String(v || "").trim().toLowerCase());

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isUserActive(profile) {
  return profile?.active !== false;
}

export function isVendorRowActive(row) {
  return row?.active !== false;
}

export function dedupeVendorRows(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const id = String(row.id || "").trim();
    if (!id) continue;
    map.set(id, row);
  }
  return Array.from(map.values());
}

/**
 * Regla efectiva de acceso:
 * - si users/{uid}.active === false => bloquea
 * - si tiene filas vinculadas en wabaNumbers y todas están inactivas => bloquea
 * - si no tiene filas vinculadas, confía en users/{uid}
 */
export function isEffectivelyActive({ profile, vendorRows = [] } = {}) {
  if (!isUserActive(profile)) return false;

  const linkedRows = dedupeVendorRows(vendorRows);
  if (!linkedRows.length) return true;

  return linkedRows.some((row) => isVendorRowActive(row));
}

export async function getLinkedVendorRows({ db, uid, email } = {}) {
  const normalizedUid = String(uid || "").trim();
  const normalizedEmail = normalizeEmail(email);
  const rows = [];

  if (normalizedUid) {
    const byUid = await getDocs(
      query(collection(db, "wabaNumbers"), where("ownerUid", "==", normalizedUid), limit(10))
    );
    rows.push(...byUid.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
  }

  if (normalizedEmail) {
    const byEmail = await getDocs(
      query(collection(db, "wabaNumbers"), where("owner", "==", normalizedEmail), limit(10))
    );
    rows.push(...byEmail.docs.map((snap) => ({ id: snap.id, ...snap.data() })));
  }

  return dedupeVendorRows(rows);
}

export function isAdminUser({ email, profile } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;

  if (profile?.role === "admin") return true;
  if (profile?.isAdmin === true) return true;
  if (profile?.admin === true) return true;

  return FALLBACK_ADMIN_EMAILS.includes(normalizedEmail);
}
