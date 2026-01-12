import React, { useEffect, useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebase";

const TABS = [
  { key: "image", label: "Fotos" },
  { key: "video", label: "Videos" },
  { key: "document", label: "Docs" },
  { key: "audio", label: "Audios" },
];

export default function MediaGallery({ conversationId }) {
  const [active, setActive] = useState("image");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!conversationId) return;
      setLoading(true);
      const col = collection(db, "conversations", conversationId, "messages");
      const snap = await getDocs(
        query(col, where("media.kind", "==", active), orderBy("timestamp", "desc"))
      );
      if (!mounted) return;
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [active, conversationId]);

  return (
    <div>
      <div className="mb-2 tabs tabs-boxed">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${active === t.key ? "tab-active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm opacity-60">Cargando…</div>}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {items.map((it) => {
          const url = it.media?.url || it.media?.path;
          const isImage = active === "image";
          return (
            <a
              key={it.id}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block"
              title={it.media?.filename || it.media?.mime || ""}
            >
              {isImage ? (
                <img src={url} alt="media" className="object-cover w-full h-32 rounded" loading="lazy" />
              ) : active === "video" ? (
                <div className="flex items-center justify-center h-32 border rounded">
                  <span className="text-xs">Ver video</span>
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 border rounded">
                  <span className="text-xs">
                    {it.media?.filename || it.media?.mime || "Archivo"}
                  </span>
                </div>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
