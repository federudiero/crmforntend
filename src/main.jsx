// src/main.jsx o src/index.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import Home from "../src/pages/home.jsx"; // ← este es el nuevo componente unificado

const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> }, // LoginPage te lleva a /home
  {
    element: <RequireAuth />,             // Protege rutas privadas
    children: [
      { path: "/home", element: <Home /> },             // sin conversación abierta
      { path: "/home/:convId", element: <Home /> },     // con conversación abierta
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);