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
        <main
            ref={viewportRef}
            className="
        flex-1
        px-3 pt-3
        pb-[calc(6rem+env(safe-area-inset-bottom))]
        overflow-x-hidden overflow-y-auto
        md:px-4 md:pt-4
        md:pb-[calc(7rem+env(safe-area-inset-bottom))]
        bg-[var(--root-bg)]
        text-base-content
        overscroll-contain
      "
        >
            {hasMoreMessages && msgs.length > 0 && (
                <div className="flex justify-center mb-4">
                    <button
                        onClick={loadMoreMessages}
                        className="btn btn-sm md:btn-md btn-outline rounded-full"
                        type="button"
                    >
                        Cargar más antiguos
                    </button>
                </div>
            )}

            {msgs.length === 0 && (
                <div className="mx-auto p-4 text-center text-sm border rounded-xl border-base-300 bg-base-200">
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