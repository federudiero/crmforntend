import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
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
  const [currentConvMeta, setCurrentConvMeta] = useState(null);
  const [assignLoading, setAssignLoading] = useState(false);

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

  // Suscripción a la conversación actual para verificar permisos
  useEffect(() => {
    if (!decoded) {
      setCurrentConvMeta(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, "conversations", decoded),
      (docSnap) => {
        if (docSnap.exists()) {
          setCurrentConvMeta({ id: docSnap.id, ...docSnap.data() });
        } else {
          setCurrentConvMeta(null);
        }
      },
      (error) => {
        console.error("Error al suscribirse a conversación:", error);
        setCurrentConvMeta(null);
      }
    );

    return unsubscribe;
  }, [decoded]);

  const adminEmails = useMemo(() => ["fede_rudiero@gmail.com"], []);
  const isAdmin = !!user?.email && adminEmails.includes(user.email);

  // Verificar si el usuario puede acceder a la conversación
  const canAccess = useMemo(() => {
    if (!user || !currentConvMeta) return false;
    if (isAdmin) return true; // Admin puede acceder a todo
    if (currentConvMeta.assignedToUid === user.uid) return true; // Usuario asignado puede acceder
    return false;
  }, [user, currentConvMeta, isAdmin]);

  // Función para asignarse la conversación
  const handleAssignToMe = async () => {
    if (!decoded || !user) return;

    setAssignLoading(true);
    try {
      await updateDoc(doc(db, "conversations", decoded), {
        assignedToUid: user.uid,
        assignedToEmail: user.email,
        assignedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error al asignarse la conversación:", error);
    } finally {
      setAssignLoading(false);
    }
  };

  // Renderizar panel de asignación cuando no hay acceso
  const renderAssignPanel = () => (
    <div className="flex flex-1 justify-center items-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="p-6 w-full max-w-md bg-white rounded-lg border border-gray-200 shadow-lg dark:bg-gray-800 dark:border-gray-700">
        <div className="text-center">
          <div className="flex justify-center items-center mx-auto mb-4 w-16 h-16 bg-yellow-100 rounded-full dark:bg-yellow-900/20">
            <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            Chat no asignado
          </h3>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            Este chat no está asignado a vos. Para poder ver los mensajes y responder, necesitás asignártelo.
          </p>
          <button
            onClick={handleAssignToMe}
            disabled={assignLoading}
            className="px-4 py-2 w-full font-medium text-white bg-blue-600 rounded-lg transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
          >
            {assignLoading ? "Asignando..." : "Asignarme este chat"}
          </button>
        </div>
      </div>
    </div>
  );

  const openConv = (id) => {
    navigate(`/home/${encodeURIComponent(id)}`);
    setMobileView("chat"); // En móviles, al abrir una conv saltamos al chat
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

        <div className="flex gap-2 items-center">
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
            className="hidden px-3 py-1 text-sm rounded border md:inline-flex"
            onClick={() => setShowRemarketing(true)}
            title="Abrir Remarketing por plantillas"
          >
            Remarketing
          </button>

          {/* Botones para vendedores (usuarios no-admin) */}
          {!isAdmin && <NewConversation onOpen={openConv} />}

          <button
            className="px-2 py-1 text-sm rounded border"
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
            <div className="hidden grid-cols-12 h-full md:grid">
              <aside className="overflow-y-auto col-span-4 h-full min-h-0 border-r">
                <ConversationsList
                  activeId={currentConvId || ""}
                  onSelect={openConv}
                  restrictOthers
                />
              </aside>

              {/* 👇 cambios: ocupar todo el ancho del slot y ocultar overflow-x */}
              <main className="flex overflow-x-hidden col-span-8 w-full h-full min-h-0">
                {currentConvId ? (
                  canAccess ? (
                    <ChatWindow
                      key={currentConvId}
                      conversationId={currentConvId}
                      convMeta={currentConvMeta}
                    />
                  ) : (
                    renderAssignPanel()
                  )
                ) : (
                  <div className="flex flex-1 justify-center items-center text-gray-500">
                    Elegí una conversación o creá una nueva.
                  </div>
                )}
              </main>
            </div>

            {/* Mobile ≤ md: panel único conmutado */}
            <div className="h-full md:hidden">
              {mobileView === "list" && (
                <div className="overflow-hidden h-full min-h-0">
                  <ConversationsList
                    activeId={currentConvId || ""}
                    onSelect={openConv}
                    restrictOthers
                  />
                </div>
              )}
              {mobileView === "chat" && (
                // 👇 cambios: ancho completo + ocultar overflow-x
                <div className="overflow-x-hidden w-full h-full min-h-0">
                  {currentConvId ? (
                    canAccess ? (
                      <ChatWindow
                        key={currentConvId}
                        conversationId={currentConvId}
                        convMeta={currentConvMeta}
                        onBack={() => setMobileView("list")}
                        mobile
                      />
                    ) : (
                      renderAssignPanel()
                    )
                  ) : (
                    <div className="flex justify-center items-center p-4 h-full text-center text-gray-500">
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
            <div className="flex justify-between items-center p-3 border-b">
              <h2 className="text-lg font-semibold">Remarketing por plantillas</h2>
              <button
                className="px-3 py-1 text-sm rounded border"
                onClick={() => setShowRemarketing(false)}
                title="Cerrar (Esc)"
              >
                Cerrar
              </button>
            </div>
            <div className="overflow-auto p-2">
              <RemarketingBulk />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
