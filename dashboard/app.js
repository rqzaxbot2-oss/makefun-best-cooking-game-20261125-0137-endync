(function () {
  "use strict";

  const state = {
    raw: null,
    items: [],
    filtered: [],
    selectedId: null,
    query: "",
    category: "all",
    status: "all",
    sortBy: "default",
    sortDir: "desc",
    view: "auto",
    activeTab: "all"
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function qs(selectors, root) {
    const scope = root || document;
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function readGlobalData() {
    const candidates = [
      window.BOARD_DATA,
      window.DASHBOARD_DATA,
      window.COOKING_DATA,
      window.DOSSIER_DATA,
      window.GAME_DATA,
      window.APP_DATA,
      window.DATA,
      window.__BOARD__,
      window.__DATA__,
      typeof BOARD_DATA !== "undefined" ? BOARD_DATA : null,
      typeof DASHBOARD_DATA !== "undefined" ? DASHBOARD_DATA : null,
      typeof DATA !== "undefined" ? DATA : null
    ];
    for (const item of candidates) {
      if (item && typeof item === "object") return item;
    }
    return null;
  }

  async function loadData() {
    const inline = readGlobalData();
    if (inline) return inline;
    const scriptJson = qs(['script[type="application/json"]']);
    if (scriptJson && scriptJson.textContent.trim()) {
      try {
        return JSON.parse(scriptJson.textContent);
      } catch (_err) {
        // Ignore malformed embedded JSON and continue fallback.
      }
    }
    if (typeof fetch === "function" && /^https?:$/i.test(window.location.protocol)) {
      try {
        const res = await fetch("./board.json");
        if (res.ok) return await res.json();
      } catch (_err) {
        // Static file fallback below.
      }
    }
    return { title: "Kitchen Dashboard", summary: {}, items: [] };
  }

  function extractItems(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== "object") return [];
    const keys = [
      "items", "orders", "recipes", "dishes", "entries",
      "runs", "records", "rows", "stations", "cards", "levels"
    ];
    for (const k of keys) {
      if (Array.isArray(raw[k]) && raw[k].length >= 0) return raw[k];
    }
    for (const k of Object.keys(raw)) {
      if (Array.isArray(raw[k]) && raw[k].length && typeof raw[k][0] === "object") {
        return raw[k];
      }
    }
    return [];
  }

  function pick(obj, keys, fallback) {
    if (!obj || typeof obj !== "object") return fallback;
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return fallback;
  }

  function normalizeItem(entry, idx) {
    const id = String(pick(entry, ["id", "slug", "code", "orderId", "recipeId", "key"], "item-" + (idx + 1)));
    const title = String(pick(entry, ["title", "name", "dish", "recipe", "label", "summary"], id));
    const category = String(pick(entry, ["category", "station", "course", "cuisine", "type", "group"], "general"));
    const status = String(pick(entry, ["status", "state", "stage", "phase", "verdict"], "ready"));
    const score = Number(pick(entry, ["score", "points", "rating", "reward", "price", "value", "quality"], 0)) || 0;
    const duration = Number(pick(entry, ["time", "prepTime", "cookTime", "duration", "timer", "seconds", "timeLimit"], 0)) || 0;
    const difficulty = String(pick(entry, ["difficulty", "tier", "level", "priority"], ""));
    const description = String(pick(entry, ["description", "notes", "summary", "details", "subtitle"], ""));
    const tags = Array.isArray(entry.tags)
      ? entry.tags.map(String)
      : Array.isArray(entry.ingredients)
        ? entry.ingredients.map(function (i) { return typeof i === "string" ? i : (i && (i.name || i.id)) || ""; }).filter(Boolean)
        : [];
    const searchBlob = [id, title, category, status, difficulty, description, tags.join(" "), JSON.stringify(entry)]
      .join(" ")
      .toLowerCase();
    return {
      index: idx,
      id: id,
      title: title,
      category: category,
      status: status,
      score: score,
      duration: duration,
      difficulty: difficulty,
      description: description,
      tags: tags,
      searchBlob: searchBlob,
      raw: entry
    };
  }

  function uniqueValues(items, field) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
      const val = item[field];
      if (val && !seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
    }
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }

  function compareValues(a, b, field, dir) {
    const mult = dir === "asc" ? 1 : -1;
    if (field === "default") return (a.index - b.index) * (dir === "asc" ? -1 : 1);
    const av = a[field] !== undefined ? a[field] : a.raw[field];
    const bv = b[field] !== undefined ? b[field] : b.raw[field];
    const an = Number(av);
    const bn = Number(bv);
    let cmp = 0;
    if (av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) {
      cmp = an - bn;
    } else {
      cmp = String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), undefined, { numeric: true, sensitivity: "base" });
    }
    return cmp !== 0 ? cmp * mult : a.index - b.index;
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    const list = state.items.filter(function (item) {
      if (state.category !== "all" && item.category.toLowerCase() !== state.category.toLowerCase()) return false;
      if (state.status !== "all" && item.status.toLowerCase() !== state.status.toLowerCase()) return false;
      if (state.activeTab !== "all" && item.category.toLowerCase() !== state.activeTab.toLowerCase() && item.status.toLowerCase() !== state.activeTab.toLowerCase()) {
        return false;
      }
      if (q && item.searchBlob.indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      return compareValues(a, b, state.sortBy, state.sortDir);
    });
    state.filtered = list;
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "0";
    return Math.abs(n % 1) < 1e-6 ? String(Math.round(n)) : n.toFixed(1);
  }

  function ensureFallbackShell() {
    const existingList = qs([
      "#items-container", "#board", "#cards", "#grid", "#list",
      "#table-body", "tbody[data-rows]", "#recipes-grid", "#orders-list", "[data-list]"
    ]);
    if (existingList) return;
    const host = qs(["#app", "main", ".container"]) || document.body;
    const section = document.createElement("section");
    section.id = "dashboard-shell";
    section.className = "dashboard-shell";
    section.innerHTML =
      '<div class="controls-bar">' +
        '<input id="search-input" type="search" placeholder="Filter dishes, ingredients, stations..." aria-label="Search">' +
        '<select id="category-filter" aria-label="Category"><option value="all">All categories</option></select>' +
        '<select id="status-filter" aria-label="Status"><option value="all">All statuses</option></select>' +
        '<select id="sort-select" aria-label="Sort by">' +
          '<option value="default">Default order</option>' +
          '<option value="title">Name</option>' +
          '<option value="score">Score</option>' +
          '<option value="duration">Time</option>' +
          '<option value="status">Status</option>' +
        '</select>' +
        '<button id="sort-dir" type="button" aria-label="Toggle sort direction">Desc</button>' +
        '<button id="reset-filters" type="button">Reset</button>' +
      '</div>' +
      '<div id="kpi-grid" class="kpi-grid"></div>' +
      '<div id="result-count" class="result-count"></div>' +
      '<div id="items-container" class="items-grid"></div>';
    host.appendChild(section);
  }

  function populateSelect(el, values, allLabel, current) {
    if (!el || el.tagName !== "SELECT") return;
    const opts = ['<option value="all">' + esc(allLabel) + "</option>"];
    for (const v of values) {
      opts.push('<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>");
    }
    el.innerHTML = opts.join("");
    el.value = current;
  }

  function renderMetaAndStats() {
    const raw = state.raw || {};
    const titleEl = qs(["#board-title", "#dashboard-title", "[data-title]"]);
    if (titleEl && raw.title) titleEl.textContent = String(raw.title);
    const subEl = qs(["#board-subtitle", "#dashboard-subtitle", "[data-subtitle]"]);
    if (subEl && (raw.subtitle || raw.description)) subEl.textContent = String(raw.subtitle || raw.description);

    const total = state.items.length;
    const shown = state.filtered.length;
    const avgScore = shown ? state.filtered.reduce(function (s, x) { return s + x.score; }, 0) / shown : 0;
    const avgTime = shown ? state.filtered.reduce(function (s, x) { return s + x.duration; }, 0) / shown : 0;
    const readyCount = state.filtered.filter(function (x) {
      return /ready|served|complete|pass|done|active/i.test(x.status);
    }).length;

    const countEl = qs(["#result-count", "#count", "#item-count", "[data-count]"]);
    if (countEl) {
      countEl.textContent = shown === total
        ? shown + " items"
        : shown + " of " + total + " items";
    }

    const kpiMap = {
      total: String(total),
      shown: String(shown),
      ready: String(readyCount),
      score: formatNumber(avgScore),
      avgScore: formatNumber(avgScore),
      time: formatNumber(avgTime) + "s",
      avgTime: formatNumber(avgTime) + "s"
    };
    document.querySelectorAll("[data-kpi]").forEach(function (node) {
      const key = node.getAttribute("data-kpi");
      if (key && kpiMap[key] !== undefined) node.textContent = kpiMap[key];
      else if (key && raw.summary && raw.summary[key] !== undefined) node.textContent = String(raw.summary[key]);
    });

    const kpiGrid = qs(["#kpi-grid", "#stats", "#summary-cards"]);
    if (kpiGrid && !kpiGrid.querySelector("[data-kpi]")) {
      const summary = raw.summary && typeof raw.summary === "object" ? raw.summary : null;
      const cards = summary
        ? Object.keys(summary).slice(0, 6).map(function (k) {
            return { label: k.replace(/([A-Z])/g, " $1").replace(/_/g, " "), value: summary[k] };
          })
        : [
            { label: "Total Items", value: total },
            { label: "Visible", value: shown },
            { label: "Ready / Complete", value: readyCount },
            { label: "Avg Score", value: formatNumber(avgScore) },
            { label: "Avg Time", value: formatNumber(avgTime) + "s" }
          ];
      kpiGrid.innerHTML = cards.map(function (c) {
        return '<div class="kpi-card"><span class="kpi-label">' + esc(c.label) +
          '</span><strong class="kpi-value">' + esc(c.value) + "</strong></div>";
      }).join("");
    }
  }

  function renderCard(item) {
    const active = item.id === state.selectedId ? " is-selected" : "";
    const tagsHtml = item.tags.slice(0, 5).map(function (t) {
      return '<span class="tag">' + esc(t) + "</span>";
    }).join("");
    return (
      '<article class="board-card' + active + '" data-item-id="' + esc(item.id) + '" tabindex="0" role="button">' +
        '<header class="card-header">' +
          '<span class="card-category">' + esc(item.category) + "</span>" +
          '<span class="status-badge status-' + esc(item.status.toLowerCase().replace(/[^a-z0-9]+/g, "-")) + '">' + esc(item.status) + "</span>" +
        "</header>" +
        '<h3 class="card-title">' + esc(item.title) + "</h3>" +
        (item.description ? '<p class="card-desc">' + esc(item.description) + "</p>" : "") +
        '<div class="card-metrics">' +
          (item.score ? '<span>Score: <strong>' + esc(formatNumber(item.score)) + "</strong></span>" : "") +
          (item.duration ? '<span>Time: <strong>' + esc(formatNumber(item.duration)) + "s</strong></span>" : "") +
          (item.difficulty ? '<span>Tier: <strong>' + esc(item.difficulty) + "</strong></span>" : "") +
        "</div>" +
        (tagsHtml ? '<div class="card-tags">' + tagsHtml + "</div>" : "") +
      "</article>"
    );
  }

  function renderRow(item) {
    const active = item.id === state.selectedId ? ' class="is-selected"' : "";
    return (
      "<tr" + active + ' data-item-id="' + esc(item.id) + '" tabindex="0">' +
        "<td><strong>" + esc(item.title) + "</strong></td>" +
        "<td>" + esc(item.category) + "</td>" +
        '<td><span class="status-badge">' + esc(item.status) + "</span></td>" +
        "<td>" + esc(formatNumber(item.score)) + "</td>" +
        "<td>" + (item.duration ? esc(formatNumber(item.duration)) + "s" : "-") + "</td>" +
        "<td>" + esc(item.tags.slice(0, 3).join(", ")) + "</td>" +
      "</tr>"
    );
  }

  function renderList() {
    const tbody = qs(["#table-body", "tbody[data-rows]", "#orders-table tbody", "table.board-table tbody"]);
    const grid = qs(["#items-container", "#board", "#cards", "#grid", "#list", "#recipes-grid", "#orders-list", "[data-list]"]);

    if (tbody) {
      tbody.innerHTML = state.filtered.length
        ? state.filtered.map(renderRow).join("")
        : '<tr><td colspan="6" class="empty-state">No matching items.</td></tr>';
    }
    if (grid && grid !== tbody) {
      grid.innerHTML = state.filtered.length
        ? state.filtered.map(renderCard).join("")
        : '<div class="empty-state">No matching items. Adjust your search or filters.</div>';
    }
  }

  function formatDetailValue(val) {
    if (val == null) return "-";
    if (Array.isArray(val)) {
      if (!val.length) return "None";
      return '<ul class="detail-list">' + val.map(function (v) {
        return "<li>" + esc(typeof v === "object" ? JSON.stringify(v) : String(v)) + "</li>";
      }).join("") + "</ul>";
    }
    if (typeof val === "object") {
      return '<pre class="detail-json">' + esc(JSON.stringify(val, null, 2)) + "</pre>";
    }
    return esc(String(val));
  }

  function getDetailContainer() {
    let panel = qs(["#detail-panel", "#detail-modal", "#inspector", "#detail", "[data-detail]"]);
    if (!panel) {
      panel = document.createElement("aside");
      panel.id = "detail-panel";
      panel.className = "detail-panel";
      panel.setAttribute("aria-live", "polite");
      panel.hidden = true;
      document.body.appendChild(panel);
    }
    return panel;
  }

  function renderDetail() {
    const panel = getDetailContainer();
    const item = state.items.find(function (x) { return x.id === state.selectedId; });
    if (!item) {
      panel.hidden = true;
      panel.classList.remove("is-open", "open");
      return;
    }

    const idx = state.filtered.findIndex(function (x) { return x.id === item.id; });
    const rows = Object.keys(item.raw).map(function (k) {
      return '<div class="detail-row"><dt>' + esc(k) + "</dt><dd>" + formatDetailValue(item.raw[k]) + "</dd></div>";
    }).join("");

    panel.hidden = false;
    panel.classList.add("is-open", "open");
    panel.innerHTML =
      '<div class="detail-inner">' +
        '<header class="detail-header">' +
          '<div><span class="card-category">' + esc(item.category) + '</span><h2>' + esc(item.title) + "</h2></div>" +
          '<div class="detail-actions">' +
            '<button type="button" data-detail-nav="prev"' + (idx <= 0 ? " disabled" : "") + ">Prev</button>" +
            '<button type="button" data-detail-nav="next"' + (idx < 0 || idx >= state.filtered.length - 1 ? " disabled" : "") + ">Next</button>" +
            '<button type="button" data-detail-close aria-label="Close details">Close</button>' +
          "</div>" +
        "</header>" +
        '<div class="detail-meta">' +
          '<span class="status-badge">' + esc(item.status) + "</span>" +
          (item.score ? "<span>Score: <strong>" + esc(formatNumber(item.score)) + "</strong></span>" : "") +
          (item.duration ? "<span>Time: <strong>" + esc(formatNumber(item.duration)) + "s</strong></span>" : "") +
        "</div>" +
        (item.description ? '<p class="detail-desc">' + esc(item.description) + "</p>" : "") +
        '<dl class="detail-fields">' + rows + "</dl>" +
      "</div>";
  }

  function stepSelection(delta) {
    if (!state.selectedId || !state.filtered.length) return;
    const idx = state.filtered.findIndex(function (x) { return x.id === state.selectedId; });
    if (idx === -1) return;
    const next = state.filtered[idx + delta];
    if (next) {
      state.selectedId = next.id;
      render();
    }
  }

  function render() {
    applyFilters();
    renderMetaAndStats();
    renderList();
    renderDetail();
    const dirBtn = qs(["#sort-dir", "[data-sort-dir]"]);
    if (dirBtn) dirBtn.textContent = state.sortDir === "asc" ? "Asc" : "Desc";
  }

  function bindEvents() {
    const searchEl = qs(["#search-input", "#search", 'input[type="search"]', "[data-search]"]);
    if (searchEl) {
      searchEl.addEventListener("input", function (e) {
        state.query = e.target.value || "";
        render();
      });
    }

    const catEl = qs(["#category-filter", "#filter-category", '[data-filter="category"]']);
    if (catEl) {
      catEl.addEventListener("change", function (e) {
        state.category = e.target.value || "all";
        render();
      });
    }

    const statusEl = qs(["#status-filter", "#filter-status", '[data-filter="status"]']);
    if (statusEl) {
      statusEl.addEventListener("change", function (e) {
        state.status = e.target.value || "all";
        render();
      });
    }

    const sortEl = qs(["#sort-select", "#sort-by", "[data-sort-select]"]);
    if (sortEl) {
      sortEl.addEventListener("change", function (e) {
        state.sortBy = e.target.value || "default";
        render();
      });
    }

    const dirBtn = qs(["#sort-dir", "[data-sort-dir]"]);
    if (dirBtn) {
      dirBtn.addEventListener("click", function () {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        render();
      });
    }

    const resetBtn = qs(["#reset-filters", "#clear-filters", "[data-reset]"]);
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state.query = "";
        state.category = "all";
        state.status = "all";
        state.sortBy = "default";
        state.sortDir = "desc";
        state.activeTab = "all";
        if (searchEl) searchEl.value = "";
        if (catEl) catEl.value = "all";
        if (statusEl) statusEl.value = "all";
        if (sortEl) sortEl.value = "default";
        render();
      });
    }

    document.addEventListener("click", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const closeBtn = target.closest("[data-detail-close]");
      if (closeBtn) {
        state.selectedId = null;
        render();
        return;
      }

      const navBtn = target.closest("[data-detail-nav]");
      if (navBtn) {
        stepSelection(navBtn.getAttribute("data-detail-nav") === "prev" ? -1 : 1);
        return;
      }

      const tabBtn = target.closest("[data-tab]");
      if (tabBtn) {
        state.activeTab = tabBtn.getAttribute("data-tab") || "all";
        document.querySelectorAll("[data-tab]").forEach(function (el) {
          el.classList.toggle("is-active", el === tabBtn);
        });
        render();
        return;
      }

      const sortHeader = target.closest("th[data-sort], button[data-sort]");
      if (sortHeader) {
        const field = sortHeader.getAttribute("data-sort") || "default";
        if (state.sortBy === field) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortBy = field;
          state.sortDir = "desc";
        }
        render();
        return;
      }

      const itemNode = target.closest("[data-item-id]");
      if (itemNode) {
        const id = itemNode.getAttribute("data-item-id");
        state.selectedId = state.selectedId === id ? null : id;
        render();
      }
    });

    document.addEventListener("keydown", function (e) {
      const tag = document.activeElement && document.activeElement.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !inInput && searchEl) {
        e.preventDefault();
        searchEl.focus();
      } else if (e.key === "Escape" && state.selectedId) {
        state.selectedId = null;
        render();
      } else if (e.key === "ArrowLeft" && !inInput && state.selectedId) {
        stepSelection(-1);
      } else if (e.key === "ArrowRight" && !inInput && state.selectedId) {
        stepSelection(1);
      } else if ((e.key === "Enter" || e.key === " ") && document.activeElement && document.activeElement.hasAttribute("data-item-id")) {
        e.preventDefault();
        state.selectedId = document.activeElement.getAttribute("data-item-id");
        render();
      }
    });
  }

  async function init() {
    state.raw = await loadData();
    state.items = extractItems(state.raw).map(normalizeItem);
    ensureFallbackShell();

    populateSelect(
      qs(["#category-filter", "#filter-category", '[data-filter="category"]']),
      uniqueValues(state.items, "category"),
      "All categories",
      state.category
    );
    populateSelect(
      qs(["#status-filter", "#filter-status", '[data-filter="status"]']),
      uniqueValues(state.items, "status"),
      "All statuses",
      state.status
    );

    bindEvents();
    render();
    window.__DASHBOARD_STATE__ = state;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();