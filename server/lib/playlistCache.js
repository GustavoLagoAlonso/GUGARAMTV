// ============================================================
// playlistCache.js
//
// A playlist agora é um arquivo VERSIONADO NO GIT
// (server/data/playlist.m3u), atualizado periodicamente por
// server/scripts/update-playlist.js — não é mais buscada ao vivo
// a cada requisição. Isso significa:
//   - o servidor em produção não depende mais de acesso de rede
//     externo para servir os canais;
//   - "atualizar a lista" = rodar o script localmente, revisar o
//     resultado, e dar commit + push (o Render redesploya com o
//     arquivo novo).
//
// O resultado processado ainda fica em cache em memória por
// IPTV_PLAYLIST_CACHE_TTL segundos, para não reprocessar o M3U a
// cada requisição.
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const { parseM3U } = require("./m3uParser");

const PLAYLIST_PATH = path.join(__dirname, "..", "data", "playlist.m3u");

let cache = { data: null, expiresAt: 0 };

function getTtlMs() {
  const ttlSeconds = parseInt(process.env.IPTV_PLAYLIST_CACHE_TTL || "300", 10);
  return (isNaN(ttlSeconds) ? 300 : ttlSeconds) * 1000;
}

function readAndParse() {
  let text;
  try {
    text = fs.readFileSync(PLAYLIST_PATH, "utf8");
  } catch (e) {
    const err = new Error("Arquivo de playlist não encontrado: " + PLAYLIST_PATH);
    err.code = "NOT_CONFIGURED";
    throw err;
  }
  return parseM3U(text); // pode lançar INVALID_FORMAT
}

/**
 * Retorna a lista de canais processada, usando cache quando válido.
 * @param {boolean} forceRefresh ignora o cache e relê o arquivo do disco
 */
async function getPlaylist(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache.data && cache.expiresAt > now) {
    return { channels: cache.data, fromCache: true };
  }
  const channels = readAndParse();
  cache = { data: channels, expiresAt: now + getTtlMs() };
  return { channels, fromCache: false };
}

module.exports = { getPlaylist, PLAYLIST_PATH };
