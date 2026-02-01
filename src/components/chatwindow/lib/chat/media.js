export function resolveMediaUrl(m) {
    if (!m || typeof m !== "object") return null;

    let url =
        m?.media?.url ||
        m?.media?.link ||
        m?.url ||
        m?.fileUrl ||
        m?.mediaUrl ||
        m?.document?.link ||
        m?.document?.url ||
        m?.image?.link ||
        m?.image?.url ||
        m?.audio?.link ||
        m?.audio?.url ||
        null;

    if (typeof url === "string") {
        url = url.replace(/\see+/g, " ").trim();
        if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
            url = url.slice(1, -1);
        }
    }

    if (url && typeof url === "string" && url.includes("crmsistem-d3009.fir")) {
        url = url.replace(/crmsistem-d3009\.fir[^/]*/, "crmsistem-d3009.firebasestorage.app");
    }

    return url || null;
}
