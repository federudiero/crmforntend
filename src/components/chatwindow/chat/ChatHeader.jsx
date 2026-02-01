import React from "react";
import TemplatesPicker from "../../TemplatesPicker.jsx";
import StagePicker from "../../StagePicker.jsx";
import PresenceBadge from "../../PresenceBadge.jsx";
import { Tags as TagsIcon, UserRound, FileText } from "lucide-react";

/** DaisyUI badge colors soportados (los que ya usabas) */
const DAISY_BADGE_COLORS = new Set([
    "primary",
    "secondary",
    "accent",
    "info",
    "success",
    "warning",
    "error",
    "neutral",
]);

const isHexColor = (c) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(c || "").trim());

function hexToRgb(hex) {
    const h = String(hex || "").trim();
    if (!isHexColor(h)) return null;
    let x = h.slice(1);
    if (x.length === 3) x = x.split("").map((ch) => ch + ch).join("");
    const r = parseInt(x.slice(0, 2), 16);
    const g = parseInt(x.slice(2, 4), 16);
    const b = parseInt(x.slice(4, 6), 16);
    return { r, g, b };
}

function autoTextColor(hexBg) {
    const rgb = hexToRgb(hexBg);
    if (!rgb) return "#ffffff";
    // luminancia simple (0..1)
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return lum > 0.6 ? "#111827" : "#ffffff"; // bg claro => texto oscuro
}

function getChipRender(label) {
    const colorRaw = String(label?.color || "neutral").trim();

    // DaisyUI
    if (DAISY_BADGE_COLORS.has(colorRaw)) {
        return {
            className: `badge badge-${colorRaw} gap-1 border whitespace-nowrap text-black`,
            style: undefined,
        };
    }

    // HEX (custom)
    if (isHexColor(colorRaw)) {
        const bg = label?.bg && isHexColor(label.bg) ? label.bg : colorRaw;
        const txt = label?.text && isHexColor(label.text) ? label.text : autoTextColor(bg);

        return {
            className: "badge gap-1 border whitespace-nowrap",
            style: {
                backgroundColor: bg,
                borderColor: colorRaw,
                color: txt,
            },
        };
    }

    // fallback
    return {
        className: "badge badge-neutral gap-1 border whitespace-nowrap text-black",
        style: undefined,
    };
}

export default function ChatHeader({
    conversationId,
    onBack,
    user,
    contact,
    convMeta,
    convSlugs,
    getLabel,
    removeTag,
    isSold,
    savingSold,
    toggleSold,
    canWrite,
    setShowTags,
    setShowProfile,
    templateContext,
    textareaRef,
    setText,
}) {
    return (
        <header className="sticky top-0 z-40 border-b bg-[#E8F5E9]/90 border-[#CDEBD6] backdrop-blur">
            <div className="px-3 pt-2 pb-2 md:px-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center min-w-0 gap-2">
                        {onBack && (
                            <button className="btn btn-xs md:hidden" onClick={onBack} title="Volver a la lista">
                                ← Volver
                            </button>
                        )}
                        <div className="flex items-center min-w-0 gap-2">
                            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#2E7D32]/10 border border-[#2E7D32]/30">
                                <UserRound className="w-4 h-4 text-[#2E7D32]" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[11px] md:text-xs text-slate-500">Conversación</div>
                                <h2 className="flex items-center gap-1 text-base font-semibold truncate md:text-lg">
                                    <PresenceBadge conversationId={conversationId} contactId={contact?.id || contact?.phone || conversationId} />
                                </h2>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <StagePicker conversationId={conversationId} value={convMeta?.stage} className="md:btn-sm btn-xs" />

                        <button
                            className={
                                "hidden md:inline-flex items-center gap-2 btn btn-xs md:btn-sm border " +
                                (isSold
                                    ? "bg-green-600 text-white hover:bg-green-700 border-green-700"
                                    : "bg-white text-black hover:bg-[#F1FAF3] border-[#CDEBD6]")
                            }
                            onClick={toggleSold}
                            disabled={!canWrite || savingSold}
                            title={isSold ? "Vendido ✓" : "Marcar vendido"}
                        >
                            {isSold ? "Vendido ✓" : "Marcar vendido"}
                        </button>
                    </div>
                </div>

                {/* toolbar */}
                <div className="mt-2 -mx-1 overflow-x-auto no-scrollbar">
                    <div className="flex items-center gap-2 px-1 snap-x snap-mandatory">
                        <div className="snap-start shrink-0">
                            <TemplatesPicker
                                mode="modal"
                                anchorToBody
                                backdrop
                                buttonClassName="btn btn-circle btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                                buttonChildren={<FileText className="w-4 h-4" />}
                                onInsert={(txt) => {
                                    setText((prev) => (prev ? prev + "\n" + txt : txt));
                                    requestAnimationFrame(() => textareaRef.current?.focus());
                                }}
                                context={templateContext}
                                buttonAriaLabel="Plantillas"
                                disabled={!canWrite}
                            />
                        </div>

                        <button
                            className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                            onClick={() => setShowTags(true)}
                            title="Etiquetar conversación"
                        >
                            <TagsIcon className="w-4 h-4" />
                            <span className="hidden xs:inline">Etiquetar</span>
                        </button>

                        <button
                            className={
                                "snap-start btn btn-xs md:hidden gap-2 border " +
                                (isSold
                                    ? "bg-green-600 text-white hover:bg-green-700 border-green-700"
                                    : "bg-white text-black hover:bg-[#F1FAF3] border-[#CDEBD6]")
                            }
                            onClick={toggleSold}
                            disabled={!canWrite || savingSold}
                            title={isSold ? "Vendido ✓" : "Marcar vendido"}
                        >
                            <span className="hidden xs:inline">{isSold ? "Vendido ✓" : "Marcar vendido"}</span>
                            <span className="xs:hidden">{isSold ? "✓" : "$"}</span>
                        </button>

                        <button
                            className="snap-start btn btn-xs md:btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6] gap-2"
                            onClick={() => setShowProfile((v) => !v)}
                            title="Ver perfil del cliente"
                        >
                            <UserRound className="w-4 h-4" />
                            <span className="hidden xs:inline">Perfil</span>
                        </button>
                    </div>
                </div>

                {/* chips */}
                <div className="flex overflow-x-auto gap-2 items-center px-0.5 pb-1 mt-2 no-scrollbar">
                    {(convSlugs || []).map((slug) => {
                        const l = getLabel?.(slug) || { slug, name: slug, color: "neutral" };
                        const chip = getChipRender(l);

                        return (
                            <span key={slug} className={chip.className} style={chip.style} title={l.slug}>
                                {l.name}
                                <button className="ml-1 hover:opacity-80" onClick={() => removeTag(slug)} title="Quitar">
                                    ×
                                </button>
                            </span>
                        );
                    })}
                </div>
            </div>
        </header>
    );
}
