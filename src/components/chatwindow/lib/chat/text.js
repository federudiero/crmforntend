export function sanitizeParamText(input) {
    if (input === "\u200B") return input;
    let x = String(input ?? "");
    x = x.replace(/\r+/g, " ").replace(/\t+/g, " ");
    x = x.replace(/\n+/g, " • "); // Meta no permite \n en params
    x = x.replace(/\s{2,}/g, " ");
    x = x.trim();
    const MAX = 1000;
    if (x.length > MAX) x = x.slice(0, MAX - 1) + "…";
    return x;
}

export function isOutgoingMessage(m, user) {
    if (typeof m?.direction === "string") return m.direction === "out";
    if (typeof m?.from === "string") {
        const f = m.from.toLowerCase();
        if (f === "me" || f === "agent" || f === (user?.uid || "").toLowerCase() || f === (user?.email || "").toLowerCase()) return true;
    }
    if (typeof m?.author === "string") {
        const a = m.author.toLowerCase();
        if (a === "me" || a === (user?.uid || "").toLowerCase() || a === (user?.email || "").toLowerCase()) return true;
    }
    return false;
}

export function getVisibleText(m) {
    if (!m) return "";

    const asTemplate =
        m?.type === "template" ||
        m?.message?.type === "template" ||
        m?.raw?.type === "template" ||
        !!m?.template ||
        !!m?.message?.template ||
        !!m?.raw?.template ||
        !!m?.raw?.messages?.[0]?.template ||
        !!m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template;

    if (asTemplate) {
        let name =
            m?.template?.name ||
            m?.message?.template?.name ||
            m?.raw?.template?.name ||
            m?.raw?.messages?.[0]?.template?.name ||
            m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.name ||
            "";
        if (!name && typeof m?.template === "string") name = m.template;

        const params =
            m?.template?.components?.[0]?.parameters ||
            m?.message?.template?.components?.[0]?.parameters ||
            m?.raw?.template?.components?.[0]?.parameters ||
            m?.raw?.messages?.[0]?.template?.components?.[0]?.parameters ||
            m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.components?.[0]?.parameters ||
            [];

        const parts = params.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean);
        const label = name ? `Plantilla ${name}` : "Plantilla";
        return parts.length ? `[${label}] ${parts.join(" • ")}` : `[${label}]`;
    }

    if (typeof m?.textPreview === "string" && m.textPreview.trim()) return m.textPreview.trim();

    const candidates = [
        typeof m?.text === "string" ? m.text : null,
        m?.text?.body,
        m?.message?.text?.body,
        m?.message?.body,
        m?.body,
        m?.caption,
        m?.raw?.text?.body,
        m?.raw?.message?.text?.body,
    ].filter(Boolean);

    if (candidates.length > 0) return String(candidates[0]);
    if (typeof m?.text === "object") return JSON.stringify(m.text || "");
    return "";
}
