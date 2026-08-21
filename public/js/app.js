(function(){
"use strict";

/* ============================================================
   1. LOCAL PREFERENCES (não sensíveis — nenhuma URL aqui)
   ============================================================ */
const PREF_KEYS = {
  lastChannel: "gugaramtv_last_channel",
  selectedCategory: "gugaramtv_selected_category",
  sortMode: "gugaramtv_sort_mode",
  settings: "gugaramtv_settings",
  subtitleLang: "gugaramtv_subtitle_lang"
};
function prefGet(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  }catch(e){ return fallback; }
}
function prefSet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ console.error(e); }
}

const DEFAULT_SETTINGS = { autoplay:true, resume:true, showLogos:true, showCategories:true };

/* ============================================================
   2. STATE
   ============================================================ */
const state = {
  channels: [],
  categories: [],
  favorites: [],                 // vem do backend, vinculado ao usuário logado
  currentChannel: null,
  currentTab: "all",
  currentCategory: prefGet(PREF_KEYS.selectedCategory, "TODOS"),
  searchTerm: "",
  sortMode: prefGet(PREF_KEYS.sortMode, "original"),
  settings: Object.assign({}, DEFAULT_SETTINGS, prefGet(PREF_KEYS.settings, {})),
  subtitles: { available: [], activeIndex: -1, preferredLang: prefGet(PREF_KEYS.subtitleLang, null) }
};

/* ============================================================
   3. API HELPERS (única fonte de dados — nunca há URL de playlist aqui)
   ============================================================ */
function api(path, options){
  return fetch(path, Object.assign({ credentials: "same-origin" }, options || {}))
    .then(function(res){
      return res.json().catch(function(){ return {}; }).then(function(data){
        return { ok: res.status, data: data, status: res.status };
      });
    });
}

/* ============================================================
   4. FAVORITES
   ============================================================ */
function isFavorite(id){ return state.favorites.indexOf(id) !== -1; }

function toggleFavorite(id){
  // atualização otimista na UI, confirmada pelo backend
  const idx = state.favorites.indexOf(id);
  if(idx === -1) state.favorites.push(id); else state.favorites.splice(idx,1);
  renderChannelList(); renderStats();
  if(state.currentChannel && state.currentChannel.id === id) renderNowPlaying();

  api("/api/favorites/toggle", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ channelId: id })
  }).then(function(res){
    if(res.status === 401) return handleSessionExpired();
    if(Array.isArray(res.data.favorites)){
      state.favorites = res.data.favorites;
      renderChannelList(); renderStats();
      if(state.currentChannel && state.currentChannel.id === id) renderNowPlaying();
    }
  }).catch(function(){ showToast("Não foi possível salvar o favorito agora."); });
}

/* ============================================================
   5. PLAYER
   ============================================================ */
let hls = null;
const videoEl = document.getElementById("video");
const overlayEl = document.getElementById("playerOverlay");

function stopPlayback(){
  if(hls){ try{ hls.destroy(); }catch(e){} hls = null; }
  try{ videoEl.pause(); videoEl.removeAttribute("src"); videoEl.load(); }catch(e){}
}

function playChannel(channel){
  stopPlayback();
  overlayEl.style.display = "flex";
  overlayEl.innerHTML = '<div class="glyph">◌</div><div>Carregando ' + escapeHtml(channel.name) + '...</div>';

  const url = channel.url;
  const useNative = videoEl.canPlayType("application/vnd.apple.mpegurl");

  function onReady(){
    overlayEl.style.display = "none";
    document.getElementById("nowPlaying").classList.add("playing");
    if(state.settings.autoplay){
      videoEl.play().catch(function(){ /* autoplay bloqueado — usuário inicia manualmente */ });
    }
  }
  function onFail(){
    overlayEl.style.display = "flex";
    overlayEl.innerHTML = '<div class="glyph">⚠</div><div>Não foi possível reproduzir este canal.<br>A transmissão pode estar offline ou indisponível.</div>';
    document.getElementById("nowPlaying").classList.remove("playing");
  }

  if(/\.m3u8($|\?)/i.test(url) && !useNative && window.Hls && window.Hls.isSupported()){
    hls = new Hls({ maxBufferLength: 30 });
    hls.loadSource(url);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, onReady);
    hls.on(Hls.Events.ERROR, function(evt, data){ if(data && data.fatal) onFail(); });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function(){ refreshSubtitleTracks(); });
  } else {
    videoEl.src = url;
    videoEl.addEventListener("loadedmetadata", onReady, { once:true });
    videoEl.addEventListener("error", onFail, { once:true });
    videoEl.addEventListener("loadedmetadata", function(){ refreshSubtitleTracks(); }, { once:true });
    videoEl.load();
  }

  state.currentChannel = channel;
  state.subtitles = { available: [], activeIndex: -1, preferredLang: state.subtitles.preferredLang };
  renderSubtitleUI();
  prefSet(PREF_KEYS.lastChannel, channel.id);
  renderNowPlaying();
  renderChannelList();
  document.getElementById("statCurrent").textContent = truncate(channel.name, 14);
}

