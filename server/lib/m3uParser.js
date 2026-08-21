// ============================================================
// m3uParser.js
// Parser M3U server-side. Roda no backend, nunca no navegador,
// pois é aqui que a URL de origem da playlist é conhecida.
// ============================================================
"use strict";

const crypto = require("crypto");

function simpleHash(str) {
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 12);
}

/**
 * @param {string} text conteúdo bruto do arquivo M3U
 * @returns {Array} lista de canais normalizados
 */
function parseM3U(text) {
  if (!text || text.indexOf("#EXTM3U") === -1) {
    const err = new Error("INVALID_FORMAT");
    err.code = "INVALID_FORMAT";
    throw err;
  }

  const lines = text.split(/\r?\n/);
  const channels = [];
  const seen = new Set();
  let pending = null;
  let originalIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const info = line.substring(line.indexOf(":") + 1);
      const commaIdx = info.lastIndexOf(",");
      const attrsPart = commaIdx >= 0 ? info.substring(0, commaIdx) : info;
      const namePart = commaIdx >= 0 ? info.substring(commaIdx + 1).trim() : "";

      const attrs = {};
      const attrRegex = /([a-zA-Z0-9\-]+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(attrsPart)) !== null) {
        attrs[m[1].toLowerCase()] = m[2];
      }

      pending = {
        tvgId: attrs["tvg-id"] || "",
        tvgName: attrs["tvg-name"] || "",
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || "Sem categoria",
        name: (namePart || attrs["tvg-name"] || "Canal sem nome").trim(),
      };
    } else if (line.startsWith("#")) {
      continue; // outras diretivas ignoradas com segurança
    } else {
      const url = line;
      if (!pending) {
        pending = {
          tvgId: "",
          tvgName: "",
          logo: "",
          group: "Sem categoria",
          name: "Canal " + (originalIndex + 1),
        };
      }
      if (!/^https?:\/\//i.test(url)) {
        pending = null;
        continue;
      }
      const id = pending.tvgId || simpleHash(pending.name + "|" + url);
      const dedupeKey = id + "|" + url;
      if (seen.has(dedupeKey)) {
        pending = null;
        continue;
      }
      seen.add(dedupeKey);

      channels.push({
        id,
        name: pending.name,
        tvgId: pending.tvgId,
        logo: pending.logo,
        group: pending.group,
        url,
        originalIndex: originalIndex++,
      });
      pending = null;
    }
  }

  return channels;
}

/**
 * Serializa uma lista de canais normalizados de volta para texto M3U,
 * preservando tvg-id/tvg-name/tvg-logo/group-title quando existirem.
 * @param {Array} channels
 * @returns {string}
 */
function serializeM3U(channels) {
  const lines = ["#EXTM3U"];
  channels.forEach((c) => {
    const attrs = [];
    if (c.tvgId) attrs.push('tvg-id="' + c.tvgId.replace(/"/g, "'") + '"');
    if (c.tvgName) attrs.push('tvg-name="' + c.tvgName.replace(/"/g, "'") + '"');
    if (c.logo) attrs.push('tvg-logo="' + c.logo.replace(/"/g, "'") + '"');
    if (c.group) attrs.push('group-title="' + c.group.replace(/"/g, "'") + '"');
    const attrsStr = attrs.length ? " " + attrs.join(" ") : "";
    lines.push("#EXTINF:-1" + attrsStr + "," + c.name);
    lines.push(c.url);
  });
  return lines.join("\n") + "\n";
}

module.exports = { parseM3U, serializeM3U };
