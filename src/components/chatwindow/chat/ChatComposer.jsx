// src/components/chatwindow/chat/ChatComposer.jsx
import React, { useEffect } from "react";
import QuickRepliesBar from "../../QuickRepliesBar.jsx";
import AudioRecorderButton from "../../AudioRecorderButton.jsx";
import EmojiPickerLite from "../../EmojiPickerLite.jsx";

import { getSellerDisplayName } from "../lib/chat/seller.js";
import { sanitizeParamText, isOutgoingMessage } from "../lib/chat/text.js";
import { buildReengageTemplate, COMBOS_TEMPLATE_LANG, COMBOS_TEMPLATE_NAME } from "../lib/chat/templates.js";

import { Paperclip, Send as SendIcon, Smile, Image as ImageIcon, FileAudio2, FileText } from "lucide-react";


export default function ChatComposer({
    conversationId,
    user,
    contact,
    convMeta,
    msgs,
    canWrite,

    text,
    setText,
    sending,
    setSending,
    doSend,

    replyTo,
    cancelReplyTo,

    selectedImage,
    setSelectedImage,
    selectedAudio,
    setSelectedAudio,
    selectedDoc,
    setSelectedDoc,

    showAttachMenu,
    setShowAttachMenu,
    showEmojiPicker,
    setShowEmojiPicker,
    setTyping,

    textareaRef,
    attachBtnRef,
    emojiPickerRef,
    emojiBtnRef,
    imageInputRef,
    audioInputRef,
    docInputRef,

    onPickImage,
    onPickAudio,
    onPickDocument,

    sendManual24hTemplate,
    setShowCombos,
    setShowImagenesGuardadas,
}) {
    const canSendNow = !!text.trim() || !!selectedImage || !!selectedAudio || !!selectedDoc;

    // autoresize
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "0px";
        const h = Math.min(160, Math.max(36, el.scrollHeight));
        el.style.height = h + "px";
    }, [text, textareaRef]);

    const onMsgKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            doSend();
        }
    };

    const insertEmojiAtCursor = (emoji) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart ?? text.length;
        const end = textarea.selectionEnd ?? text.length;
        const newText = text.slice(0, start) + emoji.native + text.slice(end);
        setText(newText);
        requestAnimationFrame(() => {
            const p = start + emoji.native.length;
            textarea.setSelectionRange(p, p);
            textarea.focus();
        });
    };

    const onPickQuick = (t) => {
        if (!t) return;
        setText((prev) => (prev ? (prev.endsWith("\n") ? prev : prev + "\n") + t : t));
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    return (
        <div className="border-t border-[#CDEBD6] bg-[#F6FBF7] sticky bottom-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
            <div className="px-3 py-3 md:px-4">
                <div className="flex flex-col w-full gap-2 mx-auto max-w-none">
                    <div className="hidden sm:block">
                        <QuickRepliesBar onPick={onPickQuick} />
                    </div>

                    {/* Desktop quick actions */}
                    <div className="justify-end hidden gap-2 -mb-1 sm:flex">
                        <button
                            className="btn btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                            disabled={!canWrite || sending}
                            onClick={sendManual24hTemplate}
                            type="button"
                            title="Enviar plantilla 24 h"
                        >
                            24 h
                        </button>

                        <button
                            type="button"
                            className="btn btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                            onClick={() => setShowCombos(true)}
                            disabled={!canWrite}
                            title="Plantilla de combos"
                        >
                            Combos
                        </button>
                    </div>

                    {/* Capsule */}
                    <div className="relative flex items-center gap-2 rounded-2xl border border-[#CDEBD6] bg-white px-2 py-2 shadow-sm">
                        {/* selected pills (mobile+desktop, simplificado) */}
                        {(selectedImage || selectedAudio || selectedDoc) && (
                            <div className="absolute inset-x-2 -top-14">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                    {selectedImage && (
                                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-blue-50">
                                            <ImageIcon className="w-4 h-4 text-blue-600" />
                                            <span className="truncate max-w-28">{selectedImage.name}</span>
                                            <button onClick={() => setSelectedImage(null)} title="Quitar">×</button>
                                        </div>
                                    )}
                                    {selectedAudio && (
                                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-green-50">
                                            <FileAudio2 className="w-4 h-4 text-green-600" />
                                            <span className="truncate max-w-28">{selectedAudio.name}</span>
                                            <button onClick={() => setSelectedAudio(null)} title="Quitar">×</button>
                                        </div>
                                    )}
                                    {selectedDoc && (
                                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-purple-50">
                                            <FileText className="w-4 h-4 text-purple-600" />
                                            <span className="truncate max-w-28">{selectedDoc.name}</span>
                                            <button onClick={() => setSelectedDoc(null)} title="Quitar">×</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* hidden inputs */}
                        <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onPickImage} />
                        <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={onPickAudio} />
                        <input ref={docInputRef} type="file" accept="application/pdf" hidden onChange={onPickDocument} />

                        {/* Left column: emoji + clip */}
                        <div className="relative flex flex-col items-center gap-1 shrink-0">
                            <div className="relative">
                                <button
                                    ref={emojiBtnRef}
                                    type="button"
                                    className="btn btn-circle btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                                    title="Emojis"
                                    onClick={() => setShowEmojiPicker((v) => !v)}
                                    disabled={!canWrite}
                                >
                                    <Smile className="w-4 h-4" />
                                </button>

                                {showEmojiPicker && (
                                    <div
                                        ref={emojiPickerRef}
                                        className="absolute bottom-[115%] left-120 z-[9999]"
                                        style={{ transformOrigin: "bottom right" }}
                                    >
                                        <EmojiPickerLite
                                            onPick={(e) => {
                                                insertEmojiAtCursor({ native: e });
                                                setShowEmojiPicker(false);
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="relative">
                                <button
                                    ref={attachBtnRef}
                                    type="button"
                                    className="btn btn-circle btn-sm bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]"
                                    disabled={!canWrite || sending}
                                    onClick={() => setShowAttachMenu((v) => !v)}
                                    aria-haspopup="menu"
                                    aria-expanded={showAttachMenu}
                                    title="Adjuntar"
                                >
                                    <Paperclip className="w-4 h-4" />
                                </button>

                                {showAttachMenu && (
                                    <div
                                        id="attach-menu"
                                        className="absolute bottom-[115%] left-0 z-50 w-52 rounded-xl border border-[#CDEBD6] bg-white p-1 shadow-md"
                                    >
                                        <button className="justify-start w-full gap-2 btn btn-ghost btn-sm" onClick={() => imageInputRef.current?.click()} disabled={!canWrite || sending}>
                                            <ImageIcon className="w-4 h-4" /> Imagen
                                        </button>

                                        <button className="justify-start w-full gap-2 btn btn-ghost btn-sm" onClick={() => { setShowImagenesGuardadas(true); setShowAttachMenu(false); }} disabled={!canWrite || sending}>
                                            <ImageIcon className="w-4 h-4" /> Imágenes guardadas
                                        </button>

                                        <button className="justify-start w-full gap-2 btn btn-ghost btn-sm" onClick={() => audioInputRef.current?.click()} disabled={!canWrite || sending}>
                                            <FileAudio2 className="w-4 h-4" /> Audio
                                        </button>

                                        <button className="justify-start w-full gap-2 btn btn-ghost btn-sm" onClick={() => docInputRef.current?.click()} disabled={!canWrite || sending}>
                                            <FileText className="w-4 h-4" /> Documento
                                        </button>

                                        <div className="my-1 border-t border-[#CDEBD6]/60" />

                                        <button className="justify-start w-full btn btn-ghost btn-sm" disabled={!canWrite || sending} onClick={sendManual24hTemplate}>
                                            Plantilla 24 h
                                        </button>

                                        <button className="justify-start w-full btn btn-ghost btn-sm" disabled={!canWrite} onClick={() => setShowCombos(true)}>
                                            Enviar Combos
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* reply chip */}
                        {replyTo && (
                            <div className="absolute -top-9 left-2 right-2 flex items-center justify-between rounded-md border border-[#CDEBD6] bg-white px-3 py-1 text-xs">
                                <div className="truncate">Respondiendo: {replyTo.textPreview}</div>
                                <button className="btn btn-ghost btn-xs" onClick={cancelReplyTo} title="Cancelar respuesta">
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* textarea */}
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            className="textarea textarea-ghost flex-1 min-w-0 resize-none border-0 !p-2 min-h-[40px] max-h-40 leading-relaxed text-[16px] text-black placeholder:text-black/60 focus:outline-none focus:ring-0"
                            placeholder={canWrite ? "Escribí un mensaje…" : "Conversación asignada a otro agente"}
                            value={text}
                            onChange={(e) => { setText(e.target.value); setTyping(true); }}
                            onKeyDown={onMsgKeyDown}
                            onFocus={() => setTyping(true)}
                            onBlur={() => setTyping(false)}
                            disabled={!canWrite}
                            autoComplete="off"
                            autoCorrect="on"
                            autoCapitalize="sentences"
                            spellCheck={true}
                        />

                        {/* send / audio */}
                        {canSendNow ? (
                            <button
                                onClick={doSend}
                                type="button"
                                disabled={!canWrite || sending}
                                className="flex items-center gap-2 px-4 rounded-full btn btn-success btn-sm sm:btn"
                                title="Enviar"
                            >
                                <SendIcon className="w-4 h-4" />
                                <span className="hidden xs:inline">Enviar</span>
                            </button>
                        ) : (
                            <AudioRecorderButton conversationId={conversationId} canWrite={canWrite && !sending} iconOnly />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