/* ============================================================
   5b. LEGENDAS (faixas nativas do stream, quando existirem)
   ============================================================ */
function refreshSubtitleTracks(){
  let tracks = [];

  if(hls && hls.subtitleTracks && hls.subtitleTracks.length){
    tracks = hls.subtitleTracks.map(function(t, i){
      return { index: i, label: t.name || t.lang || ("Faixa " + (i+1)), lang: t.lang || "" };
    });
  } else if(videoEl.textTracks && videoEl.textTracks.length){
    Array.prototype.forEach.call(videoEl.textTracks, function(t, i){
      if(t.kind === "subtitles" || t.kind === "captions"){
        t.mode = "disabled"; // controlamos manualmente, sem exibir por padrão
        tracks.push({ index: i, label: t.label || t.language || ("Faixa " + (i+1)), lang: t.language || "" });
      }
    });
  }

  state.subtitles.available = tracks;

  // tenta reaplicar o idioma preferido do usuário neste novo canal
  let autoIndex = -1;
  if(state.subtitles.preferredLang && tracks.length){
    const match = tracks.find(function(t){ return t.lang === state.subtitles.preferredLang; });
    if(match) autoIndex = match.index;
  }
  setSubtitleTrack(autoIndex, { persist:false });
  renderSubtitleUI();
}

function setSubtitleTrack(index, opts){
  opts = opts || {};
  if(hls && hls.subtitleTracks && hls.subtitleTracks.length){
    hls.subtitleTrack = index; // -1 desliga
  } else if(videoEl.textTracks && videoEl.textTracks.length){
    Array.prototype.forEach.call(videoEl.textTracks, function(t, i){
      if(t.kind === "subtitles" || t.kind === "captions"){
        t.mode = (i === index) ? "showing" : "disabled";
      }
    });
  }

  state.subtitles.activeIndex = index;
  if(opts.persist !== false){
    const chosen = state.subtitles.available.find(function(t){ return t.index === index; });
    state.subtitles.preferredLang = chosen ? chosen.lang : null;
    prefSet(PREF_KEYS.subtitleLang, state.subtitles.preferredLang);
  }
  renderSubtitleUI();
}

function renderSubtitleUI(){
  const btn = document.getElementById("ccBtn");
  const menu = document.getElementById("ccMenu");
  const tracks = state.subtitles.available;

  if(!tracks.length){
    btn.style.display = "none";
    menu.classList.remove("open");
    return;
  }

  btn.style.display = "inline-block";
  btn.classList.toggle("active", state.subtitles.activeIndex !== -1);

  const offBtn = '<button data-idx="-1" class="' + (state.subtitles.activeIndex === -1 ? "selected" : "") + '">Desligado</button>';
  const trackBtns = tracks.map(function(t){
    const sel = t.index === state.subtitles.activeIndex ? "selected" : "";
    return '<button data-idx="' + t.index + '" class="' + sel + '">' + escapeHtml(t.label) + '</button>';
  }).join("");
  menu.innerHTML = offBtn + trackBtns;

  Array.prototype.forEach.call(menu.querySelectorAll("button"), function(b){
    b.addEventListener("click", function(){
      setSubtitleTrack(parseInt(b.getAttribute("data-idx"), 10));
      menu.classList.remove("open");
    });
  });
}

document.getElementById("ccBtn").addEventListener("click", function(e){
  e.stopPropagation();
  document.getElementById("ccMenu").classList.toggle("open");
});
document.addEventListener("click", function(){
  document.getElementById("ccMenu").classList.remove("open");
});

/* ============================================================
   6. RENDER HELPERS
   ============================================================ */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function truncate(str, n){ return str.length > n ? str.slice(0,n-1) + "…" : str; }

function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(function(){ t.classList.remove("show"); }, 2600);
}

function renderStats(){
  document.getElementById("statChannels").textContent = state.channels.length;
  document.getElementById("statCats").textContent = state.categories.length;
  document.getElementById("statFavs").textContent = state.favorites.length;
}

