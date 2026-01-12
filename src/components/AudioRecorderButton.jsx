// src/components/AudioRecorderButton.jsx
import React, { useEffect, useRef, useState } from "react";
import { Mic, Square as StopIcon, X } from "lucide-react";
import { uploadFile } from "../services/storage";
import { sendMessage } from "../services/api";

/**
 * Props:
 * - conversationId: string (requerido)
 * - canWrite: boolean (habilita/deshabilita)
 * - className?: string (clases extra para el botón)
 * - iconOnly?: boolean → si true, solo icono (sin texto)
 *
 * Comportamiento tipo WhatsApp:
 * - Mantener presionado para grabar.
 * - Soltar sobre el botón → envía el audio.
 * - Soltar fuera del botón / cancelar → descarta el audio.
 */
export default function AudioRecorderButton({
  conversationId,
  canWrite = true,
  className = "",
  iconOnly = false,
}) {
  const mediaRef = useRef(null);       // MediaRecorder
  const chunksRef = useRef([]);        // buffers de audio
  const shouldSendRef = useRef(true);  // si false → no manda (cancelado)

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0); // segundos
  const [permissionError, setPermissionError] = useState(null);
  const timerRef = useRef(null);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      stopInternal(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabled = !canWrite || busy;

  // Formateo mm:ss
  const formatElapsed = (s) => {
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStreams() {
    try {
      const mr = mediaRef.current;
      if (mr?.stream) {
        mr.stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function startInternal() {
    if (disabled || recording) return;
    setPermissionError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current = [];
      shouldSendRef.current = true;
      setElapsed(0);

      mr.ondataavailable = (e) => {
        if (e?.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mr.onstop = async () => {
        clearTimer();
        setRecording(false);

        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        chunksRef.current = [];

        stopStreams();
        mediaRef.current = null;

        // Cancelado → no enviamos nada
        if (!shouldSendRef.current) return;
        if (!blob || blob.size === 0) return;

        await sendBlob(blob);
      };

      mr.start();
      setRecording(true);

      // Timer simple
      timerRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error(e);
      setPermissionError(
        "No se pudo acceder al micrófono. Revisá los permisos del navegador."
      );
      stopStreams();
      setRecording(false);
    }
  }

  function stopInternal(send) {
    if (!recording) return;
    shouldSendRef.current = !!send;
    clearTimer();
    try {
      mediaRef.current?.stop();
    } catch (e) {
      console.error(e);
    }
  }

  async function sendBlob(blob) {
    if (!blob || !conversationId) return;
    setBusy(true);
    try {
      const name = `rec_${Date.now()}.webm`;
      const dest = `uploads/${conversationId}/${name}`;
      const file = new File([blob], name, { type: blob.type });

      const { url } = await uploadFile(file, dest);
      await sendMessage({
        to: String(conversationId),
        conversationId,
        audio: { link: url },
      });
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo enviar el audio");
    } finally {
      setBusy(false);
    }
  }

  // ====== Handlers tipo WhatsApp ======
  const handleMouseDown = (e) => {
    e.preventDefault();
    startInternal();
  };
  const handleMouseUp = (e) => {
    e.preventDefault();
    if (recording) stopInternal(true); // soltar sobre el botón → manda
  };
  const handleMouseLeave = (e) => {
    e.preventDefault();
    if (recording) stopInternal(false); // salir del botón → cancelar
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    startInternal();
  };
  const handleTouchEnd = (e) => {
    e.preventDefault();
    if (recording) stopInternal(true);
  };
  const handleTouchCancel = (e) => {
    e.preventDefault();
    if (recording) stopInternal(false);
  };

  const baseBtn =
    iconOnly ? "btn btn-circle btn-sm" : "btn btn-sm rounded-full px-3";
  const colorBtn = recording
    ? "bg-red-600 text-white hover:bg-red-700 border border-red-700"
    : "bg-white text-black hover:bg-[#F1FAF3] border border-[#CDEBD6]";

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        disabled={disabled}
        className={`${baseBtn} ${colorBtn} ${className}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        title={
          recording
            ? "Soltá para enviar, salí del botón para cancelar"
            : "Mantené presionado para grabar"
        }
        aria-label="Grabar audio"
      >
        {recording ? (
          <StopIcon className="w-4 h-4" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
        {!iconOnly && !recording && (
          <span className="ml-1 text-xs">Audio</span>
        )}
      </button>

      {/* Pill de “grabando…” */}
      {recording && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/80 px-2 py-1 text-[10px] text-white">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span>Grabando… {formatElapsed(elapsed)}</span>
          <button
            type="button"
            className="ml-1"
            onClick={(e) => {
              e.preventDefault();
              stopInternal(false);
            }}
            title="Cancelar"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Aviso de permisos */}
      {permissionError && (
        <div className="absolute z-50 max-w-xs px-2 py-1 text-xs text-white -translate-x-1/2 bg-red-600 rounded-md shadow-lg -top-16 left-1/2">
          {permissionError}
        </div>
      )}
    </div>
  );
}
