// src/components/NewConversation.jsx
import React, { useEffect, useState, useRef } from "react";
import { sendMessage } from "../services/api";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuthState } from "../hooks/useAuthState.js";

/**
 * PLANTILLAS PREDETERMINADAS (ejemplos):
 * - name: debe coincidir con el nombre aprobado en Meta WABA.
 * - language.code: idioma de la plantilla (ajustalo a tu configuración real).
 * - params: estructura para pintar inputs y mapear a components/body.parameters.
 *
 * Nota: Podés agregar/quitar plantillas sin tocar la lógica.
 */
const PRESET_TEMPLATES = [
  {
    id: "bienvenida_general",
    name: "bienvenida_general", // <-- nombre exacto en WABA
    language: { code: "es_AR" },
    title: "Bienvenida general",
    description:
      "Saludo inicial para iniciar conversación en frío. Incluye el nombre del contacto.",
    params: [
      { key: "nombre", label: "Nombre del cliente", placeholder: "Ej: Ana", required: true },
    ],
    // body con 1 parámetro: {{1}} => nombre
    buildComponents: (vals) => [
      { type: "body", parameters: [{ type: "text", text: vals.nombre || "" }] },
    ],
  },
  {
    id: "seguimiento_pedido",
    name: "seguimiento_pedido", // <-- nombre exacto en WABA
    language: { code: "es_AR" },
    title: "Seguimiento de pedido",
    description:
      "Aviso de seguimiento para retomar conversación al día siguiente.",
    params: [
      { key: "nombre", label: "Nombre del cliente", placeholder: "Ej: Lucas", required: true },
      { key: "nroPedido", label: "N° de pedido", placeholder: "Ej: 1243", required: true },
    ],
    // body con 2 parámetros: {{1}}=nombre, {{2}}=nroPedido
    buildComponents: (vals) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: vals.nombre || "" },
          { type: "text", text: vals.nroPedido || "" },
        ],
      },
    ],
  },
  {
    id: "promocion_simple",
    name: "promocion_simple", // <-- nombre exacto en WABA
    language: { code: "es_AR" },
    title: "Promoción simple",
    description:
      "Mensaje corto para informar una promo (sin parámetros).",
    params: [],
    buildComponents: () => [], // sin parámetros
  },
  {
    id: "recordatorio_pago",
    name: "recordatorio_pago", // <-- nombre exacto en WABA
    language: { code: "es_AR" },
    title: "Recordatorio de pago",
    description:
      "Recordatorio con monto y fecha. Ideal para retomar conversación.",
    params: [
      { key: "nombre", label: "Nombre del cliente", placeholder: "Ej: Sofía", required: true },
      { key: "monto", label: "Monto", placeholder: "Ej: 41.500", required: true },
      { key: "fecha", label: "Fecha límite", placeholder: "Ej: 03/10", required: true },
    ],
    // body con 3 parámetros: {{1}}=nombre, {{2}}=monto, {{3}}=fecha
    buildComponents: (vals) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: vals.nombre || "" },
          { type: "text", text: vals.monto || "" },
          { type: "text", text: vals.fecha || "" },
        ],
      },
    ],
  },
];