function renderCategoryChips(){
  const chipsEl = document.getElementById("catChips");
  if(!state.settings.showCategories){ chipsEl.style.display="none"; return; }
  chipsEl.style.display="flex";
  const cats = ["TODOS"].concat(state.categories);
  chipsEl.innerHTML = cats.map(function(c){
    const active = c === state.currentCategory ? "active" : "";
    return '<button class="chip ' + active + '" data-cat="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>';
  }).join("");
  Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function(btn){
    btn.addEventListener("click", function(){
      state.currentCategory = btn.getAttribute("data-cat");
      prefSet(PREF_KEYS.selectedCategory, state.currentCategory);
      renderCategoryChips();
      renderChannelList();
    });
  });
}

function getFilteredChannels(){
  let list = state.channels.slice();

  if(state.currentTab === "favorites"){
    list = list.filter(function(c){ return isFavorite(c.id); });
  } else if(state.currentCategory && state.currentCategory !== "TODOS"){
    list = list.filter(function(c){ return c.group === state.currentCategory; });
  }

  if(state.searchTerm){
    const term = state.searchTerm.toLowerCase();
    list = list.filter(function(c){
      return c.name.toLowerCase().indexOf(term) !== -1 || (c.group && c.group.toLowerCase().indexOf(term) !== -1);
    });
  }

  if(state.sortMode === "az"){
    list.sort(function(a,b){ return a.name.localeCompare(b.name); });
  } else if(state.sortMode === "za"){
    list.sort(function(a,b){ return b.name.localeCompare(a.name); });
  } else if(state.sortMode === "favFirst"){
    list.sort(function(a,b){
      const fa = isFavorite(a.id) ? 0 : 1, fb = isFavorite(b.id) ? 0 : 1;
      return fa !== fb ? fa - fb : 0;
    });
  }
  return list;
}

function renderChannelList(){
  const listEl = document.getElementById("channelList");
  const items = getFilteredChannels();

  if(state.channels.length === 0){
    listEl.innerHTML = '<div class="empty-note">Nenhum canal disponível no momento.</div>';
    return;
  }
  if(items.length === 0){
    listEl.innerHTML = state.currentTab === "favorites"
      ? '<div class="empty-note">Você ainda não possui canais favoritos.<br>Clique na estrela de um canal para adicioná-lo aos favoritos.</div>'
      : '<div class="empty-note">Nenhum canal encontrado para esta busca/categoria.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach(function(c){
    const row = document.createElement("div");
    row.className = "channel-row" + (state.currentChannel && state.currentChannel.id === c.id ? " current" : "");

    const logoHtml = (state.settings.showLogos && c.logo)
      ? '<img src="' + escapeHtml(c.logo) + '" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=&quot;bars&quot;><i style=&quot;height:6px&quot;></i><i style=&quot;height:12px&quot;></i><i style=&quot;height:9px&quot;></i><i style=&quot;height:14px&quot;></i></div>\'">'
      : '<div class="bars"><i style="height:6px"></i><i style="height:12px"></i><i style="height:9px"></i><i style="height:14px"></i></div>';

    row.innerHTML =
      '<div class="ch-logo">' + logoHtml + '</div>' +
      '<div class="ch-info"><div class="nm">' + escapeHtml(c.name) + '</div><div class="gp">' + escapeHtml(c.group) + '</div></div>' +
      '<button class="ch-star ' + (isFavorite(c.id) ? "active" : "") + '" aria-label="Favoritar ' + escapeHtml(c.name) + '">' + (isFavorite(c.id) ? "★" : "☆") + '</button>';

    row.addEventListener("click", function(e){
      if(e.target.closest(".ch-star")) return;
      playChannel(c);
    });
    row.querySelector(".ch-star").addEventListener("click", function(e){
      e.stopPropagation();
      toggleFavorite(c.id);
    });

    frag.appendChild(row);
  });
  listEl.innerHTML = "";
  listEl.appendChild(frag);
}

function renderNowPlaying(){
  const npFav = document.getElementById("npFav");
  if(!state.currentChannel){
    document.getElementById("npName").textContent = "Nenhum canal selecionado";
    document.getElementById("npGroup").textContent = "—";
    npFav.className = "fav-toggle"; npFav.textContent = "☆ Favoritar"; npFav.disabled = true;
    return;
  }
  npFav.disabled = false;
  document.getElementById("npName").textContent = state.currentChannel.name;
  document.getElementById("npGroup").textContent = state.currentChannel.group;
  const fav = isFavorite(state.currentChannel.id);
  npFav.className = "fav-toggle" + (fav ? " active" : "");
  npFav.textContent = fav ? "★ Favoritado" : "☆ Favoritar";
}

