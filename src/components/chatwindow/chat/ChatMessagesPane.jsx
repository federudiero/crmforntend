import React from "react";
import MessageItem from "./MessageItem.jsx";

export default function ChatMessagesPane({
    viewportRef,
    msgs,
    user,
    canWrite,
    hasMoreMessages,
    loadMoreMessages,
    beginReplyTo,
    beginEditMessage,
    deleteMessage,
    editingMessageId,
    editingText,
    setEditingText,
    cancelEditMessage,
    saveEditMessage,
    conversationId,
    setImagePreviewUrl,
}) {
    return (
        <main ref={viewportRef} className="flex-1 px-3 py-3 overflow-x-hidden overflow-y-auto md:px-4 md:py-4">
            {hasMoreMessages && msgs.length > 0 && (
                <div className="flex justify-center mb-4">
                    <button
                        onClick={loadMoreMessages}
                        className="px-4 py-2 text-xs md:text-sm font-medium text-[#2E7D32] bg-[#E8F5E9] border border-[#2E7D32]/20 rounded-full hover:bg-[#CDEBD6] transition-colors duration-200"
                    >
                        Cargar más antiguos
                    </button>
                </div>
            )}

            {msgs.length === 0 && (
                <div className="mx-auto rounded-xl border border-[#CDEBD6] bg-[#EAF7EE] p-4 text-center text-sm">
                    Sin mensajes todavía.
                </div>
            )}

            <div className="flex flex-col w-full gap-2 mx-auto max-w-none">
                {msgs.map((m) => (
                    <MessageItem
                        key={m.id}
                        m={m}
                        user={user}
                        canWrite={canWrite}
                        conversationId={conversationId}
                        beginReplyTo={beginReplyTo}
                        beginEditMessage={beginEditMessage}
                        deleteMessage={deleteMessage}
                        editingMessageId={editingMessageId}
                        editingText={editingText}
                        setEditingText={setEditingText}
                        cancelEditMessage={cancelEditMessage}
                        saveEditMessage={saveEditMessage}
                        setImagePreviewUrl={setImagePreviewUrl}
                    />
                ))}
            </div>
        </main>
    );
}
