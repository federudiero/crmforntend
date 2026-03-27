import React, { useEffect, useRef, useState } from "react";
import { Mic, Square as StopIcon, X } from "lucide-react";
import { uploadFile } from "../services/storage";
import { sendMessage } from "../services/api";

/**
 * Props:
 * - conversationId: string (requerido)
 * - canWrite: boolean
 * - className?: string
 * - iconOnly?: boolean
 */

const MIN_RECORD_MS = 500;
const MIN_AUDIO_BYTES = 1024;

function baseMime(mime = "") {
  return String(mime || "").toLowerCase().split(";")[0].trim();
}

function extFromMime(mime = "") {
  const m = baseMime(mime);
  if (m === "audio/mpeg") return "mp3";
  if (m === "audio/mp4") return "m4a";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/wav") return "wav";
  if (m === "audio/aac") return "aac";
  if (m === "audio/webm") return "webm";
  return "webm";
}

function isSafariLike() {
  const ua = String(navigator.userAgent || "").toLowerCase();
  return /safari/.test(ua) && !/chrome|chromium|android/.test(ua);
}

function pickSupportedAudioConfig() {
  if (!window.MediaRecorder) return null;

  const safariCandidates = [
    { mimeType: "audio/mp4", ext: "m4a" },
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
    { mimeType: "audio/ogg", ext: "ogg" },
  ];

  const defaultCandidates = [
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
    { mimeType: "audio/ogg", ext: "ogg" },
  ];

  const candidates = isSafariLike() ? safariCandidates : defaultCandidates;

  for (const item of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(item.mimeType)) {
      return item;
    }
  }

  return { mimeType: "", ext: "webm" };
}

