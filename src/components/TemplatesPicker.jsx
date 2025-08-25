// src/components/TemplatesPicker.jsx
import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { listTemplates, renderTemplate } from "../lib/templates";

function Portal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export default function TemplatesPicker({
  onInsert,
  context = {},
  placement = "auto",
  anchorToBody = true,
  backdrop = true,
  mode = "modal", // "modal" centrado | "panel" anclado
}) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [actualPlacement, setActualPlacement] = useState("down");
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 420 });

  // Cargar plantillas
  useEffect(() => {
    (async () => {
      try {
        const out = await listTemplates();
        setItems(out || []);
      } catch {
        setItems([]);
      }
    })();
  }, []);

  // Cerrar con click afuera (solo panel) + ESC (ambos)
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (mode === "modal") return;
      if (!panelRef.current && !btnRef.current) return;
      if (panelRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, mode]);

  // Bloqueo de scroll al abrir modal
  useEffect(() => {
    if (!open || mode !== "modal") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, mode]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(term) ||
        (t.folder || "").toLowerCase().includes(term) ||
        (t.body || "").toLowerCase().includes(term)
    );
  }, [q, items]);

  // Posicionamiento del panel flotante (modo "panel")
  useLayoutEffect(() => {
    if (!open || !btnRef.current || mode !== "panel") return;
    const rect = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const desiredH = 360,
      margin = 8;
    const panelW = Math.min(448, vw - margin * 2);

    let wantUp = false;
    if (placement === "up") wantUp = true;
    else if (placement === "down") wantUp = false;
    else {
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      wantUp = spaceBelow < desiredH && spaceAbove > spaceBelow;
    }
    setActualPlacement(wantUp ? "up" : "down");

    const left = Math.min(rect.right, vw - margin) - panelW;
    let top = wantUp ? rect.top - margin - desiredH : rect.bottom + margin;

    const safeLeft = Math.max(margin, left);
    const safeTop = Math.max(margin, Math.min(top, vh - margin - desiredH));
    setCoords({ left: safeLeft, top: safeTop, width: panelW });
  }, [open, placement, mode]);

  // ---------- Renders ----------
  const PanelFloating = (
    <>
      {backdrop && (
        <div
          className="fixed inset-0 z-[99998] bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        ref={panelRef}
        className="fixed z-[99999] rounded-xl border bg-base-100 shadow-xl"
        style={{
          left: coords.left,
          top: coords.top,
          width: Math.min(coords.width, typeof window !== "undefined" ? window.innerWidth - 16 : 420),
          maxWidth: "95vw",
        }}
      >
        <div className="gap-2 card-body">
          <input
            className="input input-sm input-bordered"
            placeholder="Buscar plantilla…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="max-h-[360px] overflow-y-auto divide-y">
            {filtered.map((t, idx) => (
              <div key={idx} className="py-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.name}</div>
                  <span className="px-2 py-0.5 text-xs rounded bg-base-200">
                    {t.folder || "General"}
                  </span>
                </div>
                <div className="mt-1 text-sm whitespace-pre-wrap opacity-80">
                  {renderTemplate(t.body, { ...context, __preview: true })}
                </div>
                <div className="mt-2 text-right">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => {
                      const text = renderTemplate(t.body, context);
                      onInsert?.(text);
                      setOpen(false);
                    }}
                  >
                    Insertar
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="py-3 text-sm opacity-70">Sin resultados</div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const ModalCentered = (
    <>
      {backdrop && (
        <div
          className="fixed inset-0 z-[99998] bg-black/60"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
        <div className="w-[min(560px,92vw)] max-h-[85vh] overflow-hidden rounded-2xl border bg-base-100 shadow-2xl">
          <div className="flex items-center gap-2 p-3 border-b">
            <input
              className="w-full input input-sm input-bordered"
              placeholder="Buscar plantilla…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              aria-label="Cerrar"
              onClick={() => setOpen(false)}
              title="Cerrar"
            >
              ✕
            </button>
          </div>
          <div
            className="p-3 space-y-3 overflow-y-auto"
            style={{ maxHeight: "calc(85vh - 56px)" }}
          >
            {filtered.map((t, idx) => (
              <div key={idx} className="pb-3 border-b last:border-0">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.name}</div>
                  <span className="px-2 py-0.5 text-xs rounded bg-base-200">
                    {t.folder || "General"}
                  </span>
                </div>
                <div className="mt-1 text-sm whitespace-pre-wrap opacity-80">
                  {renderTemplate(t.body, { ...context, __preview: true })}
                </div>
                <div className="mt-2 text-right">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={() => {
                      const text = renderTemplate(t.body, context);
                      onInsert?.(text);
                      setOpen(false);
                    }}
                  >
                    Insertar
                  </button>
                </div>
              </div>
            ))}
            {!filtered.length && (
              <div className="py-3 text-sm opacity-70">Sin resultados</div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="inline-block">
      <button
        ref={btnRef}
        className="text-black btn btn-sm bg-base-200"
        type="button"
        onClick={() => setOpen((o) => !o)}
      >
        Plantillas
      </button>

      {/* Cuando anchorToBody=true, renderizamos en portal para evitar transform/overflow de ancestros */}
      {open && anchorToBody ? (
        <Portal>{mode === "modal" ? ModalCentered : PanelFloating}</Portal>
      ) : (
        open &&
        !anchorToBody &&
        mode === "panel" && (
          <div
            className={`absolute right-0 ${
              actualPlacement === "up" ? "bottom-full mb-2" : "top-full mt-2"
            }`}
          >
            {PanelFloating}
          </div>
        )
      )}
    </div>
  );
}
