export function sanitizeParamText(input) {
    if (input === "\u200B") return input;

    let x = String(input ?? "");
    x = x.replace(/\r\n?/g, "\n");
    x = x.replace(/\t+/g, " ");
    x = x.replace(/\n{3,}/g, "\n\n");

    x = x
        .split("\n")
        .map((line) => {
            let y = line;
            y = y.replace(/[\f\v]+/g, " ");
            y = y.replace(/ {5,}/g, "    ");
            y = y.replace(/ {2,}/g, " ");
            return y.trim();
        })
        .join("\n")
        .trim();

    const MAX = 1000;
    if (x.length > MAX) x = x.slice(0, MAX - 1) + "…";
    return x;
}

function stripZWSP(s) {
    const x = String(s ?? "");
    return x === "\u200B" ? "" : x;
}

function getTemplateName(m) {
    return (
        m?.template?.name ||
        m?.message?.template?.name ||
        m?.raw?.template?.name ||
        m?.raw?.messages?.[0]?.template?.name ||
        m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.name ||
        (typeof m?.template === "string" ? m.template : "") ||
        ""
    );
}

function getTemplateVars(m) {
    if (Array.isArray(m?.vars) && m.vars.length) {
        return m.vars.map((v) => String(v ?? ""));
    }

    const params =
        m?.template?.components?.[0]?.parameters ||
        m?.message?.template?.components?.[0]?.parameters ||
        m?.raw?.template?.components?.[0]?.parameters ||
        m?.raw?.messages?.[0]?.template?.components?.[0]?.parameters ||
        m?.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.template?.components?.[0]
            ?.parameters ||
        [];

    return params
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean);
}

function buildResolvedTemplateText(templateName, vars) {
    const v1 = stripZWSP(vars?.[0]);
    const v2 = stripZWSP(vars?.[1]);
    const extras = (vars || []).slice(2).map(stripZWSP).filter(Boolean);

    if (templateName === "reengage_free_text") {
        const freeText = extras[0] || "";
        if (freeText && freeText.toLowerCase() !== "hogarcril") {
            return freeText.trim();
        }

        const hello = v1 ? `Hola ${v1}` : "Hola";
        const sellerPart = v2 ? `, soy ${v2}` : "";
        return `${hello}${sellerPart}.`.trim();
    }

    if (templateName === "promo_hogarcril_combos") {
        let header = "";

        if (v1 && v2) {
            header = `Hola ${v1}, soy ${v2} de Hogar Cril. Hoy tenemos estas promos:`;
        } else if (v1) {
            header = `Hola ${v1}. Hoy tenemos estas promos:`;
        } else if (v2) {
            header = `Hola, soy ${v2} de Hogar Cril. Hoy tenemos estas promos:`;
        } else {
            header = "Hoy tenemos estas promos:";
        }

        let out = header;

        if (extras.length) {
            out += `\n\n${extras.join("\n")}`;
        }

        out += "\n\n¿Querés que te reserve alguno?";
        return out.trim();
    }

    if (v1 || v2) {
        let out = `Hola${v1 ? " " + v1 : ""}${v2 ? ", soy " + v2 : ""}.`;
        if (extras.length) out += `\n\n${extras.join("\n")}`;
        return out.trim();
    }

    return `[Plantilla ${templateName || "template"}]`;
}

export function isOutgoingMessage(m, user) {
    if (typeof m?.direction === "string") return m.direction === "out";

    if (typeof m?.from === "string") {
        const f = m.from.toLowerCase();
        if (
            f === "me" ||
            f === "agent" ||
            f === (user?.uid || "").toLowerCase() ||
            f === (user?.email || "").toLowerCase()
        ) {
            return true;
        }
    }

    if (typeof m?.author === "string") {
        const a = m.author.toLowerCase();
        if (
            a === "me" ||
            a === (user?.uid || "").toLowerCase() ||
            a === (user?.email || "").toLowerCase()
        ) {
            return true;
        }
    }

    return false;
}

export function getVisibleText(m) {
    if (!m) return "";

    const directCandidates = [
        typeof m?.text === "string" ? m.text : null,
        typeof m?.resolvedText === "string" ? m.resolvedText : null,
        typeof m?.body === "string" ? m.body : null,
        m?.text?.body,
        m?.message?.text?.body,
        m?.message?.body,
        m?.caption,
        m?.raw?.text?.body,
        m?.raw?.message?.text?.body,
    ].filter((v) => typeof v === "string" && v.trim());

    if (directCandidates.length > 0) {
        return String(directCandidates[0]).trim();
    }

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
        if (typeof m?.textPreview === "string" && m.textPreview.trim()) {
            return m.textPreview.trim();
        }

        const templateName = getTemplateName(m);
        const vars = getTemplateVars(m);
        const rebuilt = buildResolvedTemplateText(templateName, vars);

        if (rebuilt && rebuilt.trim()) {
            return rebuilt.trim();
        }

        const label = templateName ? `Plantilla ${templateName}` : "Plantilla";
        return `[${label}]`;
    }

    if (typeof m?.textPreview === "string" && m.textPreview.trim()) {
        return m.textPreview.trim();
    }

    if (typeof m?.text === "object") return JSON.stringify(m.text || "");
    return "";
}
