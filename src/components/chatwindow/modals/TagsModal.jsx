import React from "react";
import { createPortal } from "react-dom";
import TagsMenu from "../../TagsMenu.jsx";

export default function TagsModal({ open, onClose, tagsData, onPick, selectedSlugs = [] }) {
    if (!open) return null;

    const modal = (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-black/50 p-4" onClick={onClose}>
            <div
                className="w-full max-w-lg md:max-w-2xl lg:max-w-5xl max-h-[90vh] overflow-hidden rounded-xl shadow-xl bg-base-100 border border-base-300"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b border-base-300">
                    <h3 className="font-semibold">Etiquetas</h3>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
                </div>
                <div className="p-3 overflow-y-auto max-h-[calc(90vh-56px)] overscroll-contain">
                    <TagsMenu
                        tags={tagsData}
                        selected={selectedSlugs}
                        onPick={(slug) => onPick(slug)}
                    />
                </div>
            </div>
        </div>
    );

    return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}
