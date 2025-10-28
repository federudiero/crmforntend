import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { listLabels } from "../lib/labels";
import { getAuth } from "firebase/auth";

// ---------- Config ----------
const LOCKED_LANG = "es_AR";
const LOCKED_TEMPLATE = "promo_hogarcril_combos";
const BASE =
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_API_BASE ||
  "";
const api = (p) => `${BASE}${p}`;

// ---------- Helpers ----------
function normPhone(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const cleaned = s.startsWith("+") ? "+" + s.slice(1).replace(/\D+/g, "") : "+" + s.replace(/\D+/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return cleaned;
}
function countTemplateVars(templateBody = "") {
  const matches = templateBody.match(/\{\{\d+\}\}/g) || [];
  const maxIndex = matches.map((m) => parseInt(m.replace(/\{|\}/g, ""), 10)).reduce((a, b) => Math.max(a, b), 0);
  return maxIndex;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
function chunk(arr, size = 10) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }

// Saludo según hora local
function getTimeGreeting(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return "buen día";
  if (h < 19) return "buenas tardes";
  return "buenas noches";
}

// Si la plantilla ya dice "Hola {{1}}" (o con coma), evitamos duplicar "Hola"
function fallbackForVar1FromTemplateBody(tplBody) {
  const body = String(tplBody || "").toLowerCase();
  const patterns = [
    "hola {{1}}",
    "hola, {{1}}",
    "hola {{1}},",
    "hola,{{1}}",
    "hola,{{1}},"
  ];
  const hasHolaPrefix = patterns.some((p) => body.includes(p));
  return hasHolaPrefix ? "" : getTimeGreeting();
}

// Sanea variables para cumplir reglas de Meta (sin \n/\t y sin 5+ espacios)
function sanitizeParamText(input) {
  if (input === "\u200B") return input; // respetar ZWSP cuando se usa
  let x = String(input ?? "");
  x = x.replace(/[\r\t]+/g, " ");      // preserva \n
 x = x.replace(/\n{3,}/g, "\n\n");    // colapsa saltos excesivos
  x = x.replace(/\s{2,}/g, " ");
  x = x.replace(/ {5,}/g, "    ");
  x = x.trim();
  const MAX_PARAM_LEN = 1000;
  if (x.length > MAX_PARAM_LEN) x = x.slice(0, MAX_PARAM_LEN - 1) + "…";
  return x;
}

// ---------- fetch con token ----------
async function authFetch(path, options = {}) {
  const auth = getAuth();
  const user = auth.currentUser;
  const idToken = user ? await user.getIdToken() : null;
  const headers = new Headers(options.headers || {});
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(api(path), { ...options, headers });
}

// ---------- API ----------
async function sendTemplate({ phone, components = [] }) {
  const resp = await authFetch("/api/send-template", {
    method: "POST",
    body: JSON.stringify({ phone, components }),
  });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!resp.ok) throw new Error(data?.error?.message || data?.error || text || `HTTP ${resp.status}`);
  return data;
}

