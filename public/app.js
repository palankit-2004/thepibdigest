const $ = (s) => document.querySelector(s);

const state = {
  all: [],
  view: [],
  ministry: "__all__",
  q: "",
  chip: "__all__",
  bookmarksOnly: false,
  renderLimit: 40
};

const BM_KEY = "pibdigest_bookmarks_v1";
const getBms = () => new Set(JSON.parse(localStorage.getItem(BM_KEY) || "[]"));
const setBms = (set) => localStorage.setItem(BM_KEY, JSON.stringify([...set]));

const UPSC_MINISTRY_ORDER = [
  "Ministry of Defence",
  "Ministry of Home Affairs",
  "Ministry of External Affairs",
  "Ministry of Finance",
  "Ministry of Law and Justice",
  "Ministry of Environment, Forest and Climate Change",
  "Ministry of Health and Family Welfare",
  "Ministry of Education",
  "Ministry of Agriculture & Farmers Welfare",
  "Ministry of Railways",
  "Ministry of Road Transport and Highways",
  "Ministry of Power",
  "Ministry of Petroleum and Natural Gas",
  "Ministry of Commerce and Industry",
  "Ministry of Electronics & IT",
  "Ministry of Science & Technology",
  "Ministry of Labour & Employment",
  "Ministry of Rural Development",
  "Ministry of Housing and Urban Affairs",
  "Ministry of Women and Child Development",
  "Ministry of Social Justice and Empowerment",
  "Ministry of Tribal Affairs",
  "Ministry of Consumer Affairs, Food and Public Distribution",
  "Ministry of Parliamentary Affairs",
  "Ministry of Civil Aviation",
  "Ministry of Coal",
  "Ministry of Heavy Industries",
  "Ministry of Panchayati Raj",
  "Ministry of Jal Shakti",
  "Ministry of Information & Broadcasting",
  "NITI Aayog",
];

function dropdownMinistries(items){
  const present = new Set(items.map(x => x.ministry).filter(Boolean));
  const extras = [...present].filter(m => !UPSC_MINISTRY_ORDER.includes(m)).sort();
  return [...UPSC_MINISTRY_ORDER, ...extras];
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function formatUpdated(iso){
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pibdigest_theme", theme);
  $("#toggleTheme").textContent = theme === "light" ? "☀️" : "🌙";
}

function setErrorUI(msg){
  $("#updated").textContent = "Data load failed";
  $("#list").innerHTML = `
    <div class="card">
      <div class="kicker">Error</div>
      <h3 class="title">Couldn’t load PIB data</h3>
      <p class="snip">${escapeHtml(msg)}</p>
      <p class="snip">Fix: ensure <b>/public/data/index.json</b> exists and Netlify publishes the <b>public/</b> folder.</p>
    </div>
  `;
  $("#loadMore").style.display = "none";
  $("#countInfo").textContent = "";
}

/* Chips = keyword packs (better than filtering by chip id text) */
const CHIP_PACKS = {
  "__all__": { label: "All", keywords: [] },
  "budget": { label: "Budget", keywords: ["budget", "union budget", "finance bill", "economic survey", "allocation", "outlay"] },
  "cabinet": { label: "Cabinet", keywords: ["cabinet", "union cabinet", "cabinet approves", "ccs", "committee on security"] },
  "exercises": { label: "Exercises", keywords: ["exercise", "joint exercise", "bilateral exercise", "multilateral exercise", "drill", "naval exercise"] },
  "schemes": { label: "Schemes", keywords: ["scheme", "yojana", "mission", "programme", "initiative", "launch", "launched"] },
  "bills": { label: "Bills/Acts", keywords: ["bill", "act", "amendment", "ordinance", "rules", "notification"] },
  "summits": { label: "Summits", keywords: ["summit", "conference", "conclave", "meeting", "dialogue", "visit"] },
  "missions": { label: "Missions", keywords: ["mission", "roadmap", "strategy", "action plan", "milestone"] },
};

function renderChips(){
  const el = $("#chips");
  el.innerHTML = Object.entries(CHIP_PACKS).map(([id, cfg]) => `
    <button class="chip ${state.chip===id?"active":""}" data-id="${id}">
      ${cfg.label}
    </button>
  `).join("");

  el.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      state.chip = btn.dataset.id;
      renderChips();
      applyFilters();
    });
  });
}

