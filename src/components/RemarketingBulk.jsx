// src/components/RemarketingBulk.jsx
// Componente 100% funcional para enviar plantillas de WhatsApp a múltiples números
// Cumple políticas: exige opt‑in explícito, solo permite mensajes de PLANTILLA,
// pide confirmación antes de enviar, registra estado y limita el ritmo para evitar bloqueos.

import React, { useEffect, useMemo, useRef, useState } from "react";

// ————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————
/** Normaliza a E.164 (+549...) sin espacios ni símbolos extras */
function normPhone(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  // Quita todo lo que no sea dígito excepto el + inicial
  const cleaned = s.startsWith("+")
    ? "+" + s.slice(1).replace(/\D+/g, "")
    : "+" + s.replace(/\D+/g, "");
  // Reglas mínimas de sanidad: entre 8 y 15 dígitos (E.164)
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return "";
  return cleaned;
}

/** Cuenta variables {{1}}, {{2}}, ... de la plantilla */
function countTemplateVars(templateBody = "") {
  const matches = templateBody.match(/\{\{\d+\}\}/g) || [];
  // Máximo índice usado ({{1}}..{{N}})
  const maxIndex = matches
    .map((m) => parseInt(m.replace(/\{|\}/g, ""), 10))
    .reduce((a, b) => Math.max(a, b), 0);
  return maxIndex;
}

