import React from "react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { resolveMediaUrl } from "../lib/chat/media.js";

function LocationBubble({ m }) {
    const [imgError, setImgError] = React.useState(false);
    const loc = m?.location || {};
    const lat = Number(loc.lat ?? loc.latitude);
    const lng = Number(loc.lng ?? loc.longitude);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const mapsUrl = loc.url || (hasCoords ? `https://www.google.com/maps?q=${lat},${lng}` : null);

    const gKey = import.meta?.env?.VITE_GOOGLE_STATIC_MAPS_KEY;
    const size = "480x240";
    const googleStaticUrl =
        hasCoords && gKey
            ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=${size}&markers=${lat},${lng}&key=${gKey}`
            : null;

    const osmStaticUrl = hasCoords
        ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=${size}&maptype=mapnik&markers=${lat},${lng},lightblue1`
        : null;

    const staticUrl = googleStaticUrl || osmStaticUrl;

    return (
        <div className="rounded-xl border border-[#CDEBD6] bg-white px-3 py-2 text-sm max-w-xs">
            <div className="mb-1 font-medium">📍 Ubicación</div>
            {loc.name && <div className="truncate">{loc.name}</div>}
            {loc.address && <div className="truncate text-black/70">{loc.address}</div>}
            {hasCoords && (
                <div className="mt-1 text-xs text-black/60">
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                </div>
            )}

            {hasCoords && staticUrl && !imgError && (
                <a href={mapsUrl || staticUrl} target="_blank" rel="noreferrer" className="block mt-2">
                    <img
                        src={staticUrl}
                        alt="Mapa de ubicación"
                        className="w-full h-auto border rounded-lg border-black/10"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => setImgError(true)}
                    />
                </a>
            )}

            {mapsUrl && (
                <a
                    className="inline-flex items-center gap-1 mt-2 text-xs underline text-[#2E7D32]"
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                >
                    Ver en Maps
                </a>
            )}
        </div>
    );
}

export default function MessageContent({ m, isOut, visibleText, setImagePreviewUrl }) {
    const mediaUrl = resolveMediaUrl(m);
    const type =
        m?.media?.kind ||
        m?.mediaKind ||
        m?.type ||
        (m?.document ? "document" : m?.image ? "image" : m?.audio ? "audio" : "text");

    const effectiveType = type === "image" && !mediaUrl ? (visibleText ? "text" : "image") : type;

    // ubicación
    if (m?.type === "location" || m?.location || m?.media?.kind === "location") {
        return <LocationBubble m={m} />;
    }

    // imagen
    if (effectiveType === "image" && mediaUrl) {
        return (
            <>
                <img
                    src={mediaUrl}
                    alt="Imagen"
                    className="object-cover rounded-lg w-44 h-44 md:w-52 md:h-52 cursor-zoom-in"
                    loading="lazy"
                    onClick={() => setImagePreviewUrl(mediaUrl)}
                    onError={(e) => {
                        e.currentTarget.style.display = "none";
                        const fallback = e.currentTarget.nextSibling;
                        if (fallback) fallback.style.display = "block";
                    }}
                />
                <div style={{ display: "none" }}>
                    <div
                        className={`mt-2 flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed ${isOut ? "border-white/30 bg-white/10" : "bg-gray-50 border-gray-300"
                            }`}
                    >
                        <ImageIcon className={`w-8 h-8 ${isOut ? "text-white/60" : "text-gray-400"}`} />
                        <div className={`text-sm text-center ${isOut ? "text-white/80" : "text-gray-600"}`}>Imagen no disponible</div>
                        <a
                            href={mediaUrl || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={`btn btn-xs ${isOut ? "text-white bg-white/20" : "bg-white"} border ${isOut ? "border-white/30" : "border-gray-300"
                                }`}
                        >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            Abrir
                        </a>
                        {visibleText ? <div className={`text-xs text-center ${isOut ? "text-white/80" : "text-gray-600"}`}>{visibleText}</div> : null}
                    </div>
                </div>
            </>
        );
    }

    // audio
    if (effectiveType === "audio" && mediaUrl) {
        return (
            <audio controls className="max-w-full">
                <source src={mediaUrl} />
            </audio>
        );
    }

    // documento
    if (effectiveType === "document" && mediaUrl) {
        return (
            <div className="flex flex-col gap-2">
                <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border ${isOut ? "text-white border-white/30 bg-white/10" : "text-gray-700 bg-gray-50 border-gray-300"
                        }`}
                >
                    <FileText className="w-4 h-4" />
                    <span className="truncate max-w-[220px]">
                        {m?.document?.filename || (typeof mediaUrl === "string" ? mediaUrl.split("/").pop()?.split("?")[0] : "Documento")}
                    </span>
                    <ExternalLink className="w-3 h-3 opacity-75" />
                </a>
                {visibleText ? <div className={`text-sm ${isOut ? "text-white/80" : "text-gray-700"}`}>{visibleText}</div> : null}
            </div>
        );
    }

    // texto
    return (
        <div className="leading-relaxed break-words whitespace-pre-wrap">
            {visibleText}
            {m.status === "error" && (
                <div className={`mt-2 text-xs flex items-center gap-1 ${isOut ? "text-red-200" : "text-red-500"}`}>
                    <span>⚠️</span>
                    <span>Error al enviar</span>
                    {m.error?.message && <span className="opacity-75">- {m.error.message}</span>}
                </div>
            )}
        </div>
    );
}
