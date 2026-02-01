import React from "react";
import ClientProfile from "../../ClientProfile.jsx";

export default function ProfileDrawer({ open, onClose, conversationId, contactId, phone }) {
    if (!open) return null;
    return (
        <div className="fixed inset-y-0 right-0 z-[80] w-full max-w-md border-l border-[#CDEBD6] bg-base-100 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#CDEBD6] p-3">
                <h3 className="font-semibold">Perfil de cliente</h3>
                <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
            </div>
            <div className="h-full p-3 overflow-auto">
                <ClientProfile contactId={contactId} phone={phone} conversationId={conversationId} />
            </div>
        </div>
    );
}
