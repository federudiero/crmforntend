export function logWaSendOutcome(label, apiResp, payload, extra = {}) {
    const r = apiResp?.results?.[0] || {};
    const code = r?.error?.error?.code ?? r?.error?.code ?? null;
    const err = r?.error?.error ?? r?.error ?? null;

    console.groupCollapsed(
        `%c[WA DEBUG] ${label} — ok:${apiResp?.ok ? "✅" : "❌"} code:${code ?? "-"}`,
        "color:#0aa"
    );
    console.log("→ payload.template", payload?.template);
    console.log("→ apiResp", apiResp);
    console.log("→ result", r);
    console.log("→ error.code", code, "error.obj", err);
    console.log("→ extras", extra);
    if (code === 131042) {
        console.warn("⚠️ Problema de pago (131042): revisar Pagos en Business Manager (producto WhatsApp).");
    }
    console.groupEnd();
}
