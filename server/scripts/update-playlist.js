// ============================================================
// update-playlist.js
//
// Baixa a playlist de origem, testa CADA canal (requisição real
// ao servidor de streaming, com timeout) e regrava
// server/data/playlist.m3u apenas com os canais que responderam.
//
// Rode isso no SEU computador (precisa de acesso de rede normal
// à internet, não dentro de um ambiente restrito). Para 8.000+
// canais, pode levar de alguns minutos a meia hora, dependendo da
// sua conexão e de quantos canais estão fora do ar (timeouts
// demoram mais que sucessos).
//
// Uso:
//   node server/scripts/update-playlist.js
//   node server/scripts/update-playlist.js --source <url> --concurrency 60 --timeout 8000
//
// Depois de rodar, revise o diff de server/data/playlist.m3u e
// faça commit + push normalmente.
// ============================================================
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parseM3U, serializeM3U } = require("../lib/m3uParser");

const DEFAULT_SOURCE = "https://iptv-org.github.io/iptv/index.m3u";
const DEFAULT_OUTPUT = path.join(__dirname, "..", "data", "playlist.m3u");
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_TIMEOUT_MS = 8000;

// A lista geral não marca de forma confiável canais com conteúdo
// brasileiro hospedados fora do Brasil (ex.: feeds da Pluto TV, "XYZ
// Latin America Brazil"). A iptv-org mantém listas oficiais por país
// que já resolvem isso corretamente — usamos como fonte de verdade
// para o campo tvg-country que nós mesmos gravamos no arquivo final.
const COUNTRY_LISTS = {
  BR: "https://iptv-org.github.io/iptv/countries/br.m3u",
};

function parseArgs(argv) {
  const args = { source: null, output: DEFAULT_OUTPUT, concurrency: DEFAULT_CONCURRENCY, timeout: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") args.source = argv[++i];
    else if (a === "--output") args.output = path.resolve(argv[++i]);
    else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
    else if (a === "--timeout") args.timeout = parseInt(argv[++i], 10);
  }
  args.source = args.source || process.env.IPTV_PLAYLIST_URL || DEFAULT_SOURCE;
  return args;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha HTTP " + res.status + " ao buscar " + url);
  return res.text();
}

/**
 * Baixa cada lista oficial por país configurada em COUNTRY_LISTS e monta
 * um mapa id do canal -> código do país (ex.: "BobEsponjaCalcaQuadrada.us@BR" -> "BR").
 * Se alguma lista falhar ao baixar, avisa e segue sem ela (não é crítico).
 */
async function buildCountryMap() {
  const map = {};
  for (const [code, url] of Object.entries(COUNTRY_LISTS)) {
    try {
      const text = await fetchText(url);
      const channels = parseM3U(text);
      channels.forEach((c) => {
        map[c.id] = code;
      });
      console.log("País " + code + ": " + channels.length + " canais na lista oficial da iptv-org.");
    } catch (e) {
      console.warn("Aviso: não foi possível baixar a lista oficial de " + code + " (" + e.message + "). Seguindo sem ela.");
    }
  }
  return map;
}

/**
 * Verifica se um canal responde. Tenta HEAD primeiro (mais leve);
 * se o servidor não suportar (405/501) ou recusar, tenta GET com
 * Range pequeno, sem baixar o stream inteiro.
 */
async function isChannelAlive(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-2048" },
        signal: controller.signal,
        redirect: "follow",
      });
    }
    return res.status >= 200 && res.status < 400;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa `worker` sobre `items` com no máximo `concurrency` chamadas
 * simultâneas. Sem dependências externas.
 */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await worker(items[i], i);
      completed++;
      if (completed % 200 === 0 || completed === items.length) {
        process.stdout.write("\r  verificado " + completed + "/" + items.length + " canais...");
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(workers);
  process.stdout.write("\n");
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log("Fonte:      " + args.source);
  console.log("Saída:      " + args.output);
  console.log("Concorrência: " + args.concurrency + " | Timeout: " + args.timeout + "ms");
  console.log("");

  console.log("Baixando playlist de origem...");
  const text = await fetchText(args.source);

  console.log("Processando M3U...");
  const channels = parseM3U(text);
  console.log("Total de canais na origem: " + channels.length);
  console.log("");

  console.log("Baixando listas oficiais por país (para marcar corretamente canais como brasileiros, etc.)...");
  const countryMap = await buildCountryMap();
  let taggedCount = 0;
  channels.forEach((c) => {
    if (countryMap[c.id]) {
      c.country = countryMap[c.id];
      taggedCount++;
    }
  });
  console.log("Canais marcados por país: " + taggedCount);
  console.log("");

  console.log("Testando disponibilidade de cada canal (isso pode demorar)...");
  const aliveFlags = await runPool(channels, args.concurrency, (c) => isChannelAlive(c.url, args.timeout));

  const alive = channels.filter((c, i) => aliveFlags[i]);
  const offlineCount = channels.length - alive.length;

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, serializeM3U(alive), "utf8");

  const categoriesBefore = new Set(channels.map((c) => c.group)).size;
  const categoriesAfter = new Set(alive.map((c) => c.group)).size;
  const brAliveCount = alive.filter((c) => c.country === "BR").length;
  const durationSec = Math.round((Date.now() - startedAt) / 1000);

  console.log("");
  console.log("✓ Playlist atualizada em " + args.output);
  console.log("  Canais online:  " + alive.length);
  console.log("  Canais removidos (fora do ar): " + offlineCount);
  console.log("  Canais brasileiros online: " + brAliveCount);
  console.log("  Categorias: " + categoriesBefore + " → " + categoriesAfter);
  console.log("  Tempo total: " + durationSec + "s");
  console.log("");
  console.log("Próximo passo: revise o diff e faça commit + push:");
  console.log("  git add server/data/playlist.m3u");
  console.log('  git commit -m "chore: atualizar playlist de canais"');
  console.log("  git push");
}

main().catch((e) => {
  console.error("Falha ao atualizar a playlist:", e.message || e);
  process.exit(1);
});
