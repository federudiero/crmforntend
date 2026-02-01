// src/chatwindow/ChatWindow.jsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { arrayRemove, arrayUnion, doc, updateDoc, deleteDoc } from "firebase/firestore";

import { db } from "../../firebase.js";
import { useAuthState } from "../../hooks/useAuthState.js";
import { sendMessage } from "../../services/api";
import { uploadFile } from "../../services/storage";
import useTypingPresence from "../../hooks/useTypingPresence.js";

// ✅ hooks del módulo chatwindow (según tu captura)
import useConversationMeta from "./hooks/chat/useConversationMeta.js";
import useConversationMessages from "./hooks/chat/useConversationMessages.js";
import useContact from "./hooks/chat/useContact.js";
import useLabels from "./hooks/chat/useLabels.js";

// ✅ UI (según tu captura)
import ChatHeader from "./chat/ChatHeader.jsx";
import ChatTabs from "./chat/ChatTabs.jsx";
import ChatMessagesPane from "./chat/ChatMessagesPane.jsx";
import ChatComposer from "./chat/ChatComposer.jsx";

// ✅ modals están en /modals (NO en ./chat/modals)
import TagsModal from "./modals/TagsModal.jsx";
import CombosModal from "./modals/CombosModal.jsx";
import ImagePreviewModal from "./modals/ImagePreviewModal.jsx";
import ProfileDrawer from "./modals/ProfileDrawer.jsx";

// ✅ estos viven afuera del módulo (normalmente en /components)
import ChatDestacadosPanel from "../../components/ChatDestacadosPanel.jsx";
import ImagenesGuardadasModal from "../../components/ImagenesGuardadasModal.jsx";

// ✅ libs del módulo chatwindow
import { isOutside24h } from "../chatwindow/lib/chat/time.js";
import { logWaSendOutcome } from "../chatwindow/lib/chat/debug.js";
import { getSellerDisplayName } from "../chatwindow/lib/chat/seller.js";
import { buildReengageTemplate } from "../chatwindow/lib/chat/templates.js";
import { isOutgoingMessage, getVisibleText } from "../chatwindow/lib/chat/text.js";

