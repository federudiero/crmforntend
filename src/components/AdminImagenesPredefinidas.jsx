// src/pages/AdminImagenesPredefinidas.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase/firebase";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

export default function AdminImagenesPredefinidas() {
  const [imagenes, setImagenes] = useState([]);
  const [url, setUrl] = useState("");
  const [titulo, setTitulo] = useState("");
  const [categoria, setCategoria] = useState("");

  useEffect(() => {
    const ref = collection(db, "imagenesPredefinidas");
    return onSnapshot(ref, (snap) => {
      const arr = [];
      snap.forEach((d) =>
        arr.push({ id: d.id, ...d.data() })
      );
      setImagenes(arr);
    });
  }, []);

  const guardar = async () => {
    if (!url.trim()) return alert("Falta URL");
    await addDoc(collection(db, "imagenesPredefinidas"), {
      url,
      titulo: titulo || "",
      categoria: categoria || "",
      createdAt: serverTimestamp(),
    });
    setUrl("");
    setTitulo("");
    setCategoria("");
  };

  const borrar = async (id) => {
    await deleteDoc(doc(db, "imagenesPredefinidas", id));
  };

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-bold">Imágenes Predefinidas</h1>

      {/* Formulario */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="URL de Cloudinary"
          className="w-full input input-bordered"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          type="text"
          placeholder="Título"
          className="input input-bordered"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <input
          type="text"
          placeholder="Categoría"
          className="input input-bordered"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        />
        <button className="btn btn-primary" onClick={guardar}>
          Agregar
        </button>
      </div>

      {/* Galería */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {imagenes.map((img) => (
          <div key={img.id} className="shadow card bg-base-200">
            <figure>
              <img src={img.url} alt="" className="object-cover w-full h-40" />
            </figure>

            <div className="p-3 card-body">
              <p className="text-sm font-semibold">{img.titulo}</p>
              <p className="text-xs opacity-60">{img.categoria}</p>
              <button
                className="mt-2 btn btn-error btn-sm"
                onClick={() => borrar(img.id)}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
