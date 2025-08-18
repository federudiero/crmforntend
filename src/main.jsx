import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import LoginPage from "./pages/LoginPage.jsx";
import AppLayout from "./pages/AppLayout.jsx";
import RequireAuth from "./components/RequireAuth.jsx";

const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> },                 // Home = Login
  {
    element: <RequireAuth />,                            // Guard de auth
    children: [
      { path: "/app", element: <AppLayout /> },          // Lista + placeholder
      { path: "/app/:convId", element: <AppLayout /> },  // Chat abierto
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);