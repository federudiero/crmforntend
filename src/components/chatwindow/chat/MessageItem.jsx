import React from "react";
import { CornerUpLeft, Edit3, Trash2, Check, X } from "lucide-react";
import StarButton from "../../StarButton.jsx";
import MessageChecks from "../../MessageChecks.jsx";

import MessageContent from "./MessageContent.jsx";
import { isOutgoingMessage, getVisibleText } from "../lib/chat/text.js";
import { formatTs } from "../lib/chat/time.js";

export default function MessageItem({
    m,
    user,
    canWrite,
    conversationId,
    beginReplyTo,
    beginEditMessage,
    deleteMessage,
    editingMessageId,
    editingText,
    setEditingText,
    cancelEditMessage,
    saveEditMessage,
    setImagePreviewUrl,
}) {
    const isOut = isOutgoingMessage(m, user);
    const wrapperClass = `flex w-full ${isOut ? "justify-end" : "justify-start"}`;
    const bubbleClass = isOut
        ? "bg-gradient-to-r from-[#2E7D32] to-[#388E3C] text-white rounded-2xl rounded-br-md shadow-sm"
        : "bg-white border border-[#E0EDE4] text-gray-800 rounded-2xl rounded-bl-md shadow-sm";

    const visibleText = getVisibleText(m);

    return (
        <div className={wrapperClass}>
            <div className="max-w-[85%] px-1 py-1 md:px-2 md:py-2">
                {/* pill */}
                <div className={`mb-1 text-[10px] font-medium ${isOut ? "text-[#2E7D32]" : "text-gray-500"}`}>
                    <span
                        className={`px-2 py-[2px] rounded-full border ${isOut ? "border-[#2E7D32]/40 bg-[#E6F2E8]" : "border-gray-300 bg-gray-50"
                            }`}
                    >
                        {isOut ? "Yo" : "Cliente"}
                    </span>
                </div>

                <div className={`px-3 py-2 md:px-4 md:py-3 ${bubbleClass}`}>
                    {/* reply block */}
                    {m.replyTo && (
                        <div className={`mb-2 border-l-4 pl-3 ${isOut ? "border-white/50" : "border-[#CDEBD6]"}`}>
                            <div className={`text-[11px] ${isOut ? "text-white/70" : "text-gray-500"}`}>En respuesta a</div>
                            <div className={`text-sm ${isOut ? "text-white" : "text-gray-800"}`}>
                                {m.replyTo?.text ||
                                    m.replyTo?.snippet ||
                                    (m.replyTo?.type === "image"
                                        ? "Imagen"
                                        : m.replyTo?.type === "audio"
                                            ? "Audio"
                                            : m.replyTo?.type === "document"
                                                ? "Documento"
                                                : "Mensaje")}
                            </div>
                        </div>
                    )}

                    <MessageContent m={m} isOut={isOut} visibleText={visibleText} setImagePreviewUrl={setImagePreviewUrl} />

                    {/* footer */}
                    <div className="flex items-center justify-between gap-2 mt-2">
                        <div className={`text-[11px] md:text-xs ${isOut ? "text-white/80" : "text-gray-500"}`}>
                            {formatTs(m.timestamp)}
                        </div>
                        <div className="flex items-center gap-1">
                            {isOut && <MessageChecks status={m.status} readBy={m.readBy} />}
                            {canWrite && <StarButton chatId={conversationId} messageId={m.id} texto={visibleText} />}

                            {canWrite && (
                                <button
                                    className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                    title="Responder"
                                    onClick={() => beginReplyTo(m)}
                                >
                                    <CornerUpLeft className="w-3.5 h-3.5" />
                                </button>
                            )}

                            {isOut && canWrite && (
                                <>
                                    <button
                                        className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                        title="Editar mensaje"
                                        onClick={() => beginEditMessage(m)}
                                    >
                                        <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        className={`btn btn-ghost btn-xs ${isOut ? "text-white/90" : "text-gray-700"}`}
                                        title="Eliminar mensaje"
                                        onClick={() => deleteMessage(m)}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* inline editor */}
                {isOut && editingMessageId === m.id && (
                    <div className={`mt-2 p-2 rounded-lg border ${isOut ? "border-white/40 bg-white/10" : "bg-gray-50 border-gray-300"}`}>
                        <textarea
                            className={`w-full textarea textarea-xs ${isOut ? "text-white placeholder:text-white/70" : ""}`}
                            rows={3}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            placeholder="Editar texto/caption…"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                className={`btn btn-xs ${isOut ? "text-white bg-white/20 border-white/40" : ""}`}
                                onClick={cancelEditMessage}
                                title="Cancelar"
                            >
                                <X className="mr-1 w-3.5 h-3.5" /> Cancelar
                            </button>
                            <button className="btn btn-xs btn-success" onClick={saveEditMessage} title="Guardar">
                                <Check className="mr-1 w-3.5 h-3.5" /> Guardar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
