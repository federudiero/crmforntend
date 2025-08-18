import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setErr(e.message || "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-6">
      <form onSubmit={submit} className="w-full max-w-sm p-6 space-y-4 border shadow-sm rounded-xl">
        <div>
          <h1 className="text-2xl font-bold">Ingresá</h1>
          <p className="text-sm text-gray-500">Con tu usuario de Firebase</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <input type="email" className="w-full p-2 border rounded-lg" placeholder="tu@email.com"
                 autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Contraseña</label>
          <div className="flex gap-2">
            <input type={show ? "text" : "password"} className="w-full p-2 border rounded-lg" placeholder="••••••••"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow(s => !s)} className="px-3 border rounded-lg">
              {show ? "🙈" : "👁️"}
            </button>
          </div>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <button type="submit" disabled={loading} className="w-full py-2 text-white bg-black rounded-lg">
          {loading ? "Ingresando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
