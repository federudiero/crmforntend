import { useEffect, useState } from "react";
import { auth } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import ConversationsList from "./components/ConversationsList.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import NewConversation from "./components/NewConversation.jsx";
import Login from "./components/Login.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [activeConvId, setActiveConvId] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  if (!user) return <Login />;

  return (
    <div className="grid h-full grid-cols-12">
      <aside className="col-span-4 border-r">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-xl font-semibold">CRM WhatsApp</h2>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <NewConversation onOpen={(convId) => setActiveConvId(convId)} />
            <button
              className="px-2 py-1 text-sm border rounded"
              onClick={() => signOut(auth)}
              title="Cerrar sesión"
            >
              Salir
            </button>
          </div>
        </div>
        <ConversationsList activeId={activeConvId} onSelect={setActiveConvId} />
      </aside>

      <main className="col-span-8">
        {activeConvId ? (
          <ChatWindow conversationId={activeConvId} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Elegí una conversación o creá una nueva.
          </div>
        )}
      </main>
    </div>
  );
}