export default function AudioRecorderButton({
  conversationId,
  canWrite = true,
  className = "",
  iconOnly = false,
}) {
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const stopReasonRef = useRef("send");
  const finalizeGuardRef = useRef(false);
  const recordingMimeRef = useRef("");
  const recordingExtRef = useRef("webm");

  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [permissionError, setPermissionError] = useState(null);

  useEffect(() => {
    return () => {
      stopInternal(false);
      stopStreams();
      clearTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabled = !canWrite || busy;

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

  function showError(msg) {
    setPermissionError(msg);
    window.clearTimeout(showError._t);
    showError._t = window.setTimeout(() => setPermissionError(null), 3500);
  }

  async function startInternal() {
    if (disabled || recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Este navegador no soporta grabación de audio.");
      return;
    }

    setPermissionError(null);
    finalizeGuardRef.current = false;
    stopReasonRef.current = "send";

    try {
      const picked = pickSupportedAudioConfig();
      if (!picked) {
        showError("Este navegador no soporta grabación de audio con MediaRecorder.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const mr = picked.mimeType
        ? new MediaRecorder(stream, { mimeType: picked.mimeType })
        : new MediaRecorder(stream);

      mediaRef.current = mr;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recordingMimeRef.current = mr.mimeType || picked.mimeType || "";
      recordingExtRef.current =
        extFromMime(recordingMimeRef.current || picked.mimeType || picked.ext);

      mr.ondataavailable = (e) => {
        if (e?.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mr.onerror = (e) => {
        console.error("MediaRecorder error:", e);
        showError("No se pudo grabar el audio.");
      };

      mr.onstop = async () => {
        clearTimer();
        setRecording(false);

        const reason = stopReasonRef.current;
        const durationMs = Math.max(0, Date.now() - startedAtRef.current);
        const exactMime = mr.mimeType || recordingMimeRef.current || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: exactMime });
        const size = chunksRef.current.reduce((acc, part) => acc + (part?.size || 0), 0);

        chunksRef.current = [];
        stopStreams();
        mediaRef.current = null;

        if (reason !== "send") return;

        if (durationMs < MIN_RECORD_MS) {
          showError("El audio es demasiado corto. Mantené presionado un poco más.");
          return;
        }

        if (!blob || blob.size < MIN_AUDIO_BYTES || size < MIN_AUDIO_BYTES) {
          showError("El audio salió incompleto. Probá grabarlo de nuevo.");
          return;
        }

        await sendBlob(blob, {
          mimeType: exactMime,
          ext: recordingExtRef.current || extFromMime(exactMime),
          durationMs,
        });
      };

      mr.start(250);
      setElapsed(0);
      setRecording(true);

      timerRef.current = window.setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } catch (e) {
      console.error(e);
      showError("No se pudo acceder al micrófono. Revisá los permisos del navegador.");
      stopStreams();
      mediaRef.current = null;
      setRecording(false);
    }
  }

  function stopInternal(send) {
    const mr = mediaRef.current;
    if (!mr || mr.state === "inactive" || finalizeGuardRef.current) return;

    finalizeGuardRef.current = true;
    stopReasonRef.current = send ? "send" : "cancel";
    clearTimer();

    try {
      if (mr.state === "recording") {
        try {
          mr.requestData?.();
        } catch (e) {
          console.warn("requestData failed:", e);
        }

        window.setTimeout(() => {
          try {
            if (mr.state !== "inactive") mr.stop();
          } catch (e) {
            console.error(e);
          }
        }, 80);
      }
    } catch (e) {
      console.error(e);
      stopStreams();
      mediaRef.current = null;
      setRecording(false);
    }
  }

  async function sendBlob(blob, meta = {}) {
    if (!blob || !conversationId) return;

    setBusy(true);
    try {
      const exactMime = String(meta.mimeType || blob.type || "audio/webm").trim();
      const normalizedMime = baseMime(exactMime) || "audio/webm";
      const ext = meta.ext || extFromMime(exactMime);
      const name = `rec_${Date.now()}.${ext}`;
      const dest = `uploads/${conversationId}/${name}`;
      const file = new File([blob], name, { type: exactMime || normalizedMime });

      const uploaded = await uploadFile(file, dest, {
        allowed: [
          "audio/ogg",
          "audio/ogg;codecs=opus",
          "audio/webm",
          "audio/webm;codecs=opus",
          "audio/mp4",
          "audio/mpeg",
          "audio/wav",
          "audio/aac",
        ],
      });

      const finalMime = uploaded?.contentType || normalizedMime;
      const finalExt = extFromMime(finalMime);

      const res = await sendMessage({
        to: String(conversationId),
        conversationId,
        audio: { link: uploaded.url },
        audioMeta: {
          mime: finalMime,
          filename: `rec_${Date.now()}.${finalExt}`,
          size: uploaded?.size || blob.size || 0,
          duration: Math.max(1, Math.round((meta.durationMs || 0) / 1000)),
          voice: true,
          converted: !!uploaded?.converted,
        },
      });

      if (res?.ok === false) {
        const err = res?.results?.[0]?.error;
        console.error("Audio send error:", err);
        alert("No se pudo enviar el audio.");
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "No se pudo enviar el audio");
    } finally {
      setBusy(false);
    }
  }

  const handlePointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startInternal();
  };

  const handlePointerUp = (e) => {
    e.preventDefault();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (recording) stopInternal(true);
  };

  const handlePointerCancel = (e) => {
    e.preventDefault();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        title={
          recording
            ? "Soltá para enviar, cancelá para descartar"
            : "Mantené presionado para grabar"
        }
        aria-label="Grabar audio"
      >
        {recording ? <StopIcon className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        {!iconOnly && !recording && <span className="ml-1 text-xs">Audio</span>}
      </button>

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

      {permissionError && (
        <div className="absolute z-50 max-w-xs px-2 py-1 text-xs text-white -translate-x-1/2 bg-red-600 rounded-md shadow-lg -top-16 left-1/2">
          {permissionError}
        </div>
      )}
    </div>
  );
}