/** Espera utilitaria */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ————————————————————————————————————————————
// API call — Ajustá la URL a tu backend que llama a Meta Cloud API
// ————————————————————————————————————————————
async function sendTemplate({
  phone, // destino E.164
  templateName,
  language = "es_AR",
  components = [], // [{ type: "body", parameters: [{type:"text", text:"..."}] }]
}) {
  // Por diseño esto SOLO envía plantillas aprobadas (template messages)
  // Tu backend debe usar el endpoint de Cloud API:
  // POST https://graph.facebook.com/v19.0/{PHONE_NUMBER_ID}/messages
  // { messaging_product: "whatsapp", to: phone, type: "template", template: { name, language: {code}, components } }

  const resp = await fetch("/api/waba/send-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, templateName, language, components }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ————————————————————————————————————————————
// Componente principal
// ————————————————————————————————————————————
export default function RemarketingBulk() {
  // Plantillas demostración — reemplazá por tus plantillas aprobadas (Cloud API)
  const demoTemplates = useMemo(
    () => [
      {
        name: "promo_agosto",
        language: "es_AR",
        body: "Hola {{1}}! 👋 Tenemos una promo en {{2}} válida hasta {{3}}. ¿Te interesa más info?",
        note: "Ejemplo: {{1}}=Nombre, {{2}}=Producto/servicio, {{3}}=Fecha",
      },
      {
        name: "recordatorio_visita",
        language: "es_AR",
        body: "Hola {{1}}, te recordamos tu visita el {{2}} a las {{3}}. Respondé *OK* para confirmar.",
        note: "Ejemplo: {{1}}=Nombre, {{2}}=Fecha, {{3}}=Hora",
      },
    ],
    []
  );

  const [templateIdx, setTemplateIdx] = useState(0);
  const tpl = demoTemplates[templateIdx];
  const varCount = countTemplateVars(tpl?.body || "");

  // Variables dinámicas: mismas para todos o por fila CSV
  const [vars, setVars] = useState(() => Array.from({ length: varCount }, () => ""));
  useEffect(() => {
    // Cuando cambia la plantilla, reinicia variables
    setVars(Array.from({ length: varCount }, () => ""));
  }, [templateIdx]);

  // Lista de teléfonos pegados o importados
  const [rawPhones, setRawPhones] = useState("");
  const numbers = useMemo(() => {
    const rows = rawPhones
      .split(/\n|,|;|\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const normed = rows.map(normPhone).filter(Boolean);
    // Deja únicos para evitar duplicados accidentales
    return Array.from(new Set(normed));
  }, [rawPhones]);

  // Modo de variables: "global" (todas iguales) o "csv" (por fila)
  const [mode, setMode] = useState("global");
  const [csvPreview, setCsvPreview] = useState([]); // [{phone, v1, v2...}]

  // Confirmaciones de cumplimiento
  const [confirmOptIn, setConfirmOptIn] = useState(false);
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  // Envío
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, ok: 0, fail: 0 });
  const [rowsState, setRowsState] = useState([]); // [{phone, status: 'pending'|'ok'|'fail', error?}]

  const fileInputRef = useRef(null);

  // Carga CSV: columnas esperadas -> phone, var1, var2... (coinciden con {{1}}, {{2}}..)
  const onCsvUpload = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
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

  const canSend = useMemo(() => {
    if (!tpl) return false;
    if (!confirmOptIn || !confirmTemplate) return false;
    if (mode === "global") {
      return numbers.length > 0 && vars.slice(0, varCount).every((v) => String(v || "").length > 0);
    }
    if (mode === "csv") {
      return csvPreview.length > 0 && csvPreview.every((r) => r.phone && Array.from({ length: varCount }, (_, i) => r[`v${i+1}`]).every((x) => (x ?? "").length > 0));
    }
    return false;
  }, [tpl, confirmOptIn, confirmTemplate, mode, numbers, vars, csvPreview, varCount]);

  const handleSend = async () => {
    if (!canSend || sending) return;
    setSending(true);

    const list = mode === "global"
      ? numbers.map((phone) => ({ phone, vars: vars.slice(0, varCount) }))
      : csvPreview.map((r) => ({ phone: r.phone, vars: Array.from({ length: varCount }, (_, i) => r[`v${i+1}`]) }));

    setRowsState(list.map((x) => ({ phone: x.phone, status: "pending" })));
    setProgress({ sent: 0, ok: 0, fail: 0 });

    // Límite de ritmo conservador (evita ráfagas): ~1 msg / 800 ms
    // Ajustá si tu número tiene mayor throughput.
    for (let i = 0; i < list.length; i++) {
      const { phone, vars } = list[i];
      try {
        const components = [
          {
            type: "body",
            parameters: vars.map((t) => ({ type: "text", text: String(t) })),
          },
        ];
        await sendTemplate({ phone, templateName: tpl.name, language: tpl.language, components });

        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "ok" } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok + 1, fail: p.fail }));
      } catch (err) {
        setRowsState((prev) => prev.map((r) => (r.phone === phone ? { ...r, status: "fail", error: String(err?.message || err) } : r)));
        setProgress((p) => ({ sent: p.sent + 1, ok: p.ok, fail: p.fail + 1 }));
      }
      // Espera entre envíos
      // Si recibís errores de rate limit (429), aumentá este delay.
      // También podés detectar 429 y hacer backoff exponencial.
      // Aquí usamos 800 ms por defecto.
      // eslint-disable-next-line no-await-in-loop
      await sleep(800);
    }

    setSending(false);
  };

  return (
    <div className="max-w-4xl p-4 mx-auto">
      <h2 className="mb-2 text-2xl font-bold">📣 Remarketing por Plantillas (WhatsApp)</h2>
      <p className="mb-4 text-sm text-gray-600">
        Solo se permiten <b>mensajes de plantilla aprobada</b> (fuera de la ventana de 24h) y únicamente a contactos con <b>opt‑in válido</b>. Este módulo exige ambas condiciones.
      </p>

      {/* Selección de plantilla */}
      <div className="p-3 mb-4 space-y-2 border rounded-lg">
        <label className="block text-sm font-semibold">Plantilla</label>
        <select
          className="w-full p-2 border rounded"
          value={templateIdx}
          onChange={(e) => setTemplateIdx(parseInt(e.target.value, 10))}
        >
          {demoTemplates.map((t, i) => (
            <option key={t.name} value={i}>
              {t.name} · {t.language}
            </option>
          ))}
        </select>
        {tpl?.body && (
          <div className="p-2 text-sm border rounded bg-gray-50">
            <div className="font-mono whitespace-pre-wrap">{tpl.body}</div>
            {tpl.note && <div className="mt-1 text-gray-500">{tpl.note}</div>}
          </div>
        )}
      </div>

      {/* Variables */}
      <div className="p-3 mb-4 space-y-2 border rounded-lg">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Variables</span>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="global" checked={mode === "global"} onChange={() => setMode("global")} />
            Mismas para todos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="csv" checked={mode === "csv"} onChange={() => setMode("csv")} />
            Por fila (CSV)
          </label>
        </div>

        {mode === "global" ? (
          <div className="grid gap-2 md:grid-cols-3">
            {Array.from({ length: varCount }).map((_, idx) => (
              <input
                key={idx}
                className="p-2 border rounded"
                placeholder={`{{${idx + 1}}}`}
                value={vars[idx] || ""}
                onChange={(e) => {
                  const v = [...vars];
                  v[idx] = e.target.value;
                  setVars(v);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={(e) => onCsvUpload(e.target.files?.[0])}
              />
              <button
                type="button"
                className="px-3 py-1 border rounded"
                onClick={() => fileInputRef.current?.click()}
              >
                Cargar CSV
              </button>
            </div>
            <p className="text-xs text-gray-600">Formato: <code>phone,var1,var2,...</code> — Ej: <code>+5491122334455,Fede,Impermeabilizante,31/08</code></p>
            {csvPreview.length > 0 && (
              <div className="overflow-auto text-sm border rounded max-h-40">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-1 text-left">phone</th>
                      {Array.from({ length: varCount }).map((_, i) => (
                        <th key={i} className="p-1 text-left">v{i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.map((r, i) => (
                      <tr key={i} className="odd:bg-white even:bg-gray-50">
                        <td className="p-1 font-mono">{r.phone}</td>
                        {Array.from({ length: varCount }).map((_, j) => (
                          <td key={j} className="p-1">{r[`v${j + 1}`]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Teléfonos */}
      <div className="p-3 mb-4 space-y-2 border rounded-lg">
        <label className="block text-sm font-semibold">Teléfonos destino</label>
        <textarea
          className="border rounded p-2 w-full min-h-[100px] font-mono"
          placeholder={"Pegá uno por línea o separados por coma/espacio. Ej:\n+5491122334455\n+5491133344455"}
          value={rawPhones}
          onChange={(e) => setRawPhones(e.target.value)}
        />
        <div className="text-xs text-gray-600">Válidos: {numbers.length}</div>
      </div>

      {/* Cumplimiento */}
      <div className="p-3 mb-4 space-y-1 text-sm border rounded-lg">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmOptIn} onChange={(e) => setConfirmOptIn(e.target.checked)} />
          Confirmo que todos los contactos dieron <b>opt‑in</b> para recibir mensajes de WhatsApp de este negocio.
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmTemplate} onChange={(e) => setConfirmTemplate(e.target.checked)} />
          Confirmo que usaré <b>únicamente una plantilla aprobada</b> por Meta para este envío.
        </label>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          className={`px-4 py-2 rounded text-white ${canSend ? "bg-black" : "bg-gray-400 cursor-not-allowed"}`}
          disabled={!canSend || sending}
          onClick={handleSend}
        >
          {sending ? "Enviando…" : `Enviar a ${mode === "global" ? numbers.length : csvPreview.length} contactos`}
        </button>
        <span className="text-sm text-gray-600">{progress.sent > 0 && `Progreso: ${progress.ok} OK · ${progress.fail} errores / ${mode === "global" ? numbers.length : csvPreview.length}`}</span>
      </div>

      {/* Resultado por número */}
      {rowsState.length > 0 && (
        <div className="overflow-auto border rounded-lg max-h-80">
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
                  <td className="p-2">
                    {r.status === "pending" && "⏳ Enviando"}
                    {r.status === "ok" && "✅ OK"}
                    {r.status === "fail" && "❌ Error"}
                  </td>
                  <td className="p-2">{r.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 space-y-1 text-xs text-gray-500">
        <p>💡 Tip: si recibís <code>429 Too Many Requests</code>, aumentá el delay entre envíos o dividí la lista en tandas.</p>
        <p>🔒 Cumplimiento: fuera de 24h de la última interacción del usuario, <b>solo</b> se puede enviar <i>template messages</i> aprobados, y solo a contactos con opt‑in. Dentro de 24h podés responder con sesión. Respeta las políticas anti‑spam de WhatsApp.</p>
      </div>
    </div>
  );
}
