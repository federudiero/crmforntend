import React, { useEffect, useRef, useState } from "react";
import { sanitizeParamText } from "../lib/chat/text.js";
import {
    COMBOS_TEMPLATE_NAME,
    COMBOS_TEMPLATE_LANG,
    combosTimeGreeting,
} from "../lib/chat/templates.js";
import { getSellerDisplayName } from "../lib/chat/seller.js";

export default function CombosModal({
    open,
    onClose,
    conversationId,
    user,
    convMeta,
    sendMessage,
    sending,
    setSending,
}) {
    const [vars, setVars] = useState({ v1: "", v2: "", v3: "" });
    const firstInputRef = useRef(null);

    useEffect(() => {
        if (!open) return;

        const vendedor = getSellerDisplayName({
            alias: convMeta?.assignedToName || "",
            name: user?.displayName || user?.name || "",
            email: user?.email || "",
        });

        setVars((prev) => ({
            v1: prev.v1 || combosTimeGreeting(),
            v2: vendedor || "Equipo de Ventas",
            v3: prev.v3 || "",
        }));

        // foco al abrir
        requestAnimationFrame(() => firstInputRef.current?.focus());

        // cerrar con ESC
        const onKeyDown = (e) => {
            if (e.key === "Escape") onClose?.();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, user?.email, user?.displayName, convMeta?.assignedToName, onClose]);

    if (!open) return null;

    const canSend = vars.v2.trim().length > 0 && vars.v3.trim().length > 0;

    const previewText = `${vars.v1 ? `Hola ${vars.v1}, ` : ""}soy ${vars.v2} de HogarCril.
Hoy tenemos estas promos:
${(vars.v3 || "").trim()}
¿Querés que te reserve alguno?`;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                className="w-full max-w-xl overflow-hidden border shadow-2xl rounded-2xl bg-base-100 text-base-content border-base-300"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header de color */}
                <div className="flex items-center justify-between px-5 py-4 bg-primary text-primary-content">
                    <h3 className="text-base font-semibold md:text-lg">Enviar combos a este chat</h3>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-circle text-primary-content"
                        onClick={onClose}
                        aria-label="Cerrar"
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 md:p-5">
                    <div className="grid gap-3">
                        <div>
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium opacity-80">
                                    {"{{1}}"} — Saludo / nombre (opcional)
                                </span>
                            </div>
                            <input
                                ref={firstInputRef}
                                className="w-full mt-1 input input-bordered"
                                value={vars.v1}
                                onChange={(e) => setVars((v) => ({ ...v, v1: e.target.value }))}
                                placeholder="buenas tardes • Juli • ¡hola!"
                            />
                        </div>

                        <div>
                            <span className="text-xs font-medium opacity-80">
                                {"{{2}}"} — Vendedor (requerido)
                            </span>
                            <input
                                className="w-full mt-1 input input-bordered"
                                value={vars.v2}
                                onChange={(e) => setVars((v) => ({ ...v, v2: e.target.value }))}
                                placeholder="Camila / Juliana / Equipo de Ventas"
                            />
                        </div>

                        <div>
                            <span className="text-xs font-medium opacity-80">
                                {"{{3}}"} — Combos (uno por línea) (requerido)
                            </span>
                            <textarea
                                rows={6}
                                className="w-full mt-1 textarea textarea-bordered font-mono whitespace-pre-wrap"
                                value={vars.v3}
                                onChange={(e) => setVars((v) => ({ ...v, v3: e.target.value }))}
                                placeholder={`Látex eco + rodillo + enduido + fijador $25.000
Látex premium + rodillo + enduido $32.000
Látex lavable + rodillo + enduido $35.100`}
                            />
                            <p className="mt-1 text-xs opacity-70">Tip: cada línea es un combo.</p>
                        </div>
                    </div>

                    {/* Vista previa */}
                    <div className="p-4 mt-4 border rounded-xl bg-base-200 border-base-300">
                        <div className="mb-2 text-sm font-semibold opacity-90">Vista previa (aproximada):</div>
                        <pre className="text-sm whitespace-pre-wrap">{previewText}</pre>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center justify-end gap-2 mt-5">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>
                            Cancelar
                        </button>

                        <button
                            type="button"
                            className={`btn btn-primary ${sending ? "loading" : ""}`}
                            disabled={!canSend || sending}
                            onClick={async () => {
                                try {
                                    const p1raw = (vars.v1 || "").trim();
                                    const p1 = p1raw ? sanitizeParamText(p1raw) : "\u200B";
                                    const p2 = sanitizeParamText((vars.v2 || "").trim());
                                    const p3 = sanitizeParamText((vars.v3 || "").trim());

                                    const sellerName = getSellerDisplayName({
                                        alias: convMeta?.assignedToName || "",
                                        name: user?.displayName || user?.name || "",
                                        email: user?.email || "",
                                    });

                                    const templatePayload = {
                                        name: COMBOS_TEMPLATE_NAME,
                                        language: { code: COMBOS_TEMPLATE_LANG },
                                        components: [
                                            {
                                                type: "body",
                                                parameters: [
                                                    { type: "text", text: p1 },
                                                    { type: "text", text: p2 },
                                                    { type: "text", text: p3 },
                                                ],
                                            },
                                        ],
                                    };

                                    onClose();
                                    setSending(true);

                                    const tplRes = await sendMessage({
                                        to: String(conversationId),
                                        conversationId,
                                        sellerName,
                                        template: templatePayload,
                                    });

                                    if (tplRes?.ok === false) alert("No se pudo enviar la plantilla de combos.");
                                } finally {
                                    setSending(false);
                                }
                            }}
                        >
                            Enviar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
