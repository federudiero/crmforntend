// src/pages/Home.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthState } from "../hooks/useAuthState.js";

import ConversationsList from "../components/ConversationsList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import NewConversation from "../components/NewConversation.jsx";
import AdminPanel from "../components/AdminPanel.jsx";
import RemarketingBulk from "../components/RemarketingBulk.jsx"; // 👈 agregado

export default function Home() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const { convId } = useParams();

  // UI local
  const [showRemarketing, setShowRemarketing] = useState(false);

  useEffect(() => {
    // si usás daisyUI theme
    document.documentElement.setAttribute("data-theme", "crm");
  }, []);

  // ESC para cerrar remarketing
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setShowRemarketing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const adminEmails = useMemo(() => ["fede_rudiero@gmail.com"], []);
  const isAdmin = !!user?.email && adminEmails.includes(user.email);

  const openConv = (id) => navigate(`/home/${encodeURIComponent(id)}`);
  const currentConvId = convId ? decodeURIComponent(convId) : null;

  return (
    <div className="flex flex-col h-full">
    <header className="flex items-center justify-between p-4 border-b bg-[#E8F5E9] border-[#CDEBD6]">

        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">CRM WhatsApp</h1>
          <p className="text-xs text-gray-500 truncate">
            {user?.email} {isAdmin ? "(admin)" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Botón Remarketing disponible para todos */}
          <button
            className="px-3 py-1 text-sm border rounded"
            onClick={() => setShowRemarketing(true)}
            title="Abrir Remarketing por plantillas"
          >
            Remarketing
          </button>

          {/* Botones para vendedores (usuarios no-admin) */}
          {!isAdmin && (
            <>
              <NewConversation onOpen={openConv} />
            </>
          )}

          <button
            className="px-2 py-1 text-sm border rounded"
            onClick={async () => {
              await signOut(auth);
              navigate("/", { replace: true });
            }}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Contenido */}
      <div className="flex-1 min-h-0">
        {isAdmin ? (
          <AdminPanel />
        ) : (
          <div className="grid h-full grid-cols-12">
            {/* Lista izquierda con su propio scroll */}
            <aside className="h-full min-h-0 col-span-4 overflow-y-auto border-r">
              <ConversationsList
                activeId={currentConvId || ""}
                onSelect={openConv}
                restrictOthers // 👈 oculta conversaciones asignadas a otros
              />
            </aside>

            {/* Columna del chat: dejamos que el ChatWindow maneje su scroll interno */}
            <main className="flex min-h-0 col-span-8">
              {currentConvId ? (
                <ChatWindow conversationId={currentConvId} />
              ) : (
                <div className="flex items-center justify-center flex-1 h-full text-gray-500">
                  Elegí una conversación o creá una nueva.
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      {/* ——————————————————————————————————————————
          MODAL / OVERLAY Remarketing (z-index alto)
          Cubre toda la pantalla y evita mezclarse con el chat
          —————————————————————————————————————————— */}
      {showRemarketing && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowRemarketing(false)}
          />
          {/* Contenedor */}
          <div className="relative z-[10000] w-[95vw] max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-xl border overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b">
              <h2 className="text-lg font-semibold">Remarketing por plantillas</h2>
              <button
                className="px-3 py-1 text-sm border rounded"
                onClick={() => setShowRemarketing(false)}
                title="Cerrar (Esc)"
              >
                Cerrar
              </button>
            </div>
            <div className="p-2 overflow-auto">
              <RemarketingBulk />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