export default function ChatWindow({ conversationId, onBack }) {
    const { user } = useAuthState();
    const navigate = useNavigate();

    // ---- refs ----
    const viewportRef = useRef(null);
    const textareaRef = useRef(null);
    const attachBtnRef = useRef(null);
    const emojiPickerRef = useRef(null);
    const emojiBtnRef = useRef(null);
    const imageInputRef = useRef(null);
    const audioInputRef = useRef(null);
    const docInputRef = useRef(null);

    // ---- scroll (WhatsApp-like) ----
    const initialScrollDoneRef = useRef(false);
    const restoreScrollTopRef = useRef(null); // number | null
    const lastMsgIdRef = useRef(null);

    // when prepending older messages, preserve viewport position
    const prependingOlderRef = useRef(false);
    const prevScrollHeightRef = useRef(0);
    const prevScrollTopRef = useRef(0);

    // ---- UI ----
    const [tab, setTab] = useState("chat");
    const [showProfile, setShowProfile] = useState(false);
    const [showTags, setShowTags] = useState(false);
    const [showCombos, setShowCombos] = useState(false);
    const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showImagenesGuardadas, setShowImagenesGuardadas] = useState(false);

    // ---- composer ----
    const [sending, setSending] = useState(false);
    const [text, setText] = useState("");
    const [typing, setTyping] = useState(false);
    useTypingPresence(conversationId, user?.uid, typing);

    const [selectedImage, setSelectedImage] = useState(null);
    const [selectedAudio, setSelectedAudio] = useState(null);
    const [selectedDoc, setSelectedDoc] = useState(null);

    // reply + edit
    const [replyTo, setReplyTo] = useState(null); // {id,type,textPreview}
    const [editingMessageId, setEditingMessageId] = useState(null);
    const [editingText, setEditingText] = useState("");

    // pagination
    const [messageLimit, setMessageLimit] = useState(50);

    // ---- data hooks ----
    const { convMeta, convSlugs, canRead, canWrite, isAdmin } = useConversationMeta({
        conversationId,
        user,
    });

    const contact = useContact(conversationId);

    const { allLabels, tagsData, getLabel } = useLabels();
    const { msgs, hasMoreMessages } = useConversationMessages({
        conversationId,
        canRead,
        messageLimit,
    });

    // =========================
    // ✅ RESET PER CHAT + SCROLL
    // =========================

    // reset per chat (solo UI state; NO scroll top)
    useEffect(() => {
        setTab("chat");
        setText("");
        setReplyTo(null);
        setSelectedImage(null);
        setSelectedAudio(null);
        setSelectedDoc(null);
        setEditingMessageId(null);
        setEditingText("");
        setShowAttachMenu(false);
        setShowEmojiPicker(false);
        setImagePreviewUrl(null);
        setShowCombos(false);
        setShowTags(false);
        setShowProfile(false);
        setMessageLimit(50);

        // ❌ NO: requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0 }));
    }, [conversationId]);

    // paginación: antes de pedir más (mensajes viejos), guardo estado para mantener la vista
    const loadMoreMessages = () => {
        const el = viewportRef.current;
        if (el) {
            prevScrollHeightRef.current = el.scrollHeight;
            prevScrollTopRef.current = el.scrollTop;
            prependingOlderRef.current = true;
        }
        setMessageLimit((p) => p + 50);
    };

    // reset de refs de scroll + leer posición guardada para este chat
    useLayoutEffect(() => {
        initialScrollDoneRef.current = false;
        lastMsgIdRef.current = null;

        prependingOlderRef.current = false;
        prevScrollHeightRef.current = 0;
        prevScrollTopRef.current = 0;

        try {
            const key = conversationId ? `chat_scroll:${conversationId}` : null;
            const raw = key ? sessionStorage.getItem(key) : null;
            const n = raw != null ? Number(raw) : NaN;
            restoreScrollTopRef.current = Number.isFinite(n) ? n : null;
        } catch {
            restoreScrollTopRef.current = null;
        }
    }, [conversationId]);

    // guardar scroll mientras scrolleás (para volver exactamente al mismo lugar)
    useEffect(() => {
        if (!conversationId || tab !== "chat") return;
        const el = viewportRef.current;
        if (!el) return;

        const key = `chat_scroll:${conversationId}`;
        let raf = 0;

        const onScroll = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                try {
                    sessionStorage.setItem(key, String(el.scrollTop));
                } catch {
                    // ignore
                }
            });
        };

        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [conversationId, tab]);

    // comportamiento tipo WhatsApp:
    // - al abrir chat: restaura scroll guardado, si no hay => baja al final
    // - si cargás mensajes viejos: mantiene la vista (no salta)
    // - si llegan mensajes nuevos: baja solo si estabas cerca del final
    useLayoutEffect(() => {
        if (!conversationId || tab !== "chat") return;
        const el = viewportRef.current;
        if (!el) return;

        // 1) si se prependearon mensajes viejos, anclar la vista
        if (prependingOlderRef.current) {
            const newH = el.scrollHeight;
            const delta = newH - (prevScrollHeightRef.current || 0);
            el.scrollTop = (prevScrollTopRef.current || 0) + delta;
            prependingOlderRef.current = false;
            return;
        }

        // 2) primera vez que pinta este chat: restaurar o ir al final
        if (!initialScrollDoneRef.current) {
            if (!msgs || msgs.length === 0) return;

            const desired = restoreScrollTopRef.current;
            if (Number.isFinite(desired)) {
                el.scrollTop = Math.min(desired, el.scrollHeight);
            } else {
                el.scrollTop = el.scrollHeight + 9999;
            }

            initialScrollDoneRef.current = true;
            lastMsgIdRef.current = msgs?.[msgs.length - 1]?.id || null;
            return;
        }

        // 3) nuevos mensajes: autoscroll solo si el usuario está cerca del final
        const lastId = msgs?.[msgs.length - 1]?.id || null;
        if (lastId && lastId !== lastMsgIdRef.current) {
            const distanceToBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
            const nearBottom = distanceToBottom < 140; // px
            if (nearBottom) el.scrollTop = el.scrollHeight + 9999;
            lastMsgIdRef.current = lastId;
        }
    }, [conversationId, tab, msgs]);

    // -------- label ops --------
    const toggleLabel = async (slug) => {
        if (!conversationId) return;
        const ref = doc(db, "conversations", String(conversationId));
        const has = (convSlugs || []).includes(slug);
        await updateDoc(ref, { labels: has ? arrayRemove(slug) : arrayUnion(slug) });
    };

    const removeTag = async (slug) => {
        if (!conversationId || !slug) return;
        await updateDoc(doc(db, "conversations", String(conversationId)), {
            labels: arrayRemove(slug),
        });
    };

    // -------- sold toggle --------
    const [savingSold, setSavingSold] = useState(false);
    const isSold = Array.isArray(convMeta?.labels) && convMeta.labels.includes("vendido");
    const toggleSold = async () => {
        if (!conversationId || !canWrite) return;
        try {
            setSavingSold(true);
            if (!isSold) {
                await updateDoc(doc(db, "conversations", String(conversationId)), {
                    labels: arrayUnion("vendido"),
                    soldAt: new Date(),
                    soldByUid: user?.uid || null,
                    soldByEmail: user?.email || null,
                    soldByName: user?.displayName || user?.email || null,
                    updatedAt: new Date(),
                });
            } else {
                await updateDoc(doc(db, "conversations", String(conversationId)), {
                    labels: arrayRemove("vendido"),
                });
            }
        } finally {
            setSavingSold(false);
        }
    };

    // -------- reply helpers --------
    const beginReplyTo = (m) => {
        const visible = getVisibleText(m);
        const type =
            m?.media?.kind ||
            m?.mediaKind ||
            m?.type ||
            (m?.document ? "document" : m?.image ? "image" : m?.audio ? "audio" : "text");

        setReplyTo({
            id: m.id,
            type,
            textPreview:
                visible ||
                (type === "image"
                    ? "Imagen"
                    : type === "audio"
                        ? "Audio"
                        : type === "document"
                            ? "Documento"
                            : "Mensaje"),
        });
        requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const cancelReplyTo = () => setReplyTo(null);

    // -------- edit/delete outgoing --------
    const beginEditMessage = (m) => {
        if (!isOutgoingMessage(m, user) || !canWrite) return;
        setEditingText(getVisibleText(m));
        setEditingMessageId(m.id);
    };
    const cancelEditMessage = () => {
        setEditingMessageId(null);
        setEditingText("");
    };

    const saveEditMessage = async () => {
        if (!conversationId || !editingMessageId) return;
        const m = msgs.find((x) => x.id === editingMessageId);
        if (!m) return;
        if (!isOutgoingMessage(m, user) || !canWrite) return;

        const colName = m.__col === "messages" ? "messages" : "msgs";
        const ref = doc(db, "conversations", String(conversationId), colName, String(m.id));
        const newText = (editingText || "").trim();

        await updateDoc(ref, {
            text: newText,
            "message.text.body": newText,
            body: newText,
            caption: newText || null,
            updatedBy: user?.email || user?.uid || "agent",
            updatedAt: new Date(),
        });

        cancelEditMessage();
    };

    const deleteMessage = async (m) => {
        if (!conversationId || !m?.id) return;
        if (!isOutgoingMessage(m, user) || !canWrite) return;
        const ok = confirm("¿Eliminar definitivamente este mensaje saliente?");
        if (!ok) return;

        const colName = m.__col === "messages" ? "messages" : "msgs";
        const ref = doc(db, "conversations", String(conversationId), colName, String(m.id));
        await deleteDoc(ref);
    };

    // -------- attach pickers --------
    const onPickImage = (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) setSelectedImage(f);
        setShowAttachMenu(false);
    };
    const onPickAudio = (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) setSelectedAudio(f);
        setShowAttachMenu(false);
    };
    const onPickDocument = (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) setSelectedDoc(f);
        setShowAttachMenu(false);
    };

    // -------- send template 24h (manual button) --------
    const sendManual24hTemplate = async () => {
        try {
            const sellerUser = {
                alias: convMeta?.assignedToName || "",
                name: user?.displayName || user?.name || "",
                email: user?.email || "",
            };
            const sellerName = getSellerDisplayName(sellerUser);

            const rawWebhookSnapshot = (() => {
                try {
                    for (const m of msgs) {
                        if (!isOutgoingMessage(m, user) && m?.raw) return m.raw;
                    }
                    return null;
                } catch {
                    return null;
                }
            })();

            const templatePayload = buildReengageTemplate({
                contact,
                sellerUser,
                rawWebhookSnapshot,
            });

            setSending(true);
            const tplRes = await sendMessage({
                to: String(conversationId),
                conversationId,
                sellerName,
                template: templatePayload,
            });

            logWaSendOutcome("manual-24h", tplRes, { template: templatePayload }, { conversationId, sellerName });

            const code = tplRes?.results?.[0]?.error?.error?.code || tplRes?.results?.[0]?.error?.code;
            if (tplRes?.ok === false) alert(`No se pudo enviar la plantilla.\nCódigo: ${code || "desconocido"}`);

            const serverConvId = tplRes?.results?.[0]?.to;
            if (serverConvId && serverConvId !== conversationId) {
                navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
            }
        } finally {
            setSending(false);
        }
    };

    // -------- main send (text + media) --------
    const doSend = async () => {
        const body = (text || "").trim();
        const hasText = !!body;
        const hasImage = !!selectedImage;
        const hasAudio = !!selectedAudio;
        const hasDoc = !!selectedDoc;

        if (!conversationId || (!hasText && !hasImage && !hasAudio && !hasDoc) || !canWrite) return;

        const lastInboundAt =
            convMeta?.lastInboundAt ??
            convMeta?.lastInboundMessageAt ??
            convMeta?.lastMessageInboundAt ??
            convMeta?.lastMessageAt;

        const outside = isOutside24h(lastInboundAt);

        const sellerUser = {
            alias: convMeta?.assignedToName || "",
            name: user?.displayName || user?.name || "",
            email: user?.email || "",
        };
        const sellerName = getSellerDisplayName(sellerUser);

        // snapshot para template reengage
        const rawWebhookSnapshot = (() => {
            try {
                for (const m of msgs) {
                    if (!isOutgoingMessage(m, user) && m?.raw) return m.raw;
                }
                return null;
            } catch {
                return null;
            }
        })();

        // limpiar input inmediato
        setText("");
        const imageToSend = selectedImage;
        const audioToSend = selectedAudio;
        const docToSend = selectedDoc;
        setSelectedImage(null);
        setSelectedAudio(null);
        setSelectedDoc(null);

        requestAnimationFrame(() => textareaRef.current?.focus());

        try {
            // 1) texto o template
            if (hasText) {
                if (outside) {
                    const templatePayload = buildReengageTemplate({
                        contact,
                        sellerUser,
                        rawWebhookSnapshot,
                    });

                    const tplRes = await sendMessage({
                        to: String(conversationId),
                        conversationId,
                        sellerName,
                        template: templatePayload,
                    });

                    logWaSendOutcome("auto-24h", tplRes, { template: templatePayload }, { conversationId, outside, sellerName });

                    const serverConvId = tplRes?.results?.[0]?.to;
                    if (serverConvId && serverConvId !== conversationId) {
                        navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
                    }

                    if (tplRes?.ok === false) {
                        const code = tplRes?.results?.[0]?.error?.error?.code || tplRes?.results?.[0]?.error?.code;
                        alert(`No se pudo enviar la plantilla.\nCódigo: ${code || "desconocido"}`);
                    }
                } else {
                    const textRes = await sendMessage({
                        to: String(conversationId),
                        conversationId,
                        sellerName,
                        text: body,
                        ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
                    });

                    const serverConvId = textRes?.results?.[0]?.to;
                    if (serverConvId && serverConvId !== conversationId) {
                        navigate(`/app/${encodeURIComponent(serverConvId)}`, { replace: true });
                    }
                    if (textRes?.ok === false) {
                        const code = textRes?.results?.[0]?.error?.error?.code || textRes?.results?.[0]?.error?.code;
                        alert(`No se pudo enviar el texto.\nCódigo: ${code || "desconocido"}`);
                    }
                }
            }

            // 2) imagen
            if (hasImage && imageToSend) {
                setSending(true);
                const dest = `uploads/${conversationId}/${Date.now()}_${imageToSend.name}`;
                const { url } = await uploadFile(imageToSend, dest);
                const res = await sendMessage({
                    to: String(conversationId),
                    conversationId,
                    sellerName,
                    image: { link: url },
                    ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
                });
                if (res?.ok === false) alert("No se pudo enviar la imagen.");
            }

            // 3) audio
            if (hasAudio && audioToSend) {
                setSending(true);
                const dest = `uploads/${conversationId}/${Date.now()}_${audioToSend.name}`;
                const { url } = await uploadFile(audioToSend, dest, {
                    allowed: ["audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4", "audio/aac", "audio/webm", "audio/webm;codecs=opus"],
                });
                const res = await sendMessage({
                    to: String(conversationId),
                    conversationId,
                    sellerName,
                    audio: { link: url },
                    ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
                });
                if (res?.ok === false) alert("No se pudo enviar el audio.");
            }

            // 4) doc
            if (hasDoc && docToSend) {
                setSending(true);
                const dest = `uploads/${conversationId}/${Date.now()}_${docToSend.name}`;
                const { url } = await uploadFile(docToSend, dest, {
                    allowed: [
                        "application/pdf",
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "image/gif",
                        "audio/mpeg",
                        "audio/ogg",
                        "audio/wav",
                        "audio/mp4",
                        "audio/aac",
                        "audio/webm",
                        "audio/webm;codecs=opus",
                    ],
                });

                const res = await sendMessage({
                    to: String(conversationId),
                    conversationId,
                    sellerName,
                    document: { link: url, filename: docToSend?.name || undefined },
                    ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
                });
                if (res?.ok === false) alert("No se pudo enviar el documento.");
            }

            // scroll bottom (lo dejo igual que vos; el hook también autoscrollea si estás abajo)
            requestAnimationFrame(() => {
                const el = viewportRef.current;
                if (el) el.scrollTo({ top: el.scrollHeight + 9999, behavior: "smooth" });
            });
        } catch (e) {
            alert(e?.message || "No se pudo enviar");
        } finally {
            setSending(false);
            setShowAttachMenu(false);
            setReplyTo(null);
        }
    };

    // cerrar attach/emoji con click afuera
    useEffect(() => {
        if (!showAttachMenu) return;
        const onDocClick = (e) => {
            const menu = document.getElementById("attach-menu");
            if (!attachBtnRef.current) return;
            if (!attachBtnRef.current.contains(e.target) && menu && !menu.contains(e.target)) setShowAttachMenu(false);
        };
        const onEsc = (e) => e.key === "Escape" && setShowAttachMenu(false);
        document.addEventListener("click", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("click", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, [showAttachMenu]);

    useEffect(() => {
        if (!showEmojiPicker) return;
        const onDocClick = (e) => {
            const clickedInsidePanel = emojiPickerRef.current?.contains(e.target);
            const clickedOnButton = emojiBtnRef.current?.contains(e.target);
            if (!clickedInsidePanel && !clickedOnButton) setShowEmojiPicker(false);
        };
        const onEsc = (e) => e.key === "Escape" && setShowEmojiPicker(false);
        document.addEventListener("click", onDocClick);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("click", onDocClick);
            document.removeEventListener("keydown", onEsc);
        };
    }, [showEmojiPicker]);

    if (!canRead) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-gray-600">
                No tenés acceso a este chat. Asignate desde la lista.
            </div>
        );
    }

    const phone = convMeta?.clientPhone || contact?.phone || String(conversationId || "");
    const contactId = String(conversationId || phone || "");

    const templateContext = {
        nombre: contact?.name || contact?.fullName || "",
        vendedor: getSellerDisplayName({
            alias: convMeta?.assignedToName || "",
            name: user?.displayName || user?.name || "",
            email: user?.email || "",
        }),
        fecha: new Date().toLocaleDateString(),
        link: window?.location?.href || "",
    };

    return (
        <div className="flex items-stretch w-full h-full overflow-hidden">
            <div className="flex h-full min-h-0 w-full overflow-hidden flex-col text-black bg-[#F6FBF7]">
                <ChatHeader
                    conversationId={conversationId}
                    onBack={onBack}
                    user={user}
                    contact={contact}
                    convMeta={convMeta}
                    convSlugs={convSlugs}
                    getLabel={getLabel}
                    removeTag={removeTag}
                    isSold={isSold}
                    savingSold={savingSold}
                    toggleSold={toggleSold}
                    canWrite={canWrite}
                    setShowTags={setShowTags}
                    setShowProfile={setShowProfile}
                    templateContext={templateContext}
                    textareaRef={textareaRef}
                    setText={setText}
                />

                <section className="flex flex-col flex-1 min-h-0">
                    <ChatTabs tab={tab} setTab={setTab} />

                    {tab === "chat" ? (
                        <ChatMessagesPane
                            viewportRef={viewportRef}
                            msgs={msgs}
                            user={user}
                            canWrite={canWrite}
                            hasMoreMessages={hasMoreMessages}
                            loadMoreMessages={loadMoreMessages}
                            beginReplyTo={beginReplyTo}
                            beginEditMessage={beginEditMessage}
                            deleteMessage={deleteMessage}
                            editingMessageId={editingMessageId}
                            editingText={editingText}
                            setEditingText={setEditingText}
                            cancelEditMessage={cancelEditMessage}
                            saveEditMessage={saveEditMessage}
                            conversationId={conversationId}
                            setImagePreviewUrl={setImagePreviewUrl}
                        />
                    ) : (
                        <main className="flex-1 px-3 py-3 overflow-y-auto md:px-4 md:py-4">
                            <ChatDestacadosPanel chatId={conversationId} />
                        </main>
                    )}
                </section>

                <ChatComposer
                    conversationId={conversationId}
                    user={user}
                    contact={contact}
                    convMeta={convMeta}
                    msgs={msgs}
                    canWrite={canWrite}
                    text={text}
                    setText={setText}
                    sending={sending}
                    setSending={setSending}
                    doSend={doSend}
                    replyTo={replyTo}
                    cancelReplyTo={cancelReplyTo}
                    selectedImage={selectedImage}
                    setSelectedImage={setSelectedImage}
                    selectedAudio={selectedAudio}
                    setSelectedAudio={setSelectedAudio}
                    selectedDoc={selectedDoc}
                    setSelectedDoc={setSelectedDoc}
                    showAttachMenu={showAttachMenu}
                    setShowAttachMenu={setShowAttachMenu}
                    showEmojiPicker={showEmojiPicker}
                    setShowEmojiPicker={setShowEmojiPicker}
                    setTyping={setTyping}
                    textareaRef={textareaRef}
                    attachBtnRef={attachBtnRef}
                    emojiPickerRef={emojiPickerRef}
                    emojiBtnRef={emojiBtnRef}
                    imageInputRef={imageInputRef}
                    audioInputRef={audioInputRef}
                    docInputRef={docInputRef}
                    onPickImage={onPickImage}
                    onPickAudio={onPickAudio}
                    onPickDocument={onPickDocument}
                    sendManual24hTemplate={sendManual24hTemplate}
                    setShowCombos={setShowCombos}
                    setShowImagenesGuardadas={setShowImagenesGuardadas}
                />
            </div>

            <ProfileDrawer
                open={showProfile}
                onClose={() => setShowProfile(false)}
                conversationId={conversationId}
                contactId={contactId}
                phone={phone}
            />

            <ImagePreviewModal url={imagePreviewUrl} onClose={() => setImagePreviewUrl(null)} />

            <TagsModal
                open={showTags}
                onClose={() => setShowTags(false)}
                tagsData={tagsData}
                onPick={toggleLabel}
            />

            <CombosModal
                open={showCombos}
                onClose={() => setShowCombos(false)}
                conversationId={conversationId}
                user={user}
                convMeta={convMeta}
                sendMessage={sendMessage}
                setSending={setSending}
                sending={sending}
            />

            <ImagenesGuardadasModal
                open={showImagenesGuardadas}
                onClose={() => setShowImagenesGuardadas(false)}
                onSelect={async (img) => {
                    if (!img?.url || !conversationId || !canWrite) return;
                    try {
                        setSending(true);
                        const sellerName = getSellerDisplayName({
                            alias: convMeta?.assignedToName || "",
                            name: user?.displayName || user?.name || "",
                            email: user?.email || "",
                        });

                        const res = await sendMessage({
                            to: String(conversationId),
                            conversationId,
                            sellerName,
                            image: { link: img.url },
                            ...(replyTo ? { replyTo: { id: replyTo.id, type: replyTo.type, text: replyTo.textPreview } } : {}),
                        });

                        logWaSendOutcome("saved-image", res, { image: { link: img.url } }, { conversationId, sellerName });
                        if (res?.ok === false) alert("No se pudo enviar la imagen guardada.");
                    } finally {
                        setSending(false);
                        setShowImagenesGuardadas(false);
                        setReplyTo(null);
                    }
                }}
            />
        </div>
    );
}
