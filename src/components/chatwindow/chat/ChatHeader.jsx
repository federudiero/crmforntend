// src/components/chatwindow/chat/ChatHeader.jsx
import React, { useMemo } from "react";
import TemplatesPicker from "../../TemplatesPicker.jsx";
import StagePicker from "../../StagePicker.jsx";
import PresenceBadge from "../../PresenceBadge.jsx";
import { Tags as TagsIcon, UserRound, FileText, Menu, CheckCircle2 } from "lucide-react";

/** DaisyUI badge colors soportados */
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

function badgeContentClass(color) {
    return `text-${color}-content`;
}

function normalizeBadgeColorToken(raw) {
    const s = String(raw || "neutral").trim();
    if (!s) return "neutral";
    if (s.startsWith("badge-")) return s.replace(/^badge-/, "");
    if (s.startsWith("bg-")) return s.replace(/^bg-/, "");
    return s;
}

function getChipClass(label) {
    const token = normalizeBadgeColorToken(label?.color);
    const color = DAISY_BADGE_COLORS.has(token) ? token : "neutral";

    return [
        "badge",
        "badge-sm",
        `badge-${color}`,
        badgeContentClass(color),
        "gap-1",
        "whitespace-nowrap",
    ].join(" ");
}

export default function ChatHeader({
    conversationId,
    onBack,
 
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
    // ✅ Título principal: el número (o lo que tengas como id)
    const headerNumber = useMemo(() => {
        return (
            contact?.phone ||
            contact?.waId ||
            contact?.id ||
            contact?.contactId ||
            conversationId ||
            "—"
        );
    }, [contact, conversationId]);

    return (
        <header className="sticky top-0 z-40 border-b border-base-300 bg-base-100/90 backdrop-blur text-base-content">
            {/* ✅ WhatsApp-like: UNA sola fila, bien finita */}
            <div className="flex items-center justify-between h-12 gap-2 px-2 md:h-14 md:px-3">
                {/* IZQUIERDA */}
                <div className="flex items-center min-w-0 gap-2">
                    {onBack && (
                        <button
                            className="btn btn-xs md:hidden btn-ghost"
                            onClick={onBack}
                            title="Volver"
                            type="button"
                        >
                            ←
                        </button>
                    )}

                    {/* Avatar chico */}
                    <div className="flex items-center justify-center border rounded-full w-9 h-9 bg-base-200 border-base-300 shrink-0">
                        <UserRound className="w-4 h-4 opacity-80" />
                    </div>

                    {/* Título + subtítulo */}
                    <div className="min-w-0 leading-tight">
                        {/* ✅ Acá va el número (en vez de “Conversación”) */}
                        <div className="text-sm font-semibold truncate md:text-base">
                            {headerNumber}
                        </div>

                        {/* “visto/online” con tu PresenceBadge (estilo WhatsApp) */}
                        <div className="text-[11px] md:text-xs opacity-60 truncate">
                            <PresenceBadge
                                conversationId={conversationId}
                                contactId={contact?.id || contact?.phone || conversationId}
                            />
                        </div>
                    </div>
                </div>

                {/* DERECHA */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {/* Estado vendido como icono (compacto) */}
                    <button
                        className={
                            "btn btn-circle btn-xs md:btn-sm " +
                            (isSold ? "btn-success" : "btn-ghost")
                        }
                        onClick={toggleSold}
                        disabled={!canWrite || savingSold}
                        title={isSold ? "Vendido ✓" : "Marcar vendido"}
                        type="button"
                    >
                        <CheckCircle2 className="w-4 h-4" />
                    </button>

                    {/* StagePicker compacto (si querés aún más WhatsApp: lo metemos al menú) */}
                    <div className="hidden sm:block">
                        <StagePicker
                            conversationId={conversationId}
                            value={convMeta?.stage}
                            className="btn-xs md:btn-sm"
                        />
                    </div>

                    {/* Menú (hamburguesa) - mete acciones, plantillas y chips */}
                    <div className="dropdown dropdown-end">
                        <label
                            tabIndex={0}
                            className="btn btn-circle btn-xs md:btn-sm btn-ghost"
                            title="Más opciones"
                        >
                            <Menu className="w-4 h-4" />
                        </label>

                        <ul
                            tabIndex={0}
                            className="dropdown-content z-[60] menu p-2 shadow bg-base-100 rounded-box w-80 max-h-[70vh] overflow-y-auto border border-base-300"
                        >
                            <li className="menu-title">
                                <span>Acciones</span>
                            </li>

                            {/* Stage en menú para que quede más WhatsApp */}
                            <li className="sm:hidden">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs opacity-70">Etapa</span>
                                    <StagePicker
                                        conversationId={conversationId}
                                        value={convMeta?.stage}
                                        className="btn-xs"
                                    />
                                </div>
                            </li>

                            <li>
                                <TemplatesPicker
                                    mode="modal"
                                    anchorToBody
                                    backdrop
                                    buttonClassName="btn btn-sm btn-outline w-full justify-start gap-2"
                                    buttonChildren={<FileText className="w-4 h-4" />}
                                    onInsert={(txt) => {
                                        setText((prev) => (prev ? prev + "\n" + txt : txt));
                                        requestAnimationFrame(() => textareaRef.current?.focus());
                                    }}
                                    context={templateContext}
                                    buttonAriaLabel="Plantillas"
                                    disabled={!canWrite}
                                />
                            </li>

                            <li>
                                <button
                                    className="gap-2"
                                    onClick={() => setShowTags(true)}
                                    disabled={!canWrite}
                                    type="button"
                                >
                                    <TagsIcon className="w-4 h-4" /> Etiquetar
                                </button>
                            </li>

                            <li>
                                <button
                                    className="gap-2"
                                    onClick={() => setShowProfile((v) => !v)}
                                    type="button"
                                >
                                    <UserRound className="w-4 h-4" /> Perfil
                                </button>
                            </li>

                            <li>
                                <button
                                    className={"gap-2 " + (isSold ? "text-success" : "")}
                                    onClick={toggleSold}
                                    disabled={!canWrite || savingSold}
                                    type="button"
                                >
                                    <span className="font-semibold">
                                        {isSold ? "Vendido ✓" : "Marcar vendido"}
                                    </span>
                                </button>
                            </li>

                            <div className="my-1 divider" />

                            <li className="menu-title">
                                <span>Etiquetas</span>
                            </li>

                            <li>
                                <div className="flex flex-wrap gap-2 p-2">
                                    {(convSlugs || []).length === 0 ? (
                                        <span className="text-xs opacity-60">Sin etiquetas</span>
                                    ) : (
                                        (convSlugs || []).map((slug) => {
                                            const l =
                                                getLabel?.(slug) || { slug, name: slug, color: "neutral" };
                                            const chipClass = getChipClass(l);

                                            return (
                                                <span key={slug} className={chipClass} title={l.slug}>
                                                    {l.name}
                                                    <button
                                                        className="ml-1 hover:opacity-80"
                                                        onClick={() => removeTag(slug)}
                                                        title="Quitar"
                                                        type="button"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            );
                                        })
                                    )}
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </header>
    );
}