// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import Home from "./pages/home.jsx";

const THEME_KEY = "crm_theme";
const DEFAULT_THEME = "crm-dark";

function applyTheme(theme) {
  const t = theme || DEFAULT_THEME;
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t.includes("dark") ? "dark" : "light";
}

applyTheme(localStorage.getItem(THEME_KEY));

const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [{ path: "/home/:convId?", element: <Home /> }],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