/* ============================================================
   7. SHELL SWITCHING (loading / app / error)
   ============================================================ */
function showShell(name){
  document.getElementById("loadingShell").style.display = name === "loading" ? "block" : "none";
  document.getElementById("mainShell").style.display = name === "app" ? "block" : "none";
  document.getElementById("errorShell").style.display = name === "error" ? "block" : "none";
}

function handleSessionExpired(){
  window.location.href = "/login.html";
}

/* ============================================================
   8. BOOTSTRAP: sessão -> playlist -> favoritos
   ============================================================ */
function bootstrap(){
  showShell("loading");

  api("/api/auth/session").then(function(sessionRes){
    if(!sessionRes.data.authenticated){ return handleSessionExpired(); }
    document.getElementById("userBadge").textContent = sessionRes.data.email || "";
    document.getElementById("accountEmail").textContent = sessionRes.data.email || "—";

    document.getElementById("loadingText").textContent = "Carregando canais...";
    return Promise.all([ api("/api/playlist"), api("/api/favorites") ]).then(function(results){
      const playlistRes = results[0], favoritesRes = results[1];

      if(playlistRes.status === 401) return handleSessionExpired();
      if(!(playlistRes.status >= 200 && playlistRes.status < 300)){
        document.getElementById("errorText").textContent = playlistRes.data.message || "Tente novamente mais tarde.";
        return showShell("error");
      }

      state.channels = playlistRes.data.channels || [];
      state.categories = playlistRes.data.categories || [];
      state.favorites = (favoritesRes.data && favoritesRes.data.favorites) || [];

      document.getElementById("sortSelect").value = state.sortMode;
      renderStats();
      renderCategoryChips();
      renderChannelList();
      renderNowPlaying();
      showShell("app");

      const lastId = state.settings.resume ? prefGet(PREF_KEYS.lastChannel, null) : null;
      if(lastId){
        const found = state.channels.find(function(c){ return c.id === lastId; });
        if(found) showToast("Último canal: " + found.name + " — clique para retomar.");
      }
    });
  }).catch(function(err){
    console.error("Falha ao inicializar aplicação:", err);
    document.getElementById("errorText").textContent = "Não foi possível conectar ao servidor.";
    showShell("error");
  });
}

/* ============================================================
   9. SETTINGS MODAL / ACCOUNT
   ============================================================ */
function setSwitch(id, on){ document.getElementById(id).classList.toggle("on", !!on); }
function applySettingsToUI(){
  setSwitch("toggleAutoplay", state.settings.autoplay);
  setSwitch("toggleResume", state.settings.resume);
  setSwitch("toggleLogos", state.settings.showLogos);
  setSwitch("toggleCats", state.settings.showCategories);
}
function bindSwitch(id, key){
  document.getElementById(id).addEventListener("click", function(){
    state.settings[key] = !state.settings[key];
    setSwitch(id, state.settings[key]);
    prefSet(PREF_KEYS.settings, state.settings);
    renderCategoryChips(); renderChannelList();
  });
}

const modalBackdrop = document.getElementById("modalBackdrop");
document.getElementById("settingsBtn").addEventListener("click", function(){
  applySettingsToUI();
  modalBackdrop.classList.add("open");
});
document.getElementById("closeModalBtn").addEventListener("click", function(){ modalBackdrop.classList.remove("open"); });
modalBackdrop.addEventListener("click", function(e){ if(e.target === modalBackdrop) modalBackdrop.classList.remove("open"); });

bindSwitch("toggleAutoplay", "autoplay");
bindSwitch("toggleResume", "resume");
bindSwitch("toggleLogos", "showLogos");
bindSwitch("toggleCats", "showCategories");

document.getElementById("clearFavsBtn").addEventListener("click", function(){
  if(!confirm("Tem certeza que deseja apagar todos os favoritos?")) return;
  api("/api/favorites", { method:"DELETE" }).then(function(res){
    if(res.status === 401) return handleSessionExpired();
    state.favorites = (res.data && res.data.favorites) || [];
    renderStats(); renderChannelList(); renderNowPlaying();
    showToast("Favoritos apagados.");
  }).catch(function(){ showToast("Não foi possível apagar os favoritos agora."); });
});

