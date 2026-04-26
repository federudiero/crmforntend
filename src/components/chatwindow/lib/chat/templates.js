import { getSellerDisplayName } from "./seller.js";
import { sanitizeParamText } from "./text.js";

export const COMBOS_TEMPLATE_NAME = "promo_hogarcril_combos";
export const COMBOS_TEMPLATE_LANG = "es_AR";

export const REENGAGE_TEMPLATE =
    import.meta.env.VITE_WA_REENGAGE_TEMPLATE || "reengage_free_text";
export const REENGAGE_LANG = import.meta.env.VITE_WA_REENGAGE_LANG || "es_AR";

export function combosTimeGreeting(d = new Date()) {
    const h = d.getHours();
    if (h < 12) return "buen día";
    if (h < 19) return "buenas tardes";
    return "buenas noches";
}

function resolveInboundProfileName(rawWebhookSnapshot) {
    const fromCompactSnapshot =
        rawWebhookSnapshot?.contacts?.[0]?.profile?.name ||
        rawWebhookSnapshot?.contacts?.[0]?.name ||
        "";

    const fromFullWebhook =
        rawWebhookSnapshot?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
        "";

    return String(fromCompactSnapshot || fromFullWebhook || "").trim();
}

export function buildReengageTemplate({
    contact,
    sellerUser,
    rawWebhookSnapshot,
    freeText,
}) {
    const waProfile = resolveInboundProfileName(rawWebhookSnapshot);

    const crm = String(
        contact?.displayName ||
            contact?.name ||
            contact?.profileName ||
            contact?.lastInboundContactName ||
            ""
    ).trim();

    const client = (crm || waProfile || "\u200B").trim();

    const p1 = sanitizeParamText(client || "\u200B");
    const p2 = sanitizeParamText(getSellerDisplayName(sellerUser) || "\u200B");

    const ft = String(freeText || "").trim();
    const p3 = sanitizeParamText(ft ? ft : "HogarCril");

    return {
        name: REENGAGE_TEMPLATE,
        language: { code: REENGAGE_LANG },
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
}
