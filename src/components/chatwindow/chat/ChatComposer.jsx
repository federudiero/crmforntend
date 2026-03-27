// src/components/chatwindow/chat/ChatComposer.jsx
import React, { useEffect } from "react";
import QuickRepliesBar from "../../QuickRepliesBar.jsx";
import AudioRecorderButton from "../../AudioRecorderButton.jsx";
import EmojiPickerLite from "../../EmojiPickerLite.jsx";

import {
    Paperclip,
    Send as SendIcon,
    Smile,
    Image as ImageIcon,
    FileAudio2,
    FileText,
} from "lucide-react";

export default function ChatComposer({
    conversationId,
    
    canWrite,

    text,
    setText,
    sending,
    
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

    // ✅ autoresize estilo WhatsApp (sube hasta un límite)
    useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;

        const MIN = 40;
        const MAX = 120; // ✅ más parecido a WhatsApp (antes 160)

        const raw = String(el.value ?? "");
        const hasText = raw.trim().length > 0;

        el.style.height = "auto";

        if (!hasText) {
            el.style.height = `${MIN}px`;
            el.style.overflowY = "hidden";
            return;
        }

        const next = Math.min(MAX, Math.max(MIN, el.scrollHeight));
        el.style.height = `${next}px`;
        el.style.overflowY = next >= MAX ? "auto" : "hidden";
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
        <div className="sticky bottom-0 border-t chat-composer-surface chat-safe-area-bottom">
            {/* ✅ compacto */}
            <div className="px-2 py-2 md:px-3 md:py-3">
                <div className="flex flex-col w-full gap-2 mx-auto max-w-none">
                    {/* ✅ Quick replies: estilo “barra” (lo más posible desde acá) */}
                    <div className="px-2 -mx-2 overflow-x-auto no-scrollbar">
                        <QuickRepliesBar onPick={onPickQuick} />
                    </div>

                    {/* Capsule WhatsApp-like */}
                    <div
                        className={[
                            "relative flex items-end gap-2",
                            "px-2 py-2",
                            "border border-base-300",
                            "shadow-sm",
                            "rounded-full", // ✅ WhatsApp-like
                            "bg-base-100/70",
                            "chat-composer-capsule",
                        ].join(" ")}
                    >
                        {/* selected pills (arriba de la cápsula) */}
                        {(selectedImage || selectedAudio || selectedDoc) && (
                            <div className="absolute inset-x-2 -top-14">
                                <div className="flex flex-wrap items-center gap-2 text-xs opacity-90">
                                    {selectedImage && (
                                        <div className="flex items-center gap-1 px-2 py-1 border rounded-full border-base-300 bg-base-100 chat-composer-pill">
                                            <ImageIcon className="w-4 h-4 chat-pill-icon-image" />
                                            <span className="truncate max-w-28">{selectedImage.name}</span>
                                            <button
                                                className="btn btn-ghost btn-xs"
                                                onClick={() => setSelectedImage(null)}
                                                title="Quitar"
                                                type="button"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}

                                    {selectedAudio && (
                                        <div className="flex items-center gap-1 px-2 py-1 border rounded-full border-base-300 bg-base-100 chat-composer-pill">
                                            <FileAudio2 className="w-4 h-4 chat-pill-icon-audio" />
                                            <span className="truncate max-w-28">{selectedAudio.name}</span>
                                            <button
                                                className="btn btn-ghost btn-xs"
                                                onClick={() => setSelectedAudio(null)}
                                                title="Quitar"
                                                type="button"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}

                                    {selectedDoc && (
                                        <div className="flex items-center gap-1 px-2 py-1 border rounded-full border-base-300 bg-base-100 chat-composer-pill">
                                            <FileText className="w-4 h-4 chat-pill-icon-doc" />
                                            <span className="truncate max-w-28">{selectedDoc.name}</span>
                                            <button
                                                className="btn btn-ghost btn-xs"
                                                onClick={() => setSelectedDoc(null)}
                                                title="Quitar"
                                                type="button"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* reply chip */}
                        {replyTo && (
                            <div className="absolute flex items-center justify-between px-3 py-1 text-xs border left-2 right-2 -top-10 rounded-xl bg-base-100/90 border-base-300 chat-composer-reply">
                                <div className="truncate">Respondiendo: {replyTo.textPreview}</div>
                                <button
                                    className="btn btn-ghost btn-xs"
                                    onClick={cancelReplyTo}
                                    title="Cancelar respuesta"
                                    type="button"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* hidden inputs */}
 <input
  ref={imageInputRef}
  type="file"
  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
  hidden
  onChange={onPickImage}
/>

<input
  ref={audioInputRef}
  type="file"
  accept=".mp3,.ogg,.m4a,.webm,audio/mpeg,audio/ogg,audio/mp4,audio/webm"
  hidden
  onChange={onPickAudio}
/>
                        <input ref={docInputRef} type="file" accept="application/pdf" hidden onChange={onPickDocument} />

                        {/* LEFT ACTIONS (WhatsApp: en fila, no columna) */}
                        <div className="flex items-center gap-1.5 shrink-0">
                           {/* Emoji */}
<div className="relative">
  <button
    ref={emojiBtnRef}
    type="button"
    className="btn btn-circle btn-sm btn-ghost"
    title="Emojis"
    onClick={() => setShowEmojiPicker((v) => !v)}
    disabled={!canWrite}
  >
    <Smile className="w-5 h-5" />
  </button>

  {showEmojiPicker && (
    <div
      ref={emojiPickerRef}
      className="absolute bottom-[120%] left-[1500%] z-[9999]"
      style={{ transformOrigin: "bottom left" }}
    >
      <div className="border shadow-lg rounded-box bg-base-100 border-base-300">
        <EmojiPickerLite
          onPick={(e) => {
            insertEmojiAtCursor({ native: e });
            setShowEmojiPicker(false);
          }}
        />
      </div>
    </div>
  )}
</div>

                            {/* Attach */}
                            <div className="relative">
                                <button
                                    ref={attachBtnRef}
                                    type="button"
                                    className="btn btn-circle btn-sm btn-ghost"
                                    disabled={!canWrite || sending}
                                    onClick={() => setShowAttachMenu((v) => !v)}
                                    aria-haspopup="menu"
                                    aria-expanded={showAttachMenu}
                                    title="Adjuntar"
                                >
                                    <Paperclip className="w-5 h-5" />
                                </button>

                                {showAttachMenu && (
                                    <div
                                        id="attach-menu"
                                        className="absolute bottom-[120%] left-0 z-50 w-56 p-1 border shadow-md rounded-xl bg-base-100 border-base-300 chat-composer-menu"
                                    >
                                        <button
                                            className="justify-start w-full gap-2 btn btn-ghost btn-sm"
                                            onClick={() => imageInputRef.current?.click()}
                                            disabled={!canWrite || sending}
                                            type="button"
                                        >
                                            <ImageIcon className="w-4 h-4" /> Imagen
                                        </button>

                                        <button
                                            className="justify-start w-full gap-2 btn btn-ghost btn-sm"
                                            onClick={() => {
                                                setShowImagenesGuardadas(true);
                                                setShowAttachMenu(false);
                                            }}
                                            disabled={!canWrite || sending}
                                            type="button"
                                        >
                                            <ImageIcon className="w-4 h-4" /> Imágenes guardadas
                                        </button>

                                        <button
                                            className="justify-start w-full gap-2 btn btn-ghost btn-sm"
                                            onClick={() => audioInputRef.current?.click()}
                                            disabled={!canWrite || sending}
                                            type="button"
                                        >
                                            <FileAudio2 className="w-4 h-4" /> Audio
                                        </button>

                                        <button
                                            className="justify-start w-full gap-2 btn btn-ghost btn-sm"
                                            onClick={() => docInputRef.current?.click()}
                                            disabled={!canWrite || sending}
                                            type="button"
                                        >
                                            <FileText className="w-4 h-4" /> Documento
                                        </button>

                                        <div className="my-1 border-t chat-composer-divider border-base-300" />

                                        <button
                                            className="justify-start w-full btn btn-ghost btn-sm"
                                            disabled={!canWrite || sending}
                                            onClick={sendManual24hTemplate}
                                            type="button"
                                        >
                                            Plantilla 24 h
                                        </button>

                                        <button
                                            className="justify-start w-full btn btn-ghost btn-sm"
                                            disabled={!canWrite}
                                            onClick={() => setShowCombos(true)}
                                            type="button"
                                        >
                                            Enviar Combos
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* TEXTAREA (WhatsApp-like: transparente dentro de la cápsula) */}
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            className={[
                                "textarea textarea-ghost flex-1 min-w-0 resize-none border-0",
                                "!p-2",
                                "min-h-[40px] max-h-[120px]",
                                "leading-relaxed text-[16px]",
                                "bg-transparent",
                                "chat-composer-textarea",
                            ].join(" ")}
                            placeholder={canWrite ? "Escribí un mensaje…" : "Conversación asignada a otro agente"}
                            value={text}
                            onChange={(e) => {
                                setText(e.target.value);
                                setTyping(true);
                            }}
                            onKeyDown={onMsgKeyDown}
                            onFocus={() => setTyping(true)}
                            onBlur={() => setTyping(false)}
                            disabled={!canWrite}
                            autoComplete="off"
                            autoCorrect="on"
                            autoCapitalize="sentences"
                            spellCheck={true}
                        />

                        {/* RIGHT ACTION (WhatsApp: botón circular) */}
                        {canSendNow ? (
                            <button
                                onClick={doSend}
                                type="button"
                                disabled={!canWrite || sending}
                                className="btn btn-circle btn-primary btn-sm shrink-0"
                                title="Enviar"
                            >
                                <SendIcon className="w-5 h-5" />
                            </button>
                        ) : (
                            <div className="shrink-0">
                                <AudioRecorderButton
                                    conversationId={conversationId}
                                    canWrite={canWrite && !sending}
                                    iconOnly
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}