document.getElementById("logoutBtn").addEventListener("click", doLogout);
document.getElementById("logoutFromErrorBtn").addEventListener("click", doLogout);
function doLogout(){
  api("/api/auth/logout", { method:"POST" }).finally(function(){
    window.location.href = "/login.html";
  });
}

document.getElementById("retryBtn").addEventListener("click", bootstrap);

document.getElementById("showChangePassBtn").addEventListener("click", function(){
  const form = document.getElementById("changePassForm");
  form.style.display = form.style.display === "none" ? "flex" : "none";
});
document.getElementById("submitChangePassBtn").addEventListener("click", function(){
  const current = document.getElementById("currentPassword").value;
  const next = document.getElementById("newPassword").value;
  const errEl = document.getElementById("changePassError");
  errEl.textContent = "";

  api("/api/auth/change-password", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ currentPassword: current, newPassword: next })
  }).then(function(res){
    if(res.status === 401 && res.data.error === "NOT_AUTHENTICATED") return handleSessionExpired();
    if(!(res.status >= 200 && res.status < 300)){
      errEl.textContent = res.data.message || "Não foi possível trocar a senha.";
      return;
    }
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("changePassForm").style.display = "none";
    showToast("Senha alterada com sucesso.");
  }).catch(function(){ errEl.textContent = "Não foi possível conectar ao servidor."; });
});

fetch("/api/config").then(function(r){ return r.json(); }).then(function(cfg){
  const link = document.getElementById("supportEmailLink");
  link.href = "mailto:" + (cfg.supportEmail || "gugaram@gmail.com");
  link.textContent = cfg.supportEmail || "gugaram@gmail.com";
}).catch(function(){});

/* ============================================================
   10. TABS / SEARCH / SORT
   ============================================================ */
document.querySelectorAll("nav.tabs button").forEach(function(btn){
  btn.addEventListener("click", function(){
    document.querySelectorAll("nav.tabs button").forEach(function(b){ b.classList.remove("active"); });
    if(btn.getAttribute("data-tab") === "categories"){
      document.querySelector('nav.tabs button[data-tab="all"]').classList.add("active");
      state.currentTab = "all";
      document.getElementById("catChips").scrollIntoView({behavior:"smooth", block:"nearest"});
    } else {
      btn.classList.add("active");
      state.currentTab = btn.getAttribute("data-tab");
    }
    renderChannelList();
  });
});

let searchDebounce = null;
document.getElementById("searchInput").addEventListener("input", function(e){
  clearTimeout(searchDebounce);
  const val = e.target.value;
  searchDebounce = setTimeout(function(){ state.searchTerm = val.trim(); renderChannelList(); }, 220);
});

document.getElementById("sortSelect").addEventListener("change", function(e){
  state.sortMode = e.target.value;
  prefSet(PREF_KEYS.sortMode, state.sortMode);
  renderChannelList();
});

document.getElementById("npFav").addEventListener("click", function(){
  if(state.currentChannel) toggleFavorite(state.currentChannel.id);
});

/* ============================================================
   11. KEYBOARD SHORTCUTS
   ============================================================ */
document.addEventListener("keydown", function(e){
  const tag = (e.target.tagName || "").toLowerCase();
  if(tag === "input" || tag === "select" || tag === "textarea"){
    if(e.key === "Escape") e.target.blur();
    return;
  }
  if(e.key === "/"){ e.preventDefault(); document.getElementById("searchInput").focus(); }
  else if(e.key.toLowerCase() === "f"){ document.getElementById("npFav").click(); }
  else if(e.key === "Escape"){ modalBackdrop.classList.remove("open"); }
  else if(e.key === "ArrowDown" || e.key === "ArrowUp"){
    e.preventDefault();
    const items = getFilteredChannels();
    if(items.length === 0) return;
    let idx = state.currentChannel ? items.findIndex(function(c){ return c.id === state.currentChannel.id; }) : -1;
    idx = e.key === "ArrowDown" ? Math.min(idx+1, items.length-1) : Math.max(idx-1, 0);
    if(idx >= 0){
      const row = document.querySelectorAll(".channel-row")[idx];
      if(row) row.scrollIntoView({block:"nearest"});
      state.currentChannel = items[idx];
      renderNowPlaying(); renderChannelList();
    }
  } else if(e.key === "Enter"){
    if(state.currentChannel) playChannel(state.currentChannel);
  }
});

/* ============================================================
   12. INIT
   ============================================================ */
bootstrap();

})();
