import { getSellerDisplayName } from "./seller.js";

export const COMBOS_TEMPLATE_NAME = "promo_hogarcril_combos";
export const COMBOS_TEMPLATE_LANG = "es_AR";

export const REENGAGE_TEMPLATE = import.meta.env.VITE_WA_REENGAGE_TEMPLATE || "reengage_free_text";
export const REENGAGE_LANG = import.meta.env.VITE_WA_REENGAGE_LANG || "es_AR";

export function combosTimeGreeting(d = new Date()) {
    const h = d.getHours();
    if (h < 12) return "buen día";
    if (h < 19) return "buenas tardes";
    return "buenas noches";
}

export function buildReengageTemplate({ contact, sellerUser, rawWebhookSnapshot }) {
    const waProfile =
        rawWebhookSnapshot?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || "";

    const crm = (contact?.displayName || contact?.name || "").trim();
    const client = (crm || waProfile || "\u200B").trim();

    const p1 = client || "\u200B";
    const p2 = getSellerDisplayName(sellerUser);
    const p3 = "HogarCril";

    return {
        name: REENGAGE_TEMPLATE,
        language: { code: REENGAGE_LANG },
        components: [
            { type: "body", parameters: [{ type: "text", text: p1 }, { type: "text", text: p2 }, { type: "text", text: p3 }] },
        ],
    };
}
