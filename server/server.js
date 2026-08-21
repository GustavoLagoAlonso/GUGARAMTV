"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");

const authRoutes = require("./routes/auth");
const playlistRoutes = require("./routes/playlist");
const favoritesRoutes = require("./routes/favorites");
const requireAuth = require("./middleware/requireAuth");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

if (!process.env.SESSION_SECRET) {
  console.warn(
    "[AVISO] SESSION_SECRET não definido no .env — usando um valor temporário " +
      "apenas para desenvolvimento. Defina SESSION_SECRET antes de usar em produção."
  );
}

app.use(express.json());
app.use(
  session({
    name: "gugaramtv.sid",
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // exige HTTPS em produção
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

// ---- API (a URL da playlist nunca trafega por aqui) ----
app.use("/api/auth", authRoutes);
app.use("/api/playlist", playlistRoutes);
app.use("/api/favorites", favoritesRoutes);

// Pequeno endpoint auxiliar só para expor o e-mail de suporte ao frontend
app.get("/api/config", (req, res) => {
  res.json({ supportEmail: process.env.SUPPORT_EMAIL || "gugaram@gmail.com" });
});

// ---- Frontend estático ----
// index:false evita que o Express sirva public/index.html
// automaticamente em "/" sem passar pela checagem de sessão abaixo.
const PUBLIC_DIR = path.join(__dirname, "..", "public");
app.use(express.static(PUBLIC_DIR, { index: false }));

// Protege o player: sem sessão válida, sempre volta para o login.
app.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  }
  res.redirect("/login.html");
});
app.get("/app", requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND" });
});

// Handler de erro genérico — nunca vaza stack trace/URL para o cliente
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  res.status(500).json({ error: "SERVER_ERROR", message: "Ocorreu um erro inesperado." });
});

app.listen(PORT, () => {
  console.log(`GUGARAM TV Free rodando em http://localhost:${PORT}`);
});
