import React, { useEffect } from "react";

export default function ImagePreviewModal({ url, onClose }) {
    useEffect(() => {
        if (!url) return;
        const onEsc = (e) => e.key === "Escape" && onClose?.();
        document.addEventListener("keydown", onEsc);
        return () => document.removeEventListener("keydown", onEsc);
    }, [url, onClose]);

    if (!url) return null;

    return (
        <div className="fixed inset-0 z-[95] bg-black/70 grid place-items-center p-4" onClick={onClose}>
            <div className="relative bg-white rounded-xl p-2 shadow-2xl max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
                <button className="absolute top-2 right-2 btn btn-ghost btn-sm" onClick={onClose} title="Cerrar">
                    ✕
                </button>
                <img src={url} alt="Vista previa" className="max-h-[80vh] max-w-[90vw] object-contain rounded-lg" loading="eager" />
            </div>
        </div>
    );
}
