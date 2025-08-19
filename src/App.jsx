import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import Home from "./pages/Home.jsx";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/home/:convId?" element={<Home />} />
        </Route>
      </Routes>
    </Router>
  );
}