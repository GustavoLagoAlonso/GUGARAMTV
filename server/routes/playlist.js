"use strict";

const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { getPlaylist } = require("../lib/playlistCache");

const router = express.Router();

// A convenção do iptv-org codifica o país no próprio tvg-id, no formato
// "NomeDoCanal.xx@qualidade" (ex.: "Band.br@SD"). Extraímos só o código
// de duas letras — nunca expomos o tvg-id completo na resposta.
function extractCountryCode(tvgId) {
  if (!tvgId) return null;
  const m = /\.([a-z]{2})@/i.exec(tvgId);
  return m ? m[1].toUpperCase() : null;
}

async function handlePlaylistRequest(req, res, forceRefresh) {
  try {
    const { channels } = await getPlaylist(forceRefresh);

    // Monta a resposta explicitamente: nunca repassar campos não
    // previstos aqui (garante que IPTV_PLAYLIST_URL jamais vaze
    // mesmo que algum dia seja acidentalmente anexada a um objeto).
    const safeChannels = channels.map((c) => ({
      id: c.id,
      name: c.name,
      logo: c.logo,
      group: c.group,
      country: extractCountryCode(c.tvgId),
      url: c.url, // URL do stream individual — ver README sobre este trade-off
    }));

    const categories = Array.from(new Set(safeChannels.map((c) => c.group))).sort((a, b) =>
      a.localeCompare(b)
    );

    res.json({ channels: safeChannels, categories });
  } catch (e) {
    console.error("Erro ao obter playlist:", e); // detalhes técnicos só no log
    res.status(502).json({
      error: "PLAYLIST_UNAVAILABLE",
      message: "Não foi possível carregar os canais. Tente novamente mais tarde.",
    });
  }
}

// GET /api/playlist — exige sessão autenticada
router.get("/", requireAuth, (req, res) => handlePlaylistRequest(req, res, false));

// GET /api/playlist/refresh — relê server/data/playlist.m3u do disco, ignorando o cache em memória
router.get("/refresh", requireAuth, (req, res) => handlePlaylistRequest(req, res, true));

module.exports = router;
