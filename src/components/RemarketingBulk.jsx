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
  try { data = text ? JSON.parse(text) : {}; } catch { /* noop */ }
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
  const [tagPhones, setTagPhones] = useState([]);
  const [tagPhonesMeta, setTagPhonesMeta] = useState([]);
  const [tagPhonesLoading, setTagPhonesLoading] = useState(false);

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

  // ---------- Carga de etiquetas ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLabelsLoading(true);
        setLabelsError("");
        const base = await listLabels();
        // Deducir de conversations
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
        } catch (e) {
          console.warn("deduce labels from conversations error:", e);
        }
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
        if (!selectedLabels.length) { setTagPhones([]); setTagPhonesMeta([]); return; }
        setTagPhonesLoading(true);
        const byPhone = new Map();
        for (const ch of chunk(selectedLabels, 10)) {
          const q = query(
            collection(db, "conversations"),
            where("optIn", "==", true),
            where("labels", "array-contains-any", ch),
            orderBy("lastMessageAt", "desc"),
            limit(1000)
          );
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            const data = d.data();
            const phone = normPhone(data.contactId || data.phone || d.id);
            if (!phone) continue;
            const t = data.lastMessageAt?.toMillis?.()
              ? data.lastMessageAt.toMillis()
              : (data.lastMessageAt ? +new Date(data.lastMessageAt) : 0);
            const labelsArr = Array.isArray(data.labels) ? data.labels : [];
            byPhone.set(phone, { phone, lastMessageAt: t, labels: labelsArr, optIn: data.optIn === true });
          }
        }
        const arr = Array.from(byPhone.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
        if (!cancelled) { setTagPhones(arr.map((r) => r.phone)); setTagPhonesMeta(arr); }
      } catch (e) {
        console.error("search convs by labels error:", e);
        if (!cancelled) { setTagPhones([]); setTagPhonesMeta([]); }
      } finally { if (!cancelled) setTagPhonesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedLabels]);

  useEffect(() => { if (destMode === "tags" && mode === "csv") setMode("global"); }, [destMode, mode]);

  const totalToSend = useMemo(() => destMode === "tags" ? tagPhones.length : (mode === "global" ? numbers.length : csvPreview.length), [destMode, tagPhones, mode, numbers, csvPreview]);

  const hasLockedTemplate = Boolean(tpl);

  const canSend = useMemo(() => {
    if (!hasLockedTemplate) return false;
    if (!confirmOptIn || !confirmTemplate) return false;
    if (destMode === "tags") {
      if (varCount <= 0) return false;
      return totalToSend > 0 && vars.slice(0, varCount).every((v) => String(v || "").length > 0);
    }
    if (mode === "global") {
      return numbers.length > 0 && vars.slice(0, varCount).every((v) => String(v || "").length > 0);
    }
    if (mode === "csv") {
      return csvPreview.length > 0 && csvPreview.every((r) => r.phone && Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`]).every((x) => (x ?? "").length > 0));
    }
    return false;
  }, [hasLockedTemplate, confirmOptIn, confirmTemplate, destMode, totalToSend, mode, numbers, vars, csvPreview, varCount]);

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);

    const list = destMode === "tags"
      ? tagPhones.map((phone) => ({ phone, vars: vars.slice(0, varCount) }))
      : (mode === "global"
        ? numbers.map((phone) => ({ phone, vars: vars.slice(0, varCount) }))
        : csvPreview.map((r) => ({ phone: r.phone, vars: Array.from({ length: varCount }, (_, i) => r[`v${i + 1}`]) }))
      );

    setRowsState(list.map((x) => ({ phone: x.phone, status: "pending" })));
    setProgress({ sent: 0, ok: 0, fail: 0 });

    for (let i = 0; i < list.length; i++) {
      const { phone, vars } = list[i];
      try {
        const components = [{ type: "body", parameters: vars.map((t) => ({ type: "text", text: String(t) })) }];
        await sendTemplate({ phone, components });
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "ok" } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok + 1, fail: p.fail }));
      } catch (err) {
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "fail", error: String(err?.message || err) } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok, fail: p.fail + 1 }));
      }
      // eslint-disable-next-line no-await-in-loop
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

      {/* Plantilla (solo lectura) */}
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
                  placeholder={`{{${idx + 1}}}`}
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
            <p className="text-xs text-gray-600">Formato: <code>phone,var1,var2,...</code></p>
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
          <label className="flex gap-2 items-center text-sm">
            <input type="radio" name="dest" value="manual" checked={destMode === "manual"} onChange={() => setDestMode("manual")} />
            Pegar números
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

            <div className="text-xs text-gray-600">Seleccionadas: {selectedLabels.length} · Teléfonos con opt-in: {tagPhones.length}</div>
            {tagPhonesLoading ? (
              <div className="text-sm text-gray-600">Buscando conversaciones con opt-in…</div>
            ) : tagPhonesMeta.length > 0 ? (
              <PreviewTable rows={tagPhonesMeta} />
            ) : (
              <div className="text-sm text-gray-600">Elegí 1+ etiquetas para listar destinatarios con opt-in.</div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Teléfonos destino</label>
            <textarea
              className="border rounded p-2 w-full min-h-[100px] font-mono"
              placeholder={"Pegá uno por línea o separados por coma/espacio. Ej:\n+5491122334455\n+5491133344455"}
              value={rawPhones}
              onChange={(e) => setRawPhones(e.target.value)}
            />
            <div className="text-xs text-gray-600">Válidos: {numbers.length}</div>
          </div>
        )}
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
            <input type="checkbox" checked={on} onChange={() => setSelectedLabels((prev) => on ? prev.filter((s) => s !== l.slug) : [...prev, l.slug])} />
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.phone} className="odd:bg-white even:bg-gray-50">
              <td className="p-1 font-mono">{r.phone}</td>
              <td className="p-1">{r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString() : "—"}</td>
              <td className="p-1">{(Array.isArray(r.labels) ? r.labels : []).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
