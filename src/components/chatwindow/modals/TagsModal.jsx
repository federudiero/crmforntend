import React from "react";
import TagsMenu from "../../TagsMenu.jsx";

export default function TagsModal({ open, onClose, tagsData, onPick }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-lg md:max-w-2xl lg:max-w-4xl max-h-[90vh] overflow-hidden rounded-xl shadow-xl bg-base-100"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-3 border-b">
                    <h3 className="font-semibold">Etiquetas</h3>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
                </div>
                <div className="p-3 overflow-y-auto max-h-[calc(90vh-56px)]">
                    <TagsMenu tags={tagsData} onPick={(slug) => onPick(slug)} />
                </div>
            </div>
        </div>
    );
}
