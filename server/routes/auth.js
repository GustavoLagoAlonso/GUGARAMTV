"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const store = require("../lib/store");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Informe e-mail e senha." });
    }

    const user = store.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." });
    }

    req.session.userId = user.id;
    res.json({ authenticated: true, email: user.email });
  } catch (e) {
    console.error("Erro no login:", e); // detalhes só no log do servidor
    res.status(500).json({ error: "SERVER_ERROR", message: "Não foi possível autenticar agora. Tente novamente mais tarde." });
  }
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ authenticated: false });
  });
});

// GET /api/auth/session — usado pelo frontend para saber se já está logado
router.get("/session", (req, res) => {
  if (req.session && req.session.userId) {
    const user = store.findUserById(req.session.userId);
    return res.json({ authenticated: true, email: user ? user.email : null });
  }
  res.json({ authenticated: false });
});

// POST /api/auth/change-password
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "Preencha a senha atual e a nova senha." });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: "WEAK_PASSWORD", message: "A nova senha deve ter ao menos 8 caracteres." });
    }

    const user = store.findUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "NOT_AUTHENTICATED" });

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Senha atual incorreta." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    store.updateUserPassword(user.id, newHash);
    res.json({ success: true });
  } catch (e) {
    console.error("Erro ao trocar senha:", e);
    res.status(500).json({ error: "SERVER_ERROR", message: "Não foi possível trocar a senha agora." });
  }
});

module.exports = router;
