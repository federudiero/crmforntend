// src/components/AudioRecorderButton.jsx
import React, { useEffect, useRef, useState } from "react";
import { Mic, Square as StopIcon } from "lucide-react";
import { uploadFile } from "../services/storage";
import { sendMessage } from "../services/api";

/**
 * Props:
 * - conversationId: string (requerido)
 * - canWrite: boolean (habilita/deshabilita)
 * - className?: string (clases extra para el botón)
 * - iconOnly?: boolean  <<--- NUEVO: si true, no muestra texto
 */
export default function AudioRecorderButton({
  conversationId,
  canWrite = true,
  className = "",
  iconOnly = false,
}) {
  const mediaRef = useRef(null); // MediaRecorder
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      try { mediaRef.current?.stream?.getTracks?.().forEach(t => t.stop()); } catch (e){console.error(e)}
      try { mediaRef.current?.stop?.(); } catch (e){console.error(e)}
    };
  }, []);

  async function start() {
    if (!canWrite || busy || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e?.data?.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        await sendBlob(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {console.error(e)
      alert("No se pudo acceder al micrófono.");
    }
  }

  async function stop() {
    if (!recording) return;
    try { mediaRef.current?.stop(); } catch (e) {console.error(e)}
    setRecording(false);
  }

  async function sendBlob(blob) {
    if (!blob || !conversationId) return;
    setBusy(true);
    try {
      const name = `rec_${Date.now()}.webm`;
      const dest = `uploads/${conversationId}/${name}`;
      const { url } = await uploadFile(new File([blob], name, { type: blob.type }), dest);
      await sendMessage({
        to: String(conversationId),
        conversationId,
        audio: { link: url },
      });
    } catch (e) {
      alert(e?.message || "No se pudo enviar el audio");
    } finally {
      setBusy(false);
    }
  }

  const disabled = !canWrite || busy;

  return recording ? (
    <button
      type="button"
      onClick={stop}
      disabled={disabled}
      className={`btn btn-sm btn-error text-white btn-square ${className}`}
      title="Detener"
      aria-label="Detener grabación"
    >
      <StopIcon className="w-4 h-4" />
    </button>
  ) : (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className={`btn btn-sm border border-[#CDEBD6] bg-white text-black hover:bg-[#F1FAF3] ${iconOnly ? "btn-square gap-0" : "gap-2"} ${className}`}
      title="Grabar"
      aria-label="Grabar"
    >
      <Mic className="w-4 h-4" />
      {iconOnly }
    </button>
  );
}
