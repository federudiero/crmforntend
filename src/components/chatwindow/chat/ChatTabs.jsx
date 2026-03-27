// src/components/chatwindow/chat/ChatTabs.jsx
import React from "react";

export default function ChatTabs({ tab, setTab }) {
    return (
        <div className="px-3 pt-1 md:pt-2 md:px-4">
            <div className="inline-flex overflow-hidden rounded-full border shadow-sm border-base-300 bg-base-100">
                <button
                    className={
                        "px-3 py-1 text-xs md:text-sm transition-colors " +
                        (tab === "chat"
                            ? "bg-success text-success-content"
                            : "bg-transparent hover:bg-base-200 text-base-content")
                    }
                    onClick={() => setTab("chat")}
                    type="button"
                >
                    Chat
                </button>

                <button
                    className={
                        "px-3 py-1 text-xs md:text-sm transition-colors " +
                        (tab === "destacados"
                            ? "bg-success text-success-content"
                            : "bg-transparent hover:bg-base-200 text-base-content")
                    }
                    onClick={() => setTab("destacados")}
                    type="button"
                >
                    Destacados
                </button>
            </div>
        </div>
    );
}
