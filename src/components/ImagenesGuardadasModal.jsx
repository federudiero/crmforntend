// src/components/ImagenesGuardadasModal.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";

export default function ImagenesGuardadasModal({ open, onClose, onSelect }) {
  const [imagenes, setImagenes] = useState([]);

  useEffect(() => {
    if (!open) return;
    const ref = collection(db, "imagenesPredefinidas");
    return onSnapshot(ref, (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      setImagenes(arr);
    });
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50">
      <div className="h-[80vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-base-100 p-4 shadow">
        <h3 className="mb-4 text-lg font-bold">Imágenes guardadas</h3>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {imagenes.map((img) => (
            <div
              key={img.id}
              className="cursor-pointer hover:opacity-80"
              onClick={() => onSelect && onSelect(img)}
            >
              <img
                src={img.url}
                alt={img.titulo || "Imagen guardada"}
                className="object-cover w-full h-40 rounded-lg"
              />
              {img.titulo && (
                <p className="mt-1 text-sm truncate">{img.titulo}</p>
              )}
            </div>
          ))}
        </div>

        <button className="mt-6 btn btn-outline" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
