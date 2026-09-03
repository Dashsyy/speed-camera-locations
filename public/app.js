(() => {
  const TAG_CATEGORIES = [
    { key: "new", label: "ថ្មី", match: (t) => t === "ថ្មី", cls: "tag-new" },
    { key: "dir", label: "ទៅ/ត្រឡប់", match: (t) => t === "ទៅ" || t === "ត្រឡប់", cls: "tag-dir" },
    { key: "limit", label: "ល្បឿនកំណត់", match: (t) => /\/h$/i.test(t), cls: "tag-limit" },
    { key: "check", label: "ឆែក", match: (t) => t === "ឆែក", cls: "tag-check" },
    { key: "auto", label: "Auto Camera", match: (t) => /auto/i.test(t), cls: "tag-auto" },
    { key: "stop", label: "ស្តុប/ចាប់ពន្ធ", match: (t) => t === "ស្តុប" || t === "ចាប់ពន្ធផ្លូវ", cls: "tag-stop" },
  ];

  function categoryFor(tag) {
    return TAG_CATEGORIES.find((c) => c.match(tag)) || null;
  }

  const state = {
    data: null,
    query: "",
    activeCats: new Set(),
    openRoads: new Set(),
  };

  const els = {
    roadList: document.getElementById("road-list"),
    emptyState: document.getElementById("empty-state"),
    search: document.getElementById("search"),
    clearSearch: document.getElementById("clear-search"),
    tagFilters: document.getElementById("tag-filters"),
    globalStats: document.getElementById("global-stats"),
    title: document.getElementById("page-title"),
    subtitle: document.getElementById("page-subtitle"),
    updatedNote: document.getElementById("updated-note"),
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function highlight(text, q) {
    const safe = escapeHtml(text ?? "");
    if (!q) return safe;
    const idx = safe.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return safe;
    return (
      safe.slice(0, idx) +
      "<mark>" + safe.slice(idx, idx + q.length) + "</mark>" +
      safe.slice(idx + q.length)
    );
  }

  function pointMatchesTagFilter(point) {
    if (state.activeCats.size === 0) return true;
    return point.tags.some((t) => {
      const cat = categoryFor(t);
      return cat && state.activeCats.has(cat.key);
    });
  }

  function textIncludes(haystack, q) {
    return haystack.toLowerCase().includes(q.toLowerCase());
  }

  function pointMatchesSearch(point, q) {
    if (!q) return true;
    const hay = [point.km || "", point.label || "", point.note || "", ...(point.tags || [])].join(" ");
    return textIncludes(hay, q);
  }

  function roadHeaderMatchesSearch(road, q) {
    if (!q) return true;
    const hay = [road.code, "NR" + road.code, road.route].join(" ");
    return textIncludes(hay, q);
  }

  function buildFilterChips() {
    els.tagFilters.innerHTML = "";
    TAG_CATEGORIES.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        if (state.activeCats.has(cat.key)) {
          state.activeCats.delete(cat.key);
        } else {
          state.activeCats.add(cat.key);
        }
        btn.classList.toggle("active");
        render();
      });
      els.tagFilters.appendChild(btn);
    });
  }

  function renderTag(tag, q) {
    const cat = categoryFor(tag);
    const cls = cat ? cat.cls : "tag-stop";
    return `<span class="tag ${cls}">${highlight(tag, q)}</span>`;
  }

  function renderPoint(point, q) {
    const km = point.km ? point.km : "—";
    const labelText = point.label && point.label.trim() ? point.label : "(មិនមានឈ្មោះទីតាំង)";
    const labelCls = point.label && point.label.trim() ? "point-label" : "point-label empty";
    const tagsHtml = (point.tags || []).map((t) => renderTag(t, q)).join("");
    const noteHtml = point.note ? `<div class="point-note muted" style="font-size:.75rem;margin-top:.2rem;">${highlight(point.note, q)}</div>` : "";
    return `
      <div class="point-row">
        <div class="point-km">${highlight(km, q)}<small>គ.ម</small></div>
        <div class="point-body">
          <div class="${labelCls}">${highlight(labelText, q)}</div>
          ${noteHtml}
          ${tagsHtml ? `<div class="point-tags">${tagsHtml}</div>` : ""}
        </div>
      </div>`;
  }

  function renderRoadCard(road, q) {
    const headerMatch = roadHeaderMatchesSearch(road, q);
    let points;
    if (headerMatch) {
      points = road.points.filter(pointMatchesTagFilter);
    } else {
      points = road.points.filter((p) => pointMatchesTagFilter(p) && pointMatchesSearch(p, q));
    }

    const hasSearchOrFilter = q || state.activeCats.size > 0;
    if (hasSearchOrFilter && points.length === 0) return null;

    const isOpen = state.openRoads.has(road.code) || Boolean(q) || state.activeCats.size > 0;
    const card = document.createElement("div");
    card.className = "road-card" + (isOpen ? " open" : "");
    card.dataset.code = road.code;

    const pointsHtml = points.length
      ? points.map((p) => renderPoint(p, q)).join("")
      : `<div class="road-empty-note">មិនទាន់មានទិន្នន័យកាមេរ៉ាសម្រាប់ផ្លូវនេះនៅឡើយទេ។</div>`;

    card.innerHTML = `
      <div class="road-card-header">
        <div class="road-badge">NR${escapeHtml(road.code)}</div>
        <div class="road-heading">
          <div class="route">${highlight(road.route, q)}</div>
          <div class="meta">ប្រវែង ${road.length_km} គ.ម</div>
        </div>
        <div class="road-count">${points.length} ចំណុច</div>
        <div class="chevron">▶</div>
      </div>
      <div class="road-points">${pointsHtml}</div>
    `;

    card.querySelector(".road-card-header").addEventListener("click", () => {
      const nowOpen = card.classList.toggle("open");
      if (nowOpen) state.openRoads.add(road.code);
      else state.openRoads.delete(road.code);
    });

    return card;
  }

  function renderStats() {
    const roads = state.data.roads;
    const totalPoints = roads.reduce((sum, r) => sum + r.points.length, 0);
    const newPoints = roads.reduce(
      (sum, r) => sum + r.points.filter((p) => p.tags.includes("ថ្មី")).length,
      0
    );
    els.globalStats.innerHTML = `
      <span>ផ្លូវជាតិ <strong>${roads.length}</strong></span>
      <span>ចំណុច <strong>${totalPoints}</strong></span>
      <span>ថ្មី <strong>${newPoints}</strong></span>
    `;
  }

  function render() {
    const q = state.query.trim();
    els.roadList.innerHTML = "";
    let shown = 0;
    state.data.roads.forEach((road) => {
      const card = renderRoadCard(road, q);
      if (card) {
        els.roadList.appendChild(card);
        shown++;
      }
    });
    els.emptyState.hidden = shown !== 0;
    els.clearSearch.hidden = q.length === 0;
  }

  function init(data) {
    state.data = data;
    els.title.textContent = data.subtitle || data.title;
    els.subtitle.textContent = data.title;
    els.updatedNote.textContent = data.updated ? `ធ្វើបច្ចុប្បន្នភាពចុងក្រោយ: ${data.updated}` : "";
    buildFilterChips();
    renderStats();
    render();

    els.search.addEventListener("input", (e) => {
      state.query = e.target.value;
      render();
    });
    els.clearSearch.addEventListener("click", () => {
      state.query = "";
      els.search.value = "";
      els.search.focus();
      render();
    });
  }

  fetch("data.json")
    .then((res) => res.json())
    .then(init)
    .catch((err) => {
      els.roadList.innerHTML = `<div class="empty-state">មិនអាចផ្ទុកទិន្នន័យបានទេ៖ ${escapeHtml(err.message)}</div>`;
    });
})();