export default function RemarketingBulk() {
  const [templatesRaw, setTemplatesRaw] = useState([]);
  const [senderInfo, setSenderInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/templates");
        const t = await r.text();
        const data = t ? JSON.parse(t) : {};
        const arr = Array.isArray(data) ? data : (data?.templates || data?.data || []);
        if (!cancelled) setTemplatesRaw(arr || []);
      } catch (e) {
        console.error("fetch /api/templates error:", e);
        if (!cancelled) setTemplatesRaw([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/sender");
        const data = await r.json();
        if (!cancelled && r.ok) setSenderInfo(data);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const approvedTemplates = useMemo(() => {
    return (templatesRaw || []).filter((t) => {
      const status = String(t?.status).toUpperCase() === "APPROVED";
      const cat = String(t?.category).toUpperCase() === "MARKETING";
      const lang = (t?.language === LOCKED_LANG || t?.language?.code === LOCKED_LANG);
      const name = t?.name === LOCKED_TEMPLATE;
      return status && cat && lang && name;
    });
  }, [templatesRaw]);

  const tpl = approvedTemplates[0] || null;
  const tplBody = useMemo(() => {
    const comp = (tpl?.components || []).find((c) => String(c?.type).toUpperCase() === "BODY");
    return comp?.text || tpl?.body || "";
  }, [tpl]);
  const varCount = countTemplateVars(tplBody);

  // ---------- Variables ----------
  const [mode, setMode] = useState("global");
  const [vars, setVars] = useState(() => Array.from({ length: Math.max(varCount, 1) }, () => ""));
  useEffect(() => { setVars(Array.from({ length: Math.max(varCount, 1) }, () => "")); }, [varCount]);

  // ---------- Destinatarios ----------
  const [destMode, setDestMode] = useState("tags");
  const [allLabels, setAllLabels] = useState([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState("");
  const [selectedLabels, setSelectedLabels] = useState([]);

  // Con opt-in (para envío)
  const [tagPhonesOpt, setTagPhonesOpt] = useState([]);
  const [tagMetaOpt, setTagMetaOpt] = useState([]);

  // Total sin filtro (solo vista previa)
  const [tagPhonesAll, setTagPhonesAll] = useState([]);
  const [tagMetaAll, setTagMetaAll] = useState([]);

  const [tagPhonesLoading, setTagPhonesLoading] = useState(false);
  const [includeNoOptIn, setIncludeNoOptIn] = useState(false); // toggle vista previa sin opt-in

  // ===== NUEVO: Mostrar/copiar números con estado =====
  const [showNumbers, setShowNumbers] = useState(false);
  const displayMeta = includeNoOptIn ? tagMetaAll : tagMetaOpt;

  const numbersText = useMemo(
    () =>
      (displayMeta || [])
        .map(r => `${r.phone}  ${r.optIn ? "✓ opt-in" : "✗ sin opt-in"}`)
        .join("\n"),
    [displayMeta]
  );

  async function copyNumbersAnnotated() {
    try {
      await navigator.clipboard.writeText(numbersText);
      alert(`Copiado: ${displayMeta.length} filas (con estado)`);
    } catch (e) { console.error("copy failed", e); }
  }

  async function copyOnlyOptIn() {
    try {
      const plain = (tagMetaOpt || []).map(r => r.phone).join("\n");
      await navigator.clipboard.writeText(plain);
      alert(`Copiado: ${tagMetaOpt.length} números (solo opt-in)`);
    } catch (e) { console.error("copy failed", e); }
  }

  const [rawPhones, setRawPhones] = useState("");
  const numbers = useMemo(() => {
    const rows = rawPhones.split(/\n|,|;|\s+/).map((x) => x.trim()).filter(Boolean);
    const normed = rows.map(normPhone).filter(Boolean);
    return Array.from(new Set(normed));
  }, [rawPhones]);

  const [csvPreview, setCsvPreview] = useState([]);
  const fileInputRef = useRef(null);
  const onCsvUpload = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const parts = line.split(",").map((x) => x.trim());
      const phone = normPhone(parts[0]);
      if (!phone) continue;
      const item = { phone };
      for (let i = 1; i <= varCount; i++) item[`v${i}`] = parts[i] || "";
      out.push(item);
    }
    setCsvPreview(out);
    setMode("csv");
  };

  // ---------- Confirmaciones ----------
  const [confirmOptIn, setConfirmOptIn] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  // ---------- Envío ----------
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, ok: 0, fail: 0 });
  const [rowsState, setRowsState] = useState([]);
  const [delayMs, setDelayMs] = useState(800);

  // ---------- Carga de etiquetas (catálogo) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLabelsLoading(true);
        setLabelsError("");
        const base = await listLabels();
        let deduced = [];
        try {
          const q = query(collection(db, "conversations"), orderBy("lastMessageAt", "desc"), limit(500));
          const snap = await getDocs(q);
          const setSlugs = new Set();
          for (const d of snap.docs) {
            const data = d.data();
            const ls = Array.isArray(data.labels) ? data.labels : [];
            ls.forEach((s) => setSlugs.add(String(s)));
          }
          deduced = Array.from(setSlugs).map((s) => ({ slug: s, name: s }));
        } catch (e) { console.warn("deduce labels from conversations error:", e); }
        const union = new Map();
        for (const l of base || []) union.set(String(l.slug), l);
        for (const l of deduced) if (!union.has(String(l.slug))) union.set(String(l.slug), l);
        const arr = Array.from(union.values()).sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
        if (!cancelled) setAllLabels(arr);
      } catch (e) {
        console.error("load labels error:", e);
        if (!cancelled) { setLabelsError("No se pudieron cargar las etiquetas."); setAllLabels([]); }
      } finally { if (!cancelled) setLabelsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- Buscar conversaciones por etiquetas seleccionadas ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!selectedLabels.length) {
          setTagPhonesOpt([]); setTagMetaOpt([]);
          setTagPhonesAll([]); setTagMetaAll([]);
          return;
        }
        setTagPhonesLoading(true);

        // 1) Con opt-in (para envío)
        const byPhoneOpt = new Map();
        for (const ch of chunk(selectedLabels, 10)) {
          const q1 = query(
            collection(db, "conversations"),
            where("optIn", "==", true),
            where("labels", "array-contains-any", ch),
            orderBy("lastMessageAt", "desc"),
            limit(1000)
          );
          const snap = await getDocs(q1);
          for (const d of snap.docs) {
            const data = d.data();
            const phone = normPhone(data.contactId || data.phone || d.id);
            if (!phone) continue;
            const t = data.lastMessageAt?.toMillis?.()
              ? data.lastMessageAt.toMillis()
              : (data.lastMessageAt ? +new Date(data.lastMessageAt) : 0);
            const labelsArr = Array.isArray(data.labels) ? data.labels : [];
            byPhoneOpt.set(phone, { phone, lastMessageAt: t, labels: labelsArr, optIn: data.optIn === true });
          }
        }
        const arrOpt = Array.from(byPhoneOpt.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        if (!cancelled) { setTagPhonesOpt(arrOpt.map(r => r.phone)); setTagMetaOpt(arrOpt); }

        // 2) Total sin opt-in (solo vista previa)
        const byPhoneAll = new Map();
        for (const ch of chunk(selectedLabels, 10)) {
          const q2 = query(
            collection(db, "conversations"),
            where("labels", "array-contains-any", ch),
            orderBy("lastMessageAt", "desc"),
            limit(1000)
          );
          const snap = await getDocs(q2);
          for (const d of snap.docs) {
            const data = d.data();
            const phone = normPhone(data.contactId || data.phone || d.id);
            if (!phone) continue;
            const t = data.lastMessageAt?.toMillis?.()
              ? data.lastMessageAt.toMillis()
              : (data.lastMessageAt ? +new Date(data.lastMessageAt) : 0);
            const labelsArr = Array.isArray(data.labels) ? data.labels : [];
            byPhoneAll.set(phone, { phone, lastMessageAt: t, labels: labelsArr, optIn: data.optIn === true });
          }
        }
        const arrAll = Array.from(byPhoneAll.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        if (!cancelled) { setTagPhonesAll(arrAll.map(r => r.phone)); setTagMetaAll(arrAll); }

      } catch (e) {
        console.error("search convs by labels error:", e);
        if (!cancelled) {
          setTagPhonesOpt([]); setTagMetaOpt([]);
          setTagPhonesAll([]); setTagMetaAll([]);
        }
      } finally { if (!cancelled) setTagPhonesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedLabels]);

  useEffect(() => { if (destMode === "tags" && mode === "csv") setMode("global"); }, [destMode, mode]);

  const totalToSend = useMemo(() => {
    if (destMode === "tags") return tagPhonesOpt.length; // envío SIEMPRE opt-in
    return (mode === "global" ? numbers.length : csvPreview.length);
  }, [destMode, tagPhonesOpt.length, mode, numbers.length, csvPreview.length]);

  const hasLockedTemplate = Boolean(tpl);

  // ----------- VALIDACIÓN: {{1}} opcional con fallback según hora -----------
  const canSend = useMemo(() => {
    if (!hasLockedTemplate) return false;
    if (!confirmOptIn || !confirmTemplate) return false;
    if (destMode === "tags") {
      if (varCount <= 0) return false;
      // Permite vacío en var1 (idx 0). El resto obligatorio.
      return totalToSend > 0 && vars.slice(0, varCount).every((v, i) => i === 0 ? true : String(v || "").length > 0);
    }
    if (mode === "global") {
      return numbers.length > 0 && vars.slice(0, varCount).every((v, i) => i === 0 ? true : String(v || "").length > 0);
    }
    if (mode === "csv") {
      return csvPreview.length > 0 && csvPreview.every((r) => r.phone &&
        Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`]).every((x, i) => i === 0 ? true : (x ?? "").length > 0)
      );
    }
    return false;
  }, [hasLockedTemplate, confirmOptIn, confirmTemplate, destMode, totalToSend, mode, numbers, vars, csvPreview, varCount]);

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);

    const MAX_PARAM_LEN = 1000;

    const applyFallbackVars = (arr) =>
      arr.slice(0, varCount).map((t, i) => {
        let out;
        if (i === 0) {
          const v = String(t || "").trim();
          const fb = v ? v : fallbackForVar1FromTemplateBody(tplBody);
          out = fb === "" ? "\u200B" : fb; // anti “Hola Hola”
        } else {
          out = String(t || "");
        }
        if (out.length > MAX_PARAM_LEN) out = out.slice(0, MAX_PARAM_LEN - 1) + "…";
        // ⬇️ Saneo final requerido por Meta
        out = sanitizeParamText(out);
        return out;
      });

    const list = destMode === "tags"
      ? tagPhonesOpt.map((phone) => ({ phone, vars: applyFallbackVars(vars) }))
      : (mode === "global"
        ? numbers.map((phone) => ({ phone, vars: applyFallbackVars(vars) }))
        : csvPreview.map((r) => ({
            phone: r.phone,
            vars: applyFallbackVars(Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`]))
          }))
      );

    setRowsState(list.map((x) => ({ phone: x.phone, status: "pending" })));
    setProgress({ sent: 0, ok: 0, fail: 0 });

    for (let i = 0; i < list.length; i++) {
      const { phone, vars } = list[i];
      try {
        const components = [{
          type: "body",
          parameters: vars.map((t) => ({ type: "text", text: String(t) }))
        }];

        await sendTemplate({ phone, components });
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "ok" } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok + 1, fail: p.fail }));
      } catch (err) {
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "fail", error: String(err?.message || err) } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok, fail: p.fail + 1 }));
      }
      // eslint-disable-next-line no-await-guard
      await sleep(delayMs || 800);
    }

    setSending(false);
  };

  return (
    <div className="p-4 mx-auto max-w-5xl">
      <h2 className="mb-2 text-2xl font-bold">📣 Remarketing por Plantilla (WhatsApp)</h2>
      <p className="mb-1 text-sm text-gray-600">
        Este módulo usa <b>solo</b> la plantilla aprobada <code>{LOCKED_TEMPLATE}</code> ({LOCKED_LANG}) y envía únicamente a contactos con <b>opt-in</b>.
      </p>
      {senderInfo && (
        <p className="mb-4 text-xs text-gray-600">
          Se enviará desde <b>Phone ID</b>: <code>{senderInfo.phoneId}</code> (env: <code>{senderInfo.phoneEnvKey}</code>) — vendedor: <code>{senderInfo.seller?.email}</code>
        </p>
      )}

      {/* Plantilla */}
      <div className="p-3 mb-4 space-y-2 rounded-lg border">
        <label className="block text-sm font-semibold">Plantilla</label>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <span className="block text-xs text-gray-600">Idioma</span>
            <div className="p-2 w-full bg-gray-50 rounded border">{LOCKED_LANG}</div>
          </div>
          <div>
            <span className="block text-xs text-gray-600">Plantilla aprobada (MARKETING)</span>
            <div className="p-2 w-full bg-gray-50 rounded border">
              {tpl ? `${LOCKED_TEMPLATE} · ${LOCKED_LANG}` : "(no disponible / no aprobada)"}
            </div>
          </div>
        </div>

        {tplBody && tpl && (
          <div className="p-2 text-sm bg-gray-50 rounded border">
            <div className="font-mono whitespace-pre-wrap">{tplBody}</div>
            <div className="mt-1 text-gray-500">
              Variables detectadas en BODY: {varCount} &nbsp;
              ({Array.from({ length: varCount }).map((_, i) => `{{${i + 1}}}`).join(", ")})
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Si <code>{'{{1}}'}</code> viene vacío, se enviará: <b>{getTimeGreeting()}</b> (o vacío si el cuerpo ya comienza con "Hola " + {'{{1}}'} + "").
            </div>
          </div>
        )}

        {!tpl && (
          <div className="p-2 text-sm text-red-700 bg-red-50 rounded border border-red-300">
            La plantilla <b>{LOCKED_TEMPLATE}</b> ({LOCKED_LANG}) no aparece como <b>APPROVED / MARKETING</b>.
            Aprobala en tu WABA y recargá esta página.
          </div>
        )}
      </div>

      {/* Variables */}
      <div className="p-3 mb-4 space-y-2 rounded-lg border">
        <div className="flex flex-wrap gap-3 items-center">
          <span className="text-sm font-semibold">Variables</span>
          <label className="flex gap-2 items-center text-sm">
            <input type="radio" name="mode" value="global" checked={mode === "global"} onChange={() => setMode("global")} />
            Mismas para todos
          </label>
          {destMode === "manual" && (
            <label className="flex gap-2 items-center text-sm">
              <input type="radio" name="mode" value="csv" checked={mode === "csv"} onChange={() => setMode("csv")} />
              Por fila (CSV)
            </label>
          )}
        </div>
        {mode === "global" ? (
          <div className="grid gap-2 md:grid-cols-3">
            {Array.from({ length: varCount }).map((_, idx) => (
              idx === 2 ? (
                <textarea
                  key={idx}
                  rows={6}
                  className="p-2 font-mono whitespace-pre-wrap rounded border md:col-span-3"
                  placeholder="Pegá 1 combo por línea. Ej:&#10;Impermeabilizante 20L + Rodillo + Venda $49.900&#10;Látex 20L + 2 Enduidos $39.900"
                  value={vars[idx] || ""}
                  onChange={(e) => { const v = [...vars]; v[idx] = e.target.value; setVars(v); }}
                />
              ) : (
                <input
                  key={idx}
                  className="p-2 rounded border"
                  placeholder={`{{${idx + 1}}} ${idx === 0 ? '(opcional: nombre o saludo)' : ''}`}
                  value={vars[idx] || ""}
                  onChange={(e) => { const v = [...vars]; v[idx] = e.target.value; setVars(v); }}
                />
              )
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <input type="file" accept=".csv" ref={fileInputRef} onChange={(e) => onCsvUpload(e.target.files?.[0])} />
              <button type="button" className="px-3 py-1 rounded border" onClick={() => fileInputRef.current?.click()}>Cargar CSV</button>
            </div>
            <p className="text-xs text-gray-600">Formato: <code>phone,var1,var2,...</code> — <b>v1 puede ir vacío</b> (usa “buen día / buenas tardes / buenas noches” automáticamente).</p>
            {csvPreview.length > 0 && (
              <div className="overflow-auto max-h-40 text-sm rounded border">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-1 text-left">phone</th>
                      {Array.from({ length: varCount }).map((_, i) => (<th key={i} className="p-1 text-left">v{i + 1}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.map((r, i) => (
                      <tr key={i} className="odd:bg-white even:bg-gray-50">
                        <td className="p-1 font-mono">{r.phone}</td>
                        {Array.from({ length: varCount }).map((_, j) => (<td key={j} className="p-1">{r[`v${j + 1}`]}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Destinatarios */}
      <div className="p-3 mb-4 space-y-2 rounded-lg border">
        <div className="flex flex-wrap gap-3 items-center">
          <span className="text-sm font-semibold">Destinatarios</span>
          <label className="flex gap-2 items-center text-sm">
            <input type="radio" name="dest" value="tags" checked={destMode === "tags"} onChange={() => setDestMode("tags")} />
            Por etiquetas
          </label>
        </div>

        {destMode === "tags" ? (
          <div className="space-y-2">
            <LabelsBlock
              labelsLoading={labelsLoading}
              labelsError={labelsError}
              allLabels={allLabels}
              selectedLabels={selectedLabels}
              setSelectedLabels={setSelectedLabels}
            />

            <div className="text-xs text-gray-600">
              Seleccionadas: {selectedLabels.length} ·
              {" "}Con opt-in: {tagPhonesOpt.length}
              {" "}({tagPhonesAll.length} total)
            </div>

            <label className="flex gap-2 items-center text-sm">
              <input
                type="checkbox"
                checked={includeNoOptIn}
                onChange={(e) => setIncludeNoOptIn(e.target.checked)}
              />
              Ver coincidencias <b>sin</b> opt-in (solo vista previa)
            </label>

            {tagPhonesLoading ? (
              <div className="text-sm text-gray-600">Buscando conversaciones…</div>
            ) : (includeNoOptIn ? tagMetaAll.length : tagMetaOpt.length) > 0 ? (
              <>
                <PreviewTable rows={includeNoOptIn ? tagMetaAll : tagMetaOpt} />

                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <button
                    type="button"
                    className="px-3 py-1 text-sm rounded border"
                    onClick={() => setShowNumbers((v) => !v)}
                  >
                    {showNumbers ? "Ocultar números" : `Ver números (${(includeNoOptIn ? tagMetaAll.length : tagMetaOpt.length)})`}
                  </button>

                  <button
                    type="button"
                    className="px-3 py-1 text-sm rounded border"
                    onClick={copyNumbersAnnotated}
                    title="Copia teléfono + estado (lo mismo que ves)"
                  >
                    Copiar con estado
                  </button>

                  <button
                    type="button"
                    className="px-3 py-1 text-sm rounded border"
                    onClick={copyOnlyOptIn}
                    title="Copia solo los teléfonos que tienen opt-in=true"
                  >
                    Copiar solo números (opt-in)
                  </button>
                </div>

                {showNumbers && (
                  <textarea
                    readOnly
                    className="mt-2 w-full min-h-[160px] font-mono text-sm border rounded p-2"
                    value={numbersText}
                    placeholder="No hay coincidencias para las etiquetas seleccionadas."
                  />
                )}
              </>
            ) : (
              <div className="text-sm text-gray-600">Elegí 1+ etiquetas para listar destinatarios.</div>
            )}
          </div>
        ) : null}
      </div>

      {/* Cumplimiento */}
      <div className="p-3 mb-4 space-y-1 text-sm rounded-lg border">
        <label className="flex gap-2 items-center">
          <input type="checkbox" checked={confirmOptIn} onChange={(e) => setConfirmOptIn(e.target.checked)} />
          Confirmo que todos los contactos tienen <b>opt-in</b> para recibir mensajes de WhatsApp de este negocio.
        </label>
        <label className="flex gap-2 items-center">
          <input type="checkbox" checked={confirmTemplate} onChange={(e) => setConfirmTemplate(e.target.checked)} />
          Confirmo que usaré <b>la plantilla aprobada</b> por Meta para este envío.
        </label>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <button
          type="button"
          className={`px-4 py-2 rounded text-white ${canSend ? "bg-black" : "bg-gray-400 cursor-not-allowed"}`}
          disabled={!canSend || sending}
          onClick={handleSend}
        >
          {sending ? "Enviando…" : `Enviar a ${totalToSend} contactos`}
        </button>
        {!tpl && (
          <span className="text-sm text-red-700">No se puede enviar: la plantilla bloqueada aún no está aprobada/visible.</span>
        )}
        <label className="flex gap-2 items-center ml-auto text-sm">
          <span>Delay (ms)</span>
          <input
            type="number"
            min={100}
            step={100}
            className="p-1 w-24 rounded border"
            value={delayMs}
            onChange={(e) => setDelayMs(parseInt(e.target.value || "800", 10))}
          />
        </label>
      </div>

      {/* Resultado por número */}
      {rowsState.length > 0 && (
        <div className="overflow-auto max-h-80 rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">Teléfono</th>
                <th className="p-2 text-left">Estado</th>
                <th className="p-2 text-left">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {rowsState.map((r) => (
                <tr key={r.phone} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 font-mono">{r.phone}</td>
                  <td className="p-2">{r.status === "pending" ? "⏳ Enviando" : r.status === "ok" ? "✅ OK" : "❌ Error"}</td>
                  <td className="p-2">{r.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 space-y-1 text-xs text-gray-500">
        <p>💡 Tip: si recibís <code>429 Too Many Requests</code>, aumentá el delay entre envíos o dividí la lista en tandas.</p>
        <p>🔒 Cumplimiento: fuera de 24h de la última interacción del usuario, <b>solo</b> se puede enviar <i>template messages</i> aprobados, y solo a contactos con opt-in.</p>
      </div>
    </div>
  );
}

function LabelsBlock({ labelsLoading, labelsError, allLabels, selectedLabels, setSelectedLabels }) {
  if (labelsLoading) return <div className="text-sm text-gray-600">Cargando etiquetas…</div>;
  if (labelsError) return <div className="text-sm text-red-600">{labelsError}</div>;
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {allLabels.map((l) => {
        const on = selectedLabels.includes(l.slug);
        return (
          <label key={l.slug} className="flex gap-2 items-center text-sm">
            <input
              type="checkbox"
              checked={on}
              onChange={() => setSelectedLabels((prev) => on ? prev.filter((s) => s !== l.slug) : [...prev, l.slug])}
            />
            <span>{l.name || l.slug}</span>
          </label>
        );
      })}
    </div>
  );
}
function PreviewTable({ rows }) {
  return (
    <div className="overflow-auto max-h-40 rounded border">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-1 text-left">Teléfono (E.164)</th>
            <th className="p-1 text-left">Último mensaje</th>
            <th className="p-1 text-left">Etiquetas</th>
            <th className="p-1 text-left">Opt-in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.phone} className="odd:bg-white even:bg-gray-50">
              <td className="p-1 font-mono">{r.phone}</td>
              <td className="p-1">{r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString() : "—"}</td>
              <td className="p-1">{(Array.isArray(r.labels) ? r.labels : []).join(", ")}</td>
              <td className="p-1">{r.optIn ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
