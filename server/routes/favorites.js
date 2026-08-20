"use strict";

const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const store = require("../lib/store");

const router = express.Router();

// GET /api/favorites
router.get("/", requireAuth, (req, res) => {
  res.json({ favorites: store.getFavorites(req.session.userId) });
});

// POST /api/favorites/toggle  { channelId }
router.post("/toggle", requireAuth, (req, res) => {
  const { channelId } = req.body || {};
  if (!channelId) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "channelId é obrigatório." });
  }

  const current = store.getFavorites(req.session.userId);
  const idx = current.indexOf(channelId);
  if (idx === -1) current.push(channelId);
  else current.splice(idx, 1);

  store.setFavorites(req.session.userId, current);
  res.json({ favorites: current });
});

// DELETE /api/favorites — limpa todos os favoritos do usuário
router.delete("/", requireAuth, (req, res) => {
  store.setFavorites(req.session.userId, []);
  res.json({ favorites: [] });
});

module.exports = router;
