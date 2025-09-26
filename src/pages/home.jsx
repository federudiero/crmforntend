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

  // Vista móvil: "list" | "chat"
  const decoded = convId ? decodeURIComponent(convId) : null;
  const [mobileView, setMobileView] = useState(decoded ? "chat" : "list");

  useEffect(() => {
    // si usás daisyUI theme
    document.documentElement.setAttribute("data-theme", "crm");
  }, []);

  // Si cambia la URL (abrís una conversación), en mobile pasamos a "chat"
  useEffect(() => {
    if (decoded) setMobileView("chat");
  }, [decoded]);

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

  const openConv = (id) => {
    navigate(`/home/${encodeURIComponent(id)}`);
    // En móviles, al abrir una conv saltamos al chat
    setMobileView("chat");
  };

  const currentConvId = decoded;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-[#E8F5E9] border-[#CDEBD6] p-3 md:p-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate md:text-xl">CRM WhatsApp</h1>
          <p className="text-xs text-gray-500 truncate">
            {user?.email} {isAdmin ? "(admin)" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile: switch Lista/Chat */}
          {!isAdmin && (
            <div className="join md:hidden">
              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "list"
                    ? "btn-success text-white"
                    : "bg-white text-black border-[#CDEBD6]")
                }
                onClick={() => setMobileView("list")}
                title="Ver lista"
              >
                Lista
              </button>
              <button
                className={
                  "join-item btn btn-xs " +
                  (mobileView === "chat"
                    ? "btn-success text-white"
                    : "bg-white text-black border-[#CDEBD6]")
                }
                onClick={() => setMobileView("chat")}
                title="Ver chat"
              >
                Chat
              </button>
            </div>
          )}

          {/* Botón Remarketing disponible para todos */}
          <button
            className="hidden px-3 py-1 text-sm border rounded md:inline-flex"
            onClick={() => setShowRemarketing(true)}
            title="Abrir Remarketing por plantillas"
          >
            Remarketing
          </button>

          {/* Botones para vendedores (usuarios no-admin) */}
          {!isAdmin && <NewConversation onOpen={openConv} />}

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
          <>
            {/* Desktop ≥ md: layout 4/8 clásico */}
            <div className="hidden h-full grid-cols-12 md:grid">
              <aside className="h-full min-h-0 col-span-4 overflow-y-auto border-r">
                <ConversationsList
                  activeId={currentConvId || ""}
                  onSelect={openConv}
                  restrictOthers
                />
              </aside>

              <main className="flex min-h-0 col-span-8">
                {currentConvId ? (
                  <ChatWindow
                    conversationId={currentConvId}
                  />
                ) : (
                  <div className="flex items-center justify-center flex-1 text-gray-500">
                    Elegí una conversación o creá una nueva.
                  </div>
                )}
              </main>
            </div>

            {/* Mobile ≤ md: panel único conmutado */}
            <div className="h-full md:hidden">
              {mobileView === "list" && (
                <div className="h-full min-h-0 overflow-hidden">
                  <ConversationsList
                    activeId={currentConvId || ""}
                    onSelect={openConv}
                    restrictOthers
                  />
                </div>
              )}
              {mobileView === "chat" && (
                <div className="h-full min-h-0">
                  {currentConvId ? (
                    <ChatWindow
                      conversationId={currentConvId}
                      onBack={() => setMobileView("list")}
                      mobile
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full p-4 text-center text-gray-500">
                      Abrí una conversación desde <b className="mx-1">Lista</b>.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Overlay Remarketing */}
      {showRemarketing && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowRemarketing(false)}
          />
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
