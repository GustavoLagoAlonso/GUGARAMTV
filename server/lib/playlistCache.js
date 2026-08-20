// ============================================================
// playlistCache.js
// Único módulo que efetivamente lê process.env.IPTV_PLAYLIST_URL
// e faz a requisição à origem da playlist. O resultado processado
// fica em cache em memória por IPTV_PLAYLIST_CACHE_TTL segundos,
// evitando que cada usuário autenticado dispare uma nova
// requisição à origem.
//
// Nada aqui é exportado para fora do processo do backend: as
// rotas consomem apenas getPlaylist(), que devolve canais, nunca
// a URL de origem.
// ============================================================
"use strict";

const { parseM3U } = require("./m3uParser");

let cache = { data: null, expiresAt: 0 };

function getTtlMs() {
  const ttlSeconds = parseInt(process.env.IPTV_PLAYLIST_CACHE_TTL || "300", 10);
  return (isNaN(ttlSeconds) ? 300 : ttlSeconds) * 1000;
}

async function fetchAndParse() {
  const url = process.env.IPTV_PLAYLIST_URL;
  if (!url) {
    const err = new Error("IPTV_PLAYLIST_URL não configurada no backend.");
    err.code = "NOT_CONFIGURED";
    throw err;
  }

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error("Falha HTTP ao buscar playlist de origem: " + res.status);
    err.code = "UPSTREAM_ERROR";
    throw err;
  }
  const text = await res.text();
  const channels = parseM3U(text); // pode lançar INVALID_FORMAT
  return channels;
}

/**
 * Retorna a lista de canais processada, usando cache quando válido.
 * @param {boolean} forceRefresh ignora o cache e busca novamente na origem
 */
async function getPlaylist(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.data && cache.expiresAt > now) {
    return { channels: cache.data, fromCache: true };
  }
  const channels = await fetchAndParse();
  cache = { data: channels, expiresAt: now + getTtlMs() };
  return { channels, fromCache: false };
}

module.exports = { getPlaylist };
