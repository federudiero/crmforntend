// src/lib/stats.js
// (helpers para agrupar métricas – opcional; las métricas principales están en DashboardPro.jsx)
export function groupBy(arr, keyFn) {
  const map = new Map();
  for (const it of arr) {
    const k = keyFn(it);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries()).map(([k,v]) => ({ k, v }));
}