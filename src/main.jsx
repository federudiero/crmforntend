// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import Home from "./pages/Home.jsx"; // usa misma mayúscula que App.jsx

// Asegura el tema DaisyUI (ya tienes los colores en index.css)
document.documentElement.setAttribute("data-theme", "crm");

const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      // una sola ruta que matchea /home y /home/:convId
      { path: "/home/:convId?", element: <Home /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
