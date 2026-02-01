import React, { useEffect, useState } from "react";
import { sanitizeParamText } from "../lib/chat/text.js";
import { COMBOS_TEMPLATE_NAME, COMBOS_TEMPLATE_LANG, combosTimeGreeting } from "../lib/chat/templates.js";
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
    }, [open, user?.email, user?.displayName, convMeta?.assignedToName]);

    if (!open) return null;

    const canSend = vars.v2.trim().length > 0 && vars.v3.trim().length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="w-full max-w-xl p-4 bg-white shadow-lg rounded-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold">Enviar combos a este chat</h3>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
                </div>

                <div className="grid gap-3">
                    <div>
                        <label className="text-xs font-medium">{"{{1}}"} — Saludo / nombre (opcional)</label>
                        <input
                            className="w-full p-2 mt-1 border rounded"
                            value={vars.v1}
                            onChange={(e) => setVars((v) => ({ ...v, v1: e.target.value }))}
                            placeholder="buen día • Juli • ¡hola!"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium">{"{{2}}"} — Vendedor (requerido)</label>
                        <input
                            className="w-full p-2 mt-1 border rounded"
                            value={vars.v2}
                            onChange={(e) => setVars((v) => ({ ...v, v2: e.target.value }))}
                            placeholder="Camila / Juliana / Equipo de Ventas"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium">{"{{3}}"} — Combos (uno por línea) (requerido)</label>
                        <textarea
                            rows={6}
                            className="w-full p-2 mt-1 font-mono whitespace-pre-wrap border rounded"
                            value={vars.v3}
                            onChange={(e) => setVars((v) => ({ ...v, v3: e.target.value }))}
                            placeholder={`Látex eco + rodillo + enduido + fijador $25.000
Látex premium + rodillo + enduido $32.000
Látex lavable + rodillo + enduido $35.100`}
                        />
                        <p className="mt-1 text-xs text-gray-500">Tips: cada línea es un combo.</p>
                    </div>
                </div>

                <div className="p-3 mt-3 text-sm border rounded bg-gray-50">
                    <div className="mb-1 font-medium">Vista previa (aproximada):</div>
                    <pre className="whitespace-pre-wrap">
                        {`${vars.v1 ? `Hola ${vars.v1}, ` : ""}soy ${vars.v2} de HogarCril.
Hoy tenemos estas promos:
${(vars.v3 || "").trim()}
¿Querés que te reserve alguno?`}
                    </pre>
                </div>

                <div className="flex items-center justify-end gap-2 mt-4">
                    <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
                    <button
                        className="btn btn-primary"
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
                                    components: [{ type: "body", parameters: [{ type: "text", text: p1 }, { type: "text", text: p2 }, { type: "text", text: p3 }] }],
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
    );
}