function normalizeText(raw){
  if (!raw) return "";
  let t = String(raw).replace(/\t/g, " ");
  let lines = t.split("\n").map(line => {
    line = line.replace(/\s+$/g, "");
    line = line.replace(/^\s{2,}/g, "");
    line = line.replace(/ {2,}/g, " ");
    return line;
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function applyFilters(){
  const bms = getBms();
  let items = state.all;

  if (state.bookmarksOnly) items = items.filter(x => x.prid && bms.has(String(x.prid)));
  if (state.ministry !== "__all__") items = items.filter(x => x.ministry === state.ministry);

  if (state.chip !== "__all__"){
    const kws = (CHIP_PACKS[state.chip]?.keywords || []).map(k => k.toLowerCase());
    items = items.filter(x => {
      const t = ((x.title||"") + " " + (x.snippet||"")).toLowerCase();
      return kws.some(k => t.includes(k));
    });
  }

  if (state.q.trim()){
    const q = state.q.toLowerCase();
    items = items.filter(x =>
      (x.title||"").toLowerCase().includes(q) ||
      (x.snippet||"").toLowerCase().includes(q) ||
      (x.ministry||"").toLowerCase().includes(q)
    );
  }

  state.view = items;
  state.renderLimit = Math.min(40, state.view.length);
  renderList();
}

function renderList(){
  const el = $("#list");
  const bms = getBms();

  if (!state.view.length){
    el.innerHTML = `<div class="card"><div class="kicker">No results</div><p class="snip">Try removing filters or searching different keywords.</p></div>`;
    $("#countInfo").textContent = "";
    $("#loadMore").style.display = "none";
    return;
  }

  const shown = state.view.slice(0, state.renderLimit);

  el.innerHTML = shown.map(x => `
    <article class="card" data-prid="${escapeHtml(x.prid)}">
      <div class="kicker">
        <span class="pill">${escapeHtml(x.ministry || "PIB")}</span>
        <span class="dot">•</span>
        <span>${escapeHtml(x.posted_on_raw || "")}</span>
        <span class="dot">•</span>
        <span>${(x.prid && bms.has(String(x.prid))) ? "★ Saved" : "☆"}</span>
      </div>
      <h3 class="title">${escapeHtml(x.title || "Untitled")}</h3>
      <p class="snip">${escapeHtml(x.snippet || "")}</p>
    </article>
  `).join("");

  el.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => openReader(card.dataset.prid));
  });

  $("#countInfo").textContent = `Showing ${shown.length} of ${state.view.length}`;
  $("#loadMore").style.display = (state.renderLimit < state.view.length) ? "inline-flex" : "none";
}

async function openReader(prid){
  const idx = state.all.find(i => String(i.prid) === String(prid));
  if(!idx) return;

  $("#rMinistry").textContent = idx.ministry || "PIB";
  $("#rTitle").textContent = idx.title || "Untitled";
  $("#rPosted").textContent = idx.posted_on_raw || "";
  $("#rSource").href = idx.source_url || "#";

  const pdfs = idx.pdfs || [];
  $("#rPdfs").innerHTML = pdfs.length
    ? pdfs.map(p => `<a href="${p.url}" target="_blank" rel="noopener">⬇ ${escapeHtml(p.label || "PDF")}</a>`).join("")
    : `<span class="kicker">No PDF attachments found.</span>`;

  $("#rText").textContent = "Loading full text…";
  $("#reader").showModal();

  const btn = $("#rBookmark");
  const refreshBm = () => {
    const bms = getBms();
    btn.textContent = (idx.prid && bms.has(String(idx.prid))) ? "★ Bookmarked" : "☆ Bookmark";
  };
  refreshBm();

  btn.onclick = () => {
    if(!idx.prid) return;
    const b = getBms();
    const key = String(idx.prid);
    if (b.has(key)) b.delete(key); else b.add(key);
    setBms(b);
    refreshBm();
    renderList();
  };

  try {
    const res = await fetch(`data/items/${encodeURIComponent(prid)}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`detail HTTP ${res.status}`);
    const txt = await res.text();
    if (!txt.trim()) throw new Error("detail empty");
    const d = JSON.parse(txt);
    $("#rText").textContent = normalizeText(d.text || "");
  } catch {
    $("#rText").textContent = normalizeText(idx.snippet || "Unable to load full text.");
  }
}

async function init(){
  // theme
  const savedTheme = localStorage.getItem("pibdigest_theme") || "dark";
  setTheme(savedTheme);
  $("#toggleTheme").onclick = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(next);
  };

  try{
    const res = await fetch("data/index.json", { cache: "no-store" });
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} while loading /data/index.json`);
    if (!txt.trim()) throw new Error("index.json is empty.");

    const data = JSON.parse(txt);

    $("#updated").textContent = "Updated: " + formatUpdated(data.updated_at_utc);
    state.all = (data.items || []).map(x => ({ ...x, prid: String(x.prid || "") }));
    state.view = state.all;

    // dropdown (UPSC list always visible)
    const mins = dropdownMinistries(state.all);
    const sel = $("#ministry");
    sel.innerHTML =
      `<option value="__all__">All tracked ministries</option>` +
      mins.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    sel.onchange = () => { state.ministry = sel.value; applyFilters(); };

    // search
    $("#q").addEventListener("input", (e) => { state.q = e.target.value; applyFilters(); });

    // bookmarks toggle
    $("#showBookmarks").onclick = () => {
      state.bookmarksOnly = !state.bookmarksOnly;
      $("#showBookmarks").textContent = state.bookmarksOnly ? "All items" : "Bookmarks";
      applyFilters();
    };

    // load more
    $("#loadMore").onclick = () => {
      state.renderLimit = Math.min(state.renderLimit + 40, state.view.length);
      renderList();
    };

    renderChips();
    applyFilters();
  }catch(e){
    setErrorUI(e.message || String(e));
  }
}

init();