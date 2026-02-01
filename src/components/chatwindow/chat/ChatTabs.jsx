import React from "react";

export default function ChatTabs({ tab, setTab }) {
    return (
        <div className="px-3 pt-2 md:px-4">
            <div className="inline-flex overflow-hidden rounded-full border bg-white/80 border-[#CDEBD6] shadow-sm">
                <button
                    className={
                        "px-3 py-1 text-xs md:text-sm transition-colors " +
                        (tab === "chat" ? "bg-[#2E7D32] text-white" : "bg-transparent hover:bg-[#E8F5E9] text-slate-700")
                    }
                    onClick={() => setTab("chat")}
                >
                    Chat
                </button>
                <button
                    className={
                        "px-3 py-1 text-xs md:text-sm transition-colors " +
                        (tab === "destacados"
                            ? "bg-[#2E7D32] text-white"
                            : "bg-transparent hover:bg-[#E8F5E9] text-slate-700")
                    }
                    onClick={() => setTab("destacados")}
                >
                    Destacados
                </button>
            </div>
        </div>
    );
}
