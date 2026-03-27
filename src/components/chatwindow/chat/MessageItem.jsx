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
        ? "bg-success text-success-content rounded-2xl rounded-br-md shadow-sm"
        : "bg-base-100 border border-base-300 text-base-content rounded-2xl rounded-bl-md shadow-sm";

    const visibleText = getVisibleText(m);

    return (
        <div className={wrapperClass}>
            <div className="max-w-[85%] px-1 py-1 md:px-2 md:py-2">
                <div className="mb-1 text-[10px] font-medium opacity-80">
                    <span
                        className={
                            "px-2 py-[2px] rounded-full border " +
                            (isOut
                                ? "border-success/40 bg-success/10 text-base-content"
                                : "border-base-300 bg-base-200 text-base-content")
                        }
                    >
                        {isOut ? "Yo" : "Cliente"}
                    </span>
                </div>

                <div className={`px-3 py-2 md:px-4 md:py-3 ${bubbleClass}`}>
                    {m.replyTo && (
                        <div className={"mb-2 border-l-4 pl-3 " + (isOut ? "border-success-content/50" : "border-base-300")}>
                            <div className={`text-[11px] ${isOut ? "text-success-content opacity-80" : "opacity-60"}`}>
                                En respuesta a
                            </div>
                            <div className={`text-sm ${isOut ? "text-success-content" : "text-base-content"}`}>
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

                    <MessageContent
                        m={m}
                        isOut={isOut}
                        visibleText={visibleText}
                        setImagePreviewUrl={setImagePreviewUrl}
                    />

                    <div className="flex items-center justify-between gap-2 mt-2">
                        <div className={`text-[11px] md:text-xs ${isOut ? "text-success-content opacity-80" : "opacity-70"}`}>
                            {formatTs(m.timestamp)}
                        </div>

                        <div className="flex items-center gap-1">
                            {isOut && <MessageChecks status={m.status} readBy={m.readBy} />}
                            {canWrite && <StarButton chatId={conversationId} messageId={m.id} texto={visibleText} />}

                            {canWrite && (
                                <button
                                    className={`btn btn-ghost btn-xs ${isOut ? "text-success-content opacity-90" : "text-base-content"}`}
                                    title="Responder"
                                    onClick={() => beginReplyTo(m)}
                                    type="button"
                                >
                                    <CornerUpLeft className="w-3.5 h-3.5" />
                                </button>
                            )}

                            {isOut && canWrite && (
                                <>
                                    <button
                                        className="btn btn-ghost btn-xs text-success-content opacity-90"
                                        title="Editar mensaje"
                                        onClick={() => beginEditMessage(m)}
                                        type="button"
                                    >
                                        <Edit3 className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                        className="btn btn-ghost btn-xs text-success-content opacity-90"
                                        title="Eliminar mensaje"
                                        onClick={() => deleteMessage(m)}
                                        type="button"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {isOut && editingMessageId === m.id && (
                    <div className="mt-2 p-2 rounded-lg border border-base-300 bg-base-200">
                        <textarea
                            className="w-full textarea textarea-xs text-base-content"
                            rows={3}
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            placeholder="Editar texto/caption…"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <button className="btn btn-xs btn-outline" onClick={cancelEditMessage} title="Cancelar" type="button">
                                <X className="mr-1 w-3.5 h-3.5" /> Cancelar
                            </button>
                            <button className="btn btn-xs btn-success" onClick={saveEditMessage} title="Guardar" type="button">
                                <Check className="mr-1 w-3.5 h-3.5" /> Guardar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