export default function NewConversation({ onOpen }) {
  const { user } = useAuthState();

  // ---- estado original (se mantiene la lógica) ----
  const [to, setTo] = useState("+549");
  const [text, setText] = useState("Hola");
  const [loading, setLoading] = useState(false);

  const [senders, setSenders] = useState([]);
  const [selectedSender, setSelectedSender] = useState("");

  // ---- modal state ----
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  // ---- NUEVO: envío por plantilla ----
  const [useTemplate, setUseTemplate] = useState(true); // por defecto, plantilla (para poder iniciar en frío)
  const [tplId, setTplId] = useState(PRESET_TEMPLATES[0]?.id || "");
  const [tplValues, setTplValues] = useState({}); // valores de parámetros

  // Cargar emisores (igual que antes)
  useEffect(() => {
    let cancelled = false;
    async function loadSenders() {
      try {
        if (!user?.uid) {
          setSenders([]); setSelectedSender(""); return;
        }
        let rows = [];

        const qAllowed = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("allowedUids", "array-contains", user.uid)
        );
        const snapAllowed = await getDocs(qAllowed);
        snapAllowed.forEach(d => rows.push({ id: d.id, ...d.data() }));

        const qOwner = query(
          collection(db, "wabaNumbers"),
          where("active", "==", true),
          where("ownerUid", "==", user.uid)
        );
        const snapOwner = await getDocs(qOwner);
        snapOwner.forEach(d => rows.push({ id: d.id, ...d.data() }));

        const seen = {};
        rows = rows.filter(r => (seen[r.id] ? false : (seen[r.id] = true)));
        rows.sort((a, b) => (a.phone || "").localeCompare(b.phone || ""));

        if (cancelled) return;
        setSenders(rows);
        setSelectedSender(prev => (prev ? prev : (rows[0]?.waPhoneId || "")));
      } catch (err) {
        console.error("loadSenders error:", err);
        if (!cancelled) { setSenders([]); setSelectedSender(""); }
      }
    }
    loadSenders();
    return () => { cancelled = true; };
  }, [user?.uid]);

  function renderSenderOptions() {
    if (senders.length === 0) return <option value="">(Sin emisores asignados)</option>;
    return senders.map(s => (
      <option key={s.id} value={s.waPhoneId || ""}>
        {s.phone || "(sin número)"}
      </option>
    ));
  }

  // Helpers de plantilla
  const selectedTemplate = PRESET_TEMPLATES.find(t => t.id === tplId) || PRESET_TEMPLATES[0];

  function handleTplValueChange(key, val) {
    setTplValues(prev => ({ ...prev, [key]: val }));
  }

  function validateTemplateParams() {
    if (!selectedTemplate) return "No hay plantilla seleccionada.";
    for (const p of (selectedTemplate.params || [])) {
      const v = (tplValues?.[p.key] || "").trim();
      if (p.required && !v) {
        return `Completar: ${p.label}`;
      }
    }
    return null;
  }

  async function create() {
    const phone = (to || "").trim();
    if (!phone || loading) return;

    if (!selectedSender) { alert("No tenés un emisor asignado para enviar."); return; }
    if (!phone.startsWith("+")) { alert("Usá formato internacional (ej: +54911...)."); return; }

    setLoading(true);
    try {
      let payload;

      if (useTemplate) {
        // Solo plantillas predeterminadas (no se permite nombre libre)
        if (!selectedTemplate) { alert("Seleccioná una plantilla."); setLoading(false); return; }

        // Validar parámetros requeridos
        const err = validateTemplateParams();
        if (err) { alert(err); setLoading(false); return; }

        payload = {
          to: phone,
          fromWaPhoneId: selectedSender,
          template: {
            name: selectedTemplate.name,
            language: selectedTemplate.language,
            components: selectedTemplate.buildComponents(tplValues),
          },
        };
      } else {
        // Texto libre (solo funcionará dentro de la ventana de 24 h)
        const body = (text || "").trim();
        if (!body) { alert("Escribí un mensaje o usá una plantilla."); setLoading(false); return; }

        payload = { to: phone, text: body, fromWaPhoneId: selectedSender };
      }

      const r = await sendMessage(payload);
      const convId = r?.results?.[0]?.to ? r.results[0].to : phone;

      // éxito → abrir conv y cerrar modal
      onOpen?.(convId);
      setText("Hola");
      setTo("+549");
      setTplValues({});
      setUseTemplate(true); // seguir fomentando plantillas para próximos inicios en frío
      setOpen(false);
    } catch (err) {
      console.error(err);
      alert(err?.message || "No se pudo crear");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !loading) create();
  }

  // accesibilidad: cerrar con ESC y clic fuera
  useEffect(() => {
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  const noSender = senders.length === 0 || !selectedSender;
  const singleSender = senders.length === 1;
  const singleSenderPhone = singleSender ? (senders[0].phone || "") : "";

  return (
    <>
      {/* Botón que abre el modal */}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setOpen(true)}
        title="Crear conversación"
      >
        Nueva
      </button>

      {/* Modal (full-screen en mobile, centrado en desktop) */}
      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-[10000] flex items-end md:items-center justify-center"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // cerrar si clic fuera de la tarjeta
            if (e.target === dialogRef.current) setOpen(false);
          }}
        >
          {/* overlay */}
          <div className="absolute inset-0 bg-black/50" />

          {/* card */}
          <div className="
            relative w-full md:w-[640px] bg-base-100 md:rounded-2xl
            shadow-xl border border-base-300
            max-h-[95vh] overflow-auto
            md:p-6 p-4
            ">
            {/* header */}
            <div className="flex gap-2 justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Nueva conversación</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(false)}
                title="Cerrar"
              >
                ✕
              </button>
            </div>

            {/* formulario */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Emisor */}
              {singleSender ? (
                <label className="form-control">
                  <span className="mb-1 label-text">Vendedor</span>
                  <input
                    className="pointer-events-none input input-bordered input-sm bg-base-200"
                    value={singleSenderPhone}
                    readOnly
                    tabIndex={-1}
                    aria-label="Emisor (único)"
                  />
                </label>
              ) : (
                <label className="form-control">
                  <span className="mb-1 label-text">Vendedor</span>
                  <select
                    className="select select-bordered select-sm"
                    title="Enviar desde (emisor)"
                    aria-label="Seleccionar emisor"
                    value={selectedSender}
                    onChange={(e) => setSelectedSender(e.target.value)}
                    disabled={senders.length <= 1}
                  >
                    {renderSenderOptions()}
                  </select>
                </label>
              )}

              {/* Cliente */}
              <label className="form-control">
                <span className="mb-1 label-text">Cliente</span>
                <input
                  className="input input-bordered input-sm"
                  placeholder="+549..."
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  onKeyDown={onKeyDown}
                  inputMode="tel"
                  aria-label="Número del cliente"
                />
              </label>

              {/* Toggle: usar plantilla */}
              <div className="md:col-span-2">
                <label className="gap-3 justify-start cursor-pointer label">
                  <input
                    type="checkbox"
                    className="toggle toggle-success"
                    checked={useTemplate}
                    onChange={(e) => setUseTemplate(e.target.checked)}
                  />
                  <span className="label-text">
                    Usar <b>plantilla aprobada</b> (recomendado y necesario para iniciar conversaciones fuera de 24 h)
                  </span>
                </label>
              </div>

              {/* Selector de plantilla + parámetros */}
              {useTemplate ? (
                <>
                  <label className="form-control md:col-span-2">
                    <span className="mb-1 label-text">Plantilla</span>
                    <select
                      className="select select-bordered"
                      value={tplId}
                      onChange={(e) => { setTplId(e.target.value); setTplValues({}); }}
                      aria-label="Seleccionar plantilla"
                    >
                      {PRESET_TEMPLATES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} — ({t.name}/{t.language.code})
                        </option>
                      ))}
                    </select>
                    {selectedTemplate?.description ? (
                      <span className="mt-1 text-xs opacity-70">{selectedTemplate.description}</span>
                    ) : null}
                  </label>

                  {/* Parámetros de la plantilla */}
                  {selectedTemplate?.params?.length ? (
                    <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                      {selectedTemplate.params.map((p) => (
                        <label key={p.key} className="form-control">
                          <span className="mb-1 label-text">
                            {p.label} {p.required && <span className="text-error">*</span>}
                          </span>
                          <input
                            className="input input-bordered input-sm"
                            placeholder={p.placeholder || ""}
                            value={tplValues[p.key] || ""}
                            onChange={(e) => handleTplValueChange(p.key, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                // Mensaje de texto (se deshabilita si useTemplate = true)
                <label className="form-control md:col-span-2">
                  <span className="mb-1 label-text">Mensaje</span>
                  <textarea
                    className="h-24 textarea textarea-bordered"
                    placeholder="Mensaje inicial"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => (e.key === "Enter" && e.ctrlKey) && create()}
                    aria-label="Mensaje inicial"
                    disabled={useTemplate}
                  />
                  <span className="mt-1 text-xs opacity-70">
                    {useTemplate
                      ? "Al usar plantilla, el texto libre queda deshabilitado."
                      : "Enter envía • Ctrl+Enter también"}
                  </span>
                </label>
              )}
            </div>

            {/* acciones */}
            <div className="flex flex-col gap-2 justify-end mt-4 md:flex-row">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button
                disabled={loading || noSender}
                onClick={create}
                className="btn btn-primary"
                type="button"
                title={noSender ? "Sin emisor asignado" : "Crear conversación"}
                aria-label="Crear conversación"
              >
                {loading ? "Enviando..." : (useTemplate ? "Enviar plantilla y abrir chat" : "Enviar y abrir chat")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
