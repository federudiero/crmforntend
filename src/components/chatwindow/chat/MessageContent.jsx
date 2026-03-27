import React from "react";
import { ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import { resolveMediaUrl } from "../lib/chat/media.js";

function normalizeMime(mime = "") {
  return String(mime || "").toLowerCase().split(";")[0].trim();
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

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

function AudioBubble({ m, isOut, visibleText, mediaUrl }) {
  const [failed, setFailed] = React.useState(false);

  const audioMime = normalizeMime(
    m?.media?.mime ||
      m?.audio?.mime ||
      m?.audio?.mime_type ||
      ""
  );

  const isVoice = Boolean(m?.media?.voice || m?.audio?.voice);
  const duration =
    Number(m?.media?.duration) ||
    Number(m?.audio?.duration) ||
    0;

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-2xl border px-3 py-2 max-w-xs min-w-[220px]",
        isOut
          ? "border-white/20 bg-white/10 text-white"
          : "border-gray-200 bg-white text-gray-800",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 text-xs opacity-80">
        <span>{isVoice ? "🎤 Nota de voz" : "🎵 Audio"}</span>
        {duration > 0 ? <span>{formatDuration(duration)}</span> : null}
      </div>

      <audio
        controls
        preload="metadata"
        className="w-full max-w-full"
        onError={() => setFailed(true)}
      >
        <source src={mediaUrl} type={audioMime || undefined} />
      </audio>

      <div className="flex items-center gap-2 text-xs">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center gap-1 underline ${
            isOut ? "text-white/90" : "text-[#2E7D32]"
          }`}
        >
          <ExternalLink className="w-3 h-3" />
          Abrir audio
        </a>

        {audioMime ? (
          <span className={isOut ? "text-white/70" : "text-gray-500"}>{audioMime}</span>
        ) : null}
      </div>

      {failed ? (
        <div className={`text-xs ${isOut ? "text-red-200" : "text-red-500"}`}>
          No se pudo reproducir dentro del CRM. Abrilo desde el enlace.
        </div>
      ) : null}

      {visibleText ? (
        <div className={`text-sm ${isOut ? "text-white/90" : "text-gray-700"}`}>{visibleText}</div>
      ) : null}
    </div>
  );
}

// ✅ Helpers para preview de anuncio/referral (Click to WhatsApp / IG Ads)
function getReferralThumb(m) {
  return (
    m?.referralStored?.thumbnail?.url ||
    m?.referralPreviewUrl ||
    m?.referral?.thumbnailUrl ||
    m?.raw?.referral?.thumbnail_url ||
    null
  );
}

function getReferralLink(m) {
  return (
    m?.raw?.referral?.video_url ||
    m?.raw?.referral?.source_url ||
    m?.referral?.videoUrl ||
    m?.referral?.sourceUrl ||
    null
  );
}

function getReferralHeadline(m) {
  return m?.raw?.referral?.headline || m?.referral?.headline || null;
}

export default function MessageContent({ m, isOut, visibleText, setImagePreviewUrl }) {
  const mediaUrl = resolveMediaUrl(m);
  const type =
    m?.media?.kind ||
    m?.mediaKind ||
    m?.type ||
    (m?.document ? "document" : m?.image ? "image" : m?.audio ? "audio" : "text");

  const effectiveType = type === "image" && !mediaUrl ? (visibleText ? "text" : "image") : type;

  if (m?.type === "location" || m?.location || m?.media?.kind === "location") {
    return <LocationBubble m={m} />;
  }

  const referralThumb = getReferralThumb(m);
  if (referralThumb) {
    const referralLink = getReferralLink(m);
    const referralHeadline = getReferralHeadline(m);

    return (
      <div className="flex flex-col gap-2">
        <img
          src={referralThumb}
          alt="Anuncio"
          className="object-cover rounded-lg w-44 h-44 md:w-52 md:h-52 cursor-zoom-in"
          loading="lazy"
          referrerPolicy="no-referrer"
          onClick={() => setImagePreviewUrl?.(referralThumb)}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />

        {referralHeadline ? (
          <div className={`text-xs ${isOut ? "text-white/80" : "text-gray-600"}`}>
            {referralHeadline}
          </div>
        ) : null}

        {referralLink ? (
          <a
            href={referralLink}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1 text-xs underline ${
              isOut ? "text-white" : "text-[#2E7D32]"
            }`}
          >
            Ver anuncio
          </a>
        ) : null}

        {visibleText ? (
          <div className="leading-relaxed break-words whitespace-pre-wrap">{visibleText}</div>
        ) : null}
      </div>
    );
  }

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
            className={`mt-2 flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed ${
              isOut ? "border-white/30 bg-white/10" : "bg-gray-50 border-gray-300"
            }`}
          >
            <ImageIcon className={`w-8 h-8 ${isOut ? "text-white/60" : "text-gray-400"}`} />
            <div className={`text-sm text-center ${isOut ? "text-white/80" : "text-gray-600"}`}>
              Imagen no disponible
            </div>
            <a
              href={mediaUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className={`btn btn-xs ${
                isOut ? "text-white bg-white/20" : "bg-white"
              } border ${isOut ? "border-white/30" : "border-gray-300"}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Abrir
            </a>
            {visibleText ? (
              <div className={`text-xs text-center ${isOut ? "text-white/80" : "text-gray-600"}`}>
                {visibleText}
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  if (effectiveType === "audio" && mediaUrl) {
    return <AudioBubble m={m} isOut={isOut} visibleText={visibleText} mediaUrl={mediaUrl} />;
  }

  if (effectiveType === "document" && mediaUrl) {
    return (
      <div className="flex flex-col gap-2">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border ${
            isOut
              ? "text-white border-white/30 bg-white/10"
              : "text-gray-700 bg-gray-50 border-gray-300"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span className="truncate max-w-[220px]">
            {m?.document?.filename ||
              (typeof mediaUrl === "string" ? mediaUrl.split("/").pop()?.split("?")[0] : "Documento")}
          </span>
          <ExternalLink className="w-3 h-3 opacity-75" />
        </a>
        {visibleText ? (
          <div className={`text-sm ${isOut ? "text-white/80" : "text-gray-700"}`}>{visibleText}</div>
        ) : null}
      </div>
    );
  }

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
