/* =====================================================================
   app.js  -  everything the page DOES
   ---------------------------------------------------------------------
   Read it top to bottom - each numbered section is a small, separate job:

     1. Settings & shortcuts          7. Playback (play / pause / scrubber)
     2. Pages (home / app / my)       8. Saving (localStorage + Firebase)
     3. Examples gallery              9. My Visualizations page
     4. The code editor              10. Login button
     5. Running the code             11. Feedback email
     6. Drawing one step on screen   12. Start-up

   The Python "brain" lives in tracer.js. This file only calls
       CodeFlixTracer.trace(code)  ->  { steps, error, truncated }
   and then draws the result.
   ===================================================================== */
(function () {
  "use strict";

  /* ===================================================================
     1. SETTINGS & SHORTCUTS
     =================================================================== */
  const CFG = window.CODEFLIX_CONFIG || {};
  const MAX_LINES = CodeFlixTracer.LIMITS.maxLines;     // 30
  const MAX_STEPS = CodeFlixTracer.LIMITS.maxSteps;     // 600
  const EXAMPLES = window.CODEFLIX_EXAMPLES || [];
  const TRACERS = { python: window.CodeFlixTracer, c: window.CodeFlixC };   // one "brain" per language
  const LANG_NAME = { python: "Python", c: "C" };
  const PY_PLACEHOLDER = "# Paste or type Python here (max 30 lines)\ntotal = 0\nfor n in [1, 2, 3]:\n    total = total + n\nprint(total)";
  const C_PLACEHOLDER = "// Paste or type C here (max 30 lines)\n#include <stdio.h>\nint main() {\n    printf(\"Hi\\n\");\n    return 0;\n}";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // Safety first: any text typed by a user is escaped before it goes into HTML.
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  // The tracer writes `code` in backticks. Turn those into <code> tags.
  const noteToHtml = (note) => esc(note).replace(/`([^`]+)`/g, "<code>$1</code>");

  // The cloud module (cloud.js) may be missing or switched off - always have a safe fallback.
  const cloud = () => window.CodeFlixCloud || { enabled: false, onAuth() {}, ready: Promise.resolve() };

  // Optional Google Analytics events (does nothing if analytics is off).
  const track = (name, data) => { try { if (window.gtag) window.gtag("event", name, data || {}); } catch (e) { /* ignore */ } };

  // Everything that changes while the app runs lives in this one object.
  const state = {
    page: null,
    lang: "python",       // "python" or "c"
    steps: [],            // the recorded movie
    index: 0,             // which step we are showing
    playing: false, timer: null, speed: 1,
    ranCode: null,        // the code that produced `steps`
    error: null, truncated: false,
    user: null,           // the signed-in user (or null)
    profile: null,        // extra details from the Profile page (or null)
    currentId: null,      // id of the saved item we are editing (or null)
    currentWhere: null,   // "cloud" or "local"
    savedCode: ""         // code at the last save / load
  };

  const el = {
    code: $("#code"), hl: $("#hlLayer"), gutter: $("#gutterInner"), codeWrap: $("#codeWrap"), runBar: $("#runBar"), errBar: $("#errBar"),
    counter: $("#lineCounter"), stale: $("#staleHint"), title: $("#titleInput"),
    vars: $("#vars"), scope: $("#scopeChip"), stack: $("#stack"), output: $("#output"),
    narration: $("#narration"), scrubber: $("#scrubber"), stepCount: $("#stepCount"), limitNote: $("#limitNote"),
    first: $("#firstBtn"), prev: $("#prevBtn"), play: $("#playBtn"), next: $("#nextBtn"), speed: $("#speedSelect"),
    run: $("#runBtn"), save: $("#saveBtn"), clear: $("#clearBtn"), exSelect: $("#exampleSelect")
  };

  // A small pop-up message at the bottom of the screen.
  let toastTimer = null;
  function toast(message) {
    const t = $("#toast");
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  /* ===================================================================
     2. PAGES  (home / app / my) - chosen by the part after # in the URL
     =================================================================== */
  function showPage(name) {
    $$(".page").forEach((p) => { p.hidden = p.dataset.page !== name; });
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    state.page = name;
    if (name !== "app") pause();
    if (name === "my") renderMy();
    if (name === "profile") renderProfile();
    if (name === "app") syncEditor();
    window.scrollTo(0, 0);
  }

  function route() {
    const hash = location.hash.replace(/^#\/?/, "");        // "", "app", "my", "examples"
    $("#navLinks").classList.remove("open");
    $("#burger").setAttribute("aria-expanded", "false");
    if (hash === "app" || hash === "my" || hash === "profile") {
      if (state.page !== hash) showPage(hash);
    } else {
      if (state.page !== "home") showPage("home");
      if (hash === "examples") $("#examples").scrollIntoView({ behavior: "smooth" });
    }
  }

  // Go to a page right now (used after clicking an example, etc.)
  function navigate(name) {
    const target = name === "home" ? "#/" : "#/" + name;
    if (location.hash !== target) history.pushState(null, "", target);
    route();
  }

  /* ===================================================================
     3. EXAMPLES GALLERY
     =================================================================== */
  let galleryLang = "python";
  const cardsFor = (lang) => EXAMPLES.filter((ex) => (ex.lang || "python") === lang);
  function renderGallery() {
    $$("#galleryTabs button").forEach((b) => b.classList.toggle("active", b.dataset.lang === galleryLang));
    $("#gallery").innerHTML = cardsFor(galleryLang).map((ex) => `
      <button class="card ex-card" type="button" data-example="${esc(ex.id)}">
        <div class="tags">${ex.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        <h3>${esc(ex.title)}</h3>
        <p>${esc(ex.blurb)}</p>
        <span class="go">&#9654; Load &amp; watch</span>
      </button>`).join("");
  }
  function fillExampleSelect() {                       // the "Load example..." drop-down shows the current language only
    el.exSelect.innerHTML = `<option value="">Load ${LANG_NAME[state.lang]} example&hellip;</option>` +
      cardsFor(state.lang).map((ex) => `<option value="${esc(ex.id)}">${esc(ex.title)}</option>`).join("");
  }
  function buildGallery() { renderGallery(); fillExampleSelect(); }

  function loadExample(id) {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setLang(ex.lang || "python");
    el.code.value = ex.code;
    el.title.value = ex.title;
    state.currentId = null; state.currentWhere = null; state.savedCode = "";
    navigate("app");
    runCode({ autoplay: true });
    track("load_example", { example_id: id });
  }

  /* ===================================================================
     4. THE CODE EDITOR
     A <textarea> + a column of line numbers + coloured bars that sit
     BEHIND the text to highlight the running line (yellow) or an error (red).
     =================================================================== */
  function codeLineCount() {
    const trimmed = el.code.value.replace(/\s+$/, "");
    return trimmed === "" ? 0 : trimmed.split("\n").length;
  }

  function placeBar(bar, line) {
    if (!line) { bar.hidden = true; return; }
    const cs = getComputedStyle(el.code);
    const lh = parseFloat(cs.lineHeight) || 24, pad = parseFloat(cs.paddingTop) || 12;
    bar.hidden = false;
    bar.style.top = (pad + (line - 1) * lh - el.code.scrollTop) + "px";
  }

  // ---- Syntax colours: turn code into <span class="tk-..."> pieces (shown under the textarea) ----
  const PY_KEYWORDS = new Set(["if", "elif", "else", "while", "for", "in", "def", "return", "break", "continue", "pass", "and", "or", "not"]);
  const PY_BUILTINS = new Set(["print", "len", "range", "int", "float", "str", "bool", "abs", "min", "max", "sum", "round", "list", "sorted", "input"]);
  const PY_CONSTS = new Set(["True", "False", "None"]);
  function colorizePython(code) {
    const re = /(#[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(\d+\.?\d*)|([A-Za-z_]\w*)|([\s\S])/g;
    let out = "", m, afterDef = false;
    while ((m = re.exec(code))) {
      if (m[1]) out += `<span class="tk-m">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
      else if (m[4]) {
        const w = m[4];
        let cls = "";
        if (afterDef) cls = "tk-f";
        else if (PY_KEYWORDS.has(w)) cls = "tk-k";
        else if (PY_CONSTS.has(w)) cls = "tk-c";
        else if (PY_BUILTINS.has(w)) cls = "tk-b";
        out += cls ? `<span class="${cls}">${w}</span>` : w;
        afterDef = w === "def";
      } else { out += esc(m[5]); if (m[5] !== " ") afterDef = false; }
    }
    return out + "\n ";                                   // extra line keeps heights equal to the textarea
  }

  const C_KEYWORDS = new Set(["if", "else", "while", "do", "for", "return", "break", "continue", "sizeof"]);
  const C_TYPES = new Set(["int", "long", "short", "char", "float", "double", "void", "unsigned", "signed", "const", "static"]);
  function colorizeC(code) {
    // comment | #include line | "string" or 'c' | number | word | any single character
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(#[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlLuU]*)|([A-Za-z_]\w*)|([\s\S])/g;
    let out = "", m;
    while ((m = re.exec(code))) {
      if (m[1]) out += `<span class="tk-m">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-c">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-s">${esc(m[3])}</span>`;
      else if (m[4]) out += `<span class="tk-n">${m[4]}</span>`;
      else if (m[5]) {
        const w = m[5];
        const isCall = /^\s*\(/.test(code.slice(re.lastIndex, re.lastIndex + 12));
        const cls = C_KEYWORDS.has(w) ? "tk-k" : C_TYPES.has(w) ? "tk-b" : isCall ? "tk-f" : "";
        out += cls ? `<span class="${cls}">${w}</span>` : w;
      } else out += esc(m[6]);
    }
    return out + "\n ";
  }
  function colorize(code) { return state.lang === "c" ? colorizeC(code) : colorizePython(code); }

  // Switch the editor between Python and C (labels, colours, example list, auto-closing { }).
  function setLang(lang) {
    if (!TRACERS[lang]) lang = "python";
    state.lang = lang;
    $("#langSelect").value = lang;
    $("#codeTitle").textContent = `Your ${LANG_NAME[lang]} code`;
    el.code.placeholder = lang === "c" ? C_PLACEHOLDER : PY_PLACEHOLDER;
    fillExampleSelect();
    syncEditor();
  }

  // Keep line numbers and bars lined up with the text (called on every edit and scroll).
  let curLine = null, errLine = null;
  function syncEditor() {
    // coloured copy of the code; the inner <code> is moved (not the clipped <pre>) so it follows the textarea scroll
    el.hl.innerHTML = `<code style="display:block;transform:translate(${-el.code.scrollLeft}px,${-el.code.scrollTop}px)">${colorize(el.code.value)}</code>`;
    const total = Math.min(Math.max(el.code.value.split("\n").length, 1), 1000);
    let nums = "";
    for (let i = 1; i <= total; i++) {
      const active = i === curLine;
      const error = i === errLine;
      nums += `<div class="gutter-line${active ? " active" : ""}${error ? " error" : ""}"><span class="line-arrow">${active ? "➜" : error ? "!" : "·"}</span><span>${i}</span></div>`;
    }
    el.gutter.innerHTML = nums;
    el.gutter.style.transform = `translateY(${-el.code.scrollTop}px)`;
    placeBar(el.runBar, curLine);
    placeBar(el.errBar, errLine);

    const n = codeLineCount();
    el.counter.textContent = `${n} / ${MAX_LINES} lines`;
    el.counter.classList.toggle("bad", n > MAX_LINES);
    el.stale.hidden = !(state.ranCode !== null && el.code.value !== state.ranCode);
  }

  function highlight(line, isError) {
    curLine = isError ? null : line;
    errLine = isError ? line : null;
    placeBar(el.runBar, curLine);
    placeBar(el.errBar, errLine);
    // scroll the editor so the highlighted line stays visible
    if (line) {
      const lh = parseFloat(getComputedStyle(el.code).lineHeight) || 24;
      const top = (line - 1) * lh;
      if (top < el.code.scrollTop || top + lh * 2 > el.code.scrollTop + el.code.clientHeight) {
        el.code.scrollTop = Math.max(0, top - el.code.clientHeight / 2);
      }
    }
  }

  // Insert text at the cursor in a way that keeps Ctrl+Z working.
  function insertText(text) {
    el.code.focus();
    if (!document.execCommand("insertText", false, text)) {
      el.code.setRangeText(text, el.code.selectionStart, el.code.selectionEnd, "end");
      el.code.dispatchEvent(new Event("input"));
    }
  }

  let tabEscape = false;                                   // press Esc, then Tab, to leave the editor
  el.code.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { tabEscape = true; return; }
    if (e.key === "Tab" && !e.shiftKey && !tabEscape) { e.preventDefault(); insertText("    "); return; }
    tabEscape = false;

    // Auto-close brackets and quotes:  typing ( gives ()  - typing ) next to ) just moves over it.
    const PAIRS = { "(": ")", "[": "]", '"': '"', "'": "'" };
    if (state.lang === "c") PAIRS["{"] = "}";
    const t = el.code, pos = t.selectionStart, nextCh = t.value[pos], prevCh = t.value[pos - 1] || "";
    if (!e.ctrlKey && !e.metaKey && !e.altKey && t.selectionStart === t.selectionEnd) {
      if ((")]\"'" + (state.lang === "c" ? "}" : "")).includes(e.key) && nextCh === e.key) { e.preventDefault(); t.setSelectionRange(pos + 1, pos + 1); return; }
      if (PAIRS[e.key] && !(e.key === '"' || e.key === "'") || ((e.key === '"' || e.key === "'") && !/\w/.test(prevCh) && !/\w/.test(nextCh || " "))) {
        e.preventDefault(); insertText(e.key + PAIRS[e.key]); t.setSelectionRange(pos + 1, pos + 1); return;
      }
      if (e.key === "Backspace" && PAIRS[prevCh] === nextCh && nextCh) {            // delete both halves of an empty pair
        e.preventDefault(); t.setSelectionRange(pos - 1, pos + 1); insertText(""); return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {        // auto-indent
      const before = el.code.value.slice(0, el.code.selectionStart);
      const lineText = before.slice(before.lastIndexOf("\n") + 1);
      const indent = lineText.match(/^ */)[0];
      const extra = (state.lang === "c" ? /\{\s*$/ : /:\s*$/).test(lineText) ? "    " : "";
      e.preventDefault();
      if (state.lang === "c" && extra && el.code.value[el.code.selectionStart] === "}") {   // Enter between { and }
        insertText("\n" + indent + extra + "\n" + indent);
        const p = el.code.selectionStart - indent.length - 1; el.code.setSelectionRange(p, p);
      } else insertText("\n" + indent + extra);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCode({ autoplay: true }); }   // Ctrl+Enter = Run
  });
  el.code.addEventListener("blur", () => { tabEscape = false; });

  let scrollTimer = null;
  el.code.addEventListener("scroll", () => {
    el.codeWrap.classList.add("scrolling");                // no sliding animation while scrolling by hand
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => el.codeWrap.classList.remove("scrolling"), 120);
    syncEditor();
  });

  let draftTimer = null;
  el.code.addEventListener("input", () => {
    syncEditor();
    clearTimeout(draftTimer);                              // remember unsaved work if the tab is closed
    draftTimer = setTimeout(saveDraft, 400);
  });
  el.title.addEventListener("input", () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); });

  const DRAFT_KEY = "codeflix.draft";
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ code: el.code.value, title: el.title.value, lang: state.lang })); } catch (e) { /* storage may be blocked */ } }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { return null; } }

  /* ===================================================================
     5. RUNNING THE CODE
     =================================================================== */
  function runCode(opts) {
    opts = opts || {};
    pause();
    const code = el.code.value;
    const result = TRACERS[state.lang].trace(code);        // <-- the one call into the tracer (Python or C)
    state.ranCode = code;
    state.steps = result.steps;
    state.error = result.error;
    state.truncated = result.truncated;
    state.index = 0;
    track("run_code", { lang: state.lang, steps: result.steps.length, ok: !result.error });

    if (!result.steps.length) { showFatalError(result.error); return; }     // e.g. a syntax error: nothing to play
    renderStep();
    updateLimitNote();
    if (opts.autoplay && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) play();
  }

  // Errors found BEFORE the program starts (syntax errors, too many lines...) show in the narration bar.
  function showFatalError(err) {
    const soft = err.kind === "TooLong" || err.kind === "Empty";
    const label = soft ? "Heads up" : err.kind;
    const where = err.line ? ` on line ${err.line}` : "";
    setNarration(`<span><b>${esc(label)}</b>${where}: ${esc(err.message)}</span>`, "error");
    el.vars.innerHTML = `<span class="empty">Nothing ran, so there are no variables.</span>`;
    el.stack.innerHTML = ""; el.output.innerHTML = `<span class="none">(no output)</span>`;
    el.scope.textContent = "main";
    highlight(err.line, true);
    vizFatal(err);
    setControls();
    updateLimitNote();
    syncEditor();
  }

  function updateLimitNote() {
    el.limitNote.hidden = !state.truncated;
    if (state.truncated) el.limitNote.textContent =
      `This program is long - CodeFlix stopped after ${MAX_STEPS} steps so your browser stays fast. (An endless loop is a common reason.)`;
  }

  /* ===================================================================
     6. DRAWING ONE STEP ON SCREEN
     =================================================================== */
  function setNarration(html, kind) {
    el.narration.className = "narration" + (kind ? " " + kind : "");
    el.narration.innerHTML = html;
    el.narration.style.animation = "none"; void el.narration.offsetWidth; el.narration.style.animation = "";   // replay fade
  }

  function renderVars(vars, prevStep, depth) {
    if (!vars.length) { el.vars.innerHTML = `<span class="empty">No variables yet.</span>`; return; }
    const was = {};
    if (prevStep && prevStep.stack.length === depth) prevStep.vars.forEach((v) => { was[v.name] = v; });
    el.vars.innerHTML = vars.map((v) => {
      let body;
      if (v.items) {
        body = v.items.length
          ? `<div class="cells">${v.items.map((t, i) => `<div class="cell${v.changedItems && v.changedItems[i] ? " changed" : ""}"><span class="val">${esc(t)}</span><span class="idx">${i}</span></div>`).join("")}</div>`
          : `<div class="var-val muted">[ ] (empty)</div>`;
      } else {
        const p = was[v.name];
        const old = v.changed && p && !p.items && p.text !== v.text ? `<span class="var-was">was ${esc(p.text)}</span>` : "";
        body = `<div class="var-val">${esc(v.text)}${old}</div>`;
      }
      return `<div class="var${v.changed ? " changed" : ""}" data-type="${esc(v.type)}"><div class="var-top"><span class="var-name">${esc(v.name)}</span><span class="var-type">${esc(v.type)}</span></div>${body}</div>`;
    }).join("");
  }

  function renderStack(stack) {
    // newest call on top
    if (!stack.length) { el.stack.innerHTML = `<span class="empty">The stack is empty.</span>`; return; }
    el.stack.innerHTML = stack.slice().reverse().map((f, i) => {
      const depth = stack.length - i;
      const label = f.name === "main" ? "main <small>(the program)</small>" : `${esc(f.name)}(${esc(f.args)})`;
      const line = f.line ? `<small>line ${f.line}</small>` : "";
      return `<div class="frame${i === 0 ? " top" : ""}"><span class="fr-no">${depth}</span><span class="fr-name">${label}</span>${f.name === "main" ? "" : line}${i === 0 ? `<em class="fr-tag">active</em>` : ""}</div>`;
    }).join("");
  }

  /* ---------- 6a. LIVE VISUALIZER ----------
     Each recorded step is "understood" once (analyzeStep): is it an assignment, a loop turn,
     a decision, a function call...?  Then drawScene() paints a picture for that kind of step
     and the trace log underneath prints one line of text per step as the program runs. */
  const KINDS = {
    ready:     { label: "Ready",     icon: "▶" },
    assign:    { label: "Assign",    icon: "=" },
    update:    { label: "Update",    icon: "▦" },
    loop:      { label: "Loop",      icon: "↻" },
    condition: { label: "Condition", icon: "◆" },
    call:      { label: "Call",      icon: "↘" },
    "return":  { label: "Return",    icon: "↖" },
    define:    { label: "Define",    icon: "ƒ" },
    output:    { label: "Print",     icon: ">_" },
    "break":   { label: "Break",     icon: "✕" },
    done:      { label: "Done",      icon: "✓" },
    error:     { label: "Error",     icon: "!" }
  };
  const viz = {
    box: $(".area-viz"), stage: $("#vizStage"), stats: $("#vizStats"), log: $("#traceLog"),
    kind: $("#traceKind"), status: $("#vizStatus"), copy: $("#traceCopy")
  };
  const clip = (t, n) => { t = String(t); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const frameLabel = (f) => (!f ? "" : f.name === "main" ? "main()" : `${f.name}(${f.args || ""})`);
  const valueOf = (v) => (v.items ? "[" + v.items.join(", ") + "]" : v.text);

  function analyzeAll() {
    const steps = state.steps, lines = (state.ranCode || "").split("\n");
    const loops = {}, lastKey = {}, cum = { calls: 0, loops: 0, checks: 0, maxDepth: 1 };
    state.meta = steps.map((s, i) => {
      const prev = i > 0 ? steps[i - 1] : null;
      const note = String(s.note || ""), depth = s.stack.length, prevDepth = prev ? prev.stack.length : 1;
      const ticks = Array.from(note.matchAll(/`([^`]*)`/g), (x) => x[1]);
      const src = (lines[Math.max(0, (s.line || 1) - 1)] || "").trim();
      const sameFrame = prev && prev.stack.length === depth && prev.scope === s.scope;
      const was = {};
      if (sameFrame) prev.vars.forEach((v) => { was[v.name] = v; });
      const changes = s.vars.filter((v) => v.changed || (v.changedItems && v.changedItems.some(Boolean))).map((v) => {
        const p = was[v.name];
        return { name: v.name, type: v.type, to: valueOf(v), from: p ? valueOf(p) : null, items: v.items || null, changedItems: v.changedItems || null, isNew: !p };
      });

      let kind = "assign";
      if (s.error) kind = "error";
      else if (s.done) kind = "done";
      else if (depth > prevDepth || /^Call\b/.test(note)) kind = "call";
      else if (/^Return\b/.test(note)) kind = "return";
      else if (/^Define\b/.test(note)) kind = "define";
      else if (/jump out of the loop|^`?break/i.test(note)) kind = "break";
      else if (/^Print\b/.test(note)) kind = "output";
      else if (/^Loop:|^Start the loop|^Update\b|loop body|leave the loop|loop is finished|No items left|body again/i.test(note)) kind = "loop";
      else if (/^Check\b/.test(note)) kind = "condition";
      else if (/array item|list item|^Change\b/i.test(note)) kind = "update";

      const m = { i, kind, line: s.line, note, ticks, src, depth, changes, cond: null, result: null, exit: false, iter: 0,
        iterVar: null, iterVal: null, printed: "", callee: null, caller: null, retVal: null, defName: null, cum: null };
      const cm = note.match(/`([^`]*)`\s*->\s*(True|False)/i);
      if (cm) { m.cond = cm[1]; m.result = /true/i.test(cm[2]); cum.checks++; }
      if (kind === "loop") {
        const lm = note.match(/^Loop: `([^`]*)` takes the next value, `([^`]*)`/);
        if (lm) { m.iterVar = lm[1]; m.iterVal = lm[2]; }
        m.exit = /leave the loop|No items left|loop is finished/i.test(note);
        const key = s.line + ":" + depth;
        if (m.exit) { m.iter = loops[key] || 0; loops[key] = 0; }
        else { loops[key] = (loops[key] || 0) + 1; m.iter = loops[key]; cum.loops++; lastKey[depth] = key; }
      }
      if (kind === "break" && lastKey[depth]) loops[lastKey[depth]] = 0;
      if (kind === "call") { m.callee = s.stack[depth - 1]; m.caller = s.stack[depth - 2] || null; cum.calls++; }
      if (kind === "return") { m.retVal = ticks[0] != null ? ticks[0] : ""; m.callee = s.stack[depth - 1]; m.caller = s.stack[depth - 2] || null; }
      if (kind === "define") m.defName = ticks[0] || "";
      if (kind === "output") {
        const before = prev ? prev.output : "";
        m.printed = s.output.startsWith(before) ? s.output.slice(before.length) : s.output.split("\n").slice(-2).join("\n");
      }
      cum.maxDepth = Math.max(cum.maxDepth, depth);
      m.cum = { calls: cum.calls, loops: cum.loops, checks: cum.checks, maxDepth: cum.maxDepth };
      return m;
    });
    state.metaFor = steps;
  }

  // ----- small drawing helpers -----
  function cellsHtml(c) {
    return `<div class="cells">${c.items.map((t, i) => `<div class="cell${c.changedItems && c.changedItems[i] ? " changed" : ""}"><span class="val">${esc(clip(t, 8))}</span><span class="idx">${i}</span></div>`).join("")}</div>`;
  }
  function boxHtml(c) {
    const diff = c.from != null && c.from !== c.to;
    const body = c.items
      ? cellsHtml(c)
      : `<div class="vb-val">${diff ? `<s class="was">${esc(clip(c.from, 14))}</s><span class="vb-arrow">→</span>` : ""}<b>${esc(clip(c.to, 22))}</b></div>`;
    return `<div class="vbox${c.isNew ? " is-new" : ""}"><div class="vb-top"><span class="vb-name">${esc(c.name)}</span><span class="vb-type">${esc(c.type)}</span>${c.isNew ? `<em class="vb-flag">new</em>` : ""}</div>${body}</div>`;
  }
  const srcHtml = (m) => m.src ? `<div class="src-line"><span class="src-no">${m.line || ""}</span><code>${colorize(m.src).replace(/\n $/, "")}</code></div>` : "";
  const chipHtml = (label, value, cls) => `<span class="mini-chip${cls ? " " + cls : ""}"><small>${esc(label)}</small><b>${esc(value)}</b></span>`;

  function sceneBody(m) {
    switch (m.kind) {
      case "assign": case "update": {
        const boxes = m.changes.length ? m.changes.map(boxHtml).join("") : `<div class="vbox ghost"><div class="vb-val"><b>no value changed</b></div></div>`;
        return `<div class="flow"><div class="flow-node"><small>${m.kind === "update" ? "change item" : "evaluate"}</small><code>${esc(clip(m.src || m.ticks[0] || "", 46))}</code></div>
          <div class="wire" aria-hidden="true"><i></i></div><div class="flow-vars">${boxes}</div></div>`;
      }
      case "condition": {
        const t = m.result === true, f = m.result === false;
        return `<div class="decision">
          <div class="dec-node"><span class="dec-q">?</span><code>${esc(clip(m.cond || m.ticks[0] || "condition", 34))}</code></div>
          <div class="dec-wire" aria-hidden="true"></div>
          <div class="dec-branches">
            <div class="branch yes${t ? " taken" : f ? " skipped" : ""}"><b>TRUE</b><span>run the block</span></div>
            <div class="branch no${f ? " taken" : t ? " skipped" : ""}"><b>FALSE</b><span>skip / else</span></div>
          </div></div>`;
      }
      case "loop": {
        const core = m.exit ? `<small>done</small><b>✓</b>` : `<small>turn</small><b>${m.iter}</b>`;
        const info = [];
        if (m.iterVar) info.push(`<div class="li-row"><span>Takes next value</span><code>${esc(m.iterVar)} = ${esc(clip(m.iterVal, 18))}</code></div>`);
        if (m.cond) info.push(`<div class="li-row"><span>Check</span><code>${esc(clip(m.cond, 24))}</code><em class="${m.result ? "yes" : "no"}">${m.result ? "TRUE → run body" : "FALSE → leave"}</em></div>`);
        if (m.exit && !m.cond) info.push(`<div class="li-row"><span>No items left</span><em class="no">leave the loop</em></div>`);
        if (m.exit) info.push(`<div class="li-row"><span>Finished after</span><code>${m.iter} turn${m.iter === 1 ? "" : "s"}</code></div>`);
        if (m.changes.length) info.push(`<div class="li-vars">${m.changes.slice(0, 3).map(boxHtml).join("")}</div>`);
        return `<div class="loop-vis"><div class="ring${m.exit ? " exit" : ""}"><div class="ring-spin"></div><div class="ring-core">${core}</div></div><div class="loop-info">${info.join("")}</div></div>`;
      }
      case "call": {
        const params = m.changes.map((c) => chipHtml(c.name, c.to)).join("");
        return `<div class="callflow">
          <div class="frame-card caller"><small>caller</small><b>${esc(m.caller ? frameLabel(m.caller) : "main()")}</b></div>
          <div class="wire labeled" aria-hidden="true"><span>calls</span><i></i></div>
          <div class="frame-card callee"><small>new frame · depth ${m.depth}</small><b>${esc(frameLabel(m.callee))}</b>${params ? `<div class="params">${params}</div>` : ""}</div></div>`;
      }
      case "return": {
        const to = m.caller ? frameLabel(m.caller) : "the operating system";
        return `<div class="callflow">
          <div class="frame-card callee leaving"><small>finishing</small><b>${esc(frameLabel(m.callee))}</b></div>
          <div class="wire labeled back" aria-hidden="true"><span>returns</span><i></i></div>
          <div class="frame-card caller"><small>back in</small><b>${esc(to)}</b><div class="params">${chipHtml("value", m.retVal, "hot")}</div></div></div>`;
      }
      case "define":
        return `<div class="define"><div class="blueprint"><span class="bp-f">ƒ</span><div><b>${esc(m.defName || "function")}</b><small>saved in memory</small></div></div>
          <div class="define-tags">${chipHtml("status", "defined")}${chipHtml("code runs", "only when called")}</div></div>`;
      case "output": {
        const text = m.printed.replace(/\n$/, "") || "(empty line)";
        return `<div class="term"><div class="term-bar"><i></i><i></i><i></i><span>screen output</span></div><div class="term-body"><span class="prompt">$</span><span class="term-text">${esc(clip(text, 80))}</span><span class="caret"></span></div></div>`;
      }
      case "break":
        return `<div class="loop-vis"><div class="ring exit brk"><div class="ring-spin"></div><div class="ring-core"><small>exit</small><b>✕</b></div></div>
          <div class="loop-info"><div class="li-row"><span>break</span><em class="no">jump out of the loop now</em></div></div></div>`;
      case "done": {
        const s = state.steps[m.i], fin = s.vars.slice(0, 6).map((v) => chipHtml(v.name, clip(valueOf(v), 14))).join("");
        return `<div class="finale"><div class="check"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15 27l8 8 15-17"/></svg></div>
          <div class="finale-info"><b>Program finished</b><div class="finale-tags">${chipHtml("steps", String(state.steps.length))}${chipHtml("calls", String(m.cum.calls))}${chipHtml("loop turns", String(m.cum.loops))}</div>${fin ? `<div class="finale-vars">${fin}</div>` : ""}</div></div>`;
      }
      case "error":
        return `<div class="alert"><span class="alert-ico">!</span><div><b>The program stopped</b><p>${noteToHtml(m.note)}</p></div></div>`;
      default: return "";
    }
  }

  function headlineFor(m) {
    switch (m.kind) {
      case "assign": return "Store a value";
      case "update": return "Change an item";
      case "loop": return m.exit ? "Loop finished" : m.iterVar ? "Next item in the loop" : "Loop · turn " + m.iter;
      case "condition": return m.result === true ? "Decision: TRUE" : m.result === false ? "Decision: FALSE" : "Decision point";
      case "call": return "Function call";
      case "return": return "Return from function";
      case "define": return "Define a function";
      case "output": return "Print to the screen";
      case "break": return "Break out of the loop";
      case "done": return "Run complete";
      case "error": return "Something went wrong";
      default: return "Step";
    }
  }

  function drawScene(m) {
    const k = KINDS[m.kind];
    viz.stage.innerHTML = `<div class="scene k-${m.kind}" data-kind="${m.kind}">
      <div class="scene-top"><span class="scene-badge"><b aria-hidden="true">${esc(k.icon)}</b>${k.label}</span><h3 class="scene-title">${esc(headlineFor(m))}</h3>${m.line ? `<span class="scene-line">line ${m.line}</span>` : ""}</div>
      ${m.kind === "done" || m.kind === "error" ? "" : srcHtml(m)}
      <div class="scene-body">${sceneBody(m)}</div></div>`;
    viz.kind.textContent = k.label;
    viz.kind.className = "chip chip-kind k-" + m.kind;
  }

  function drawStats(i, m, s) {
    const n = state.steps.length;
    const tiles = [["Step", `${i + 1}/${n}`], ["Line", s.line || "—"], ["Scope", s.scope === "main" ? "main" : s.scope + "()"],
      ["Depth", m.depth], ["Loop turns", m.cum.loops], ["Calls", m.cum.calls]];
    viz.stats.innerHTML = tiles.map(([k, v]) => `<div class="stat-tile"><small>${k}</small><b>${esc(v)}</b></div>`).join("");
  }

  function drawIdle() {
    viz.kind.textContent = "Ready"; viz.kind.className = "chip chip-kind k-ready";
    viz.stage.innerHTML = `<div class="scene k-ready idle"><div class="idle-art" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="idle-copy"><h3>Watch your code come alive</h3><p>Press <b>Run</b>. Every step is drawn here and printed in the trace log below.</p></div></div>`;
    viz.stats.innerHTML = ["Step", "Line", "Scope", "Depth", "Loop turns", "Calls"].map((k) => `<div class="stat-tile"><small>${k}</small><b>—</b></div>`).join("");
    logFor = null;
    viz.log.innerHTML = `<div class="log-head"><span class="prompt">$</span> codeflix trace <span class="dim">&mdash; waiting for you to press Run</span></div>`;
  }

  // ----- the trace log: one text line per step, printed as the program runs -----
  let logFor = null, logReach = -1, logIdx = -1;
  const fileName = () => "program." + (state.lang === "c" ? "c" : "py");
  function logHead() {
    const more = state.truncated ? ` <span class="warn">(stopped at ${MAX_STEPS} steps)</span>` : "";
    return `<div class="log-head"><span class="prompt">$</span> codeflix trace ${fileName()} <span class="dim">&mdash; ${state.steps.length} step${state.steps.length === 1 ? "" : "s"} recorded</span>${more}</div>`;
  }
  function logLine(i) {
    const s = state.steps[i], m = state.meta[i], k = KINDS[m.kind];
    const diffs = m.changes.slice(0, 3).map((c) =>
      `<span class="ln-diff">${esc(c.name)} ${c.from != null && c.from !== c.to ? esc(clip(c.from, 14)) + " → " : "= "}<b>${esc(clip(c.to, 20))}</b></span>`).join("");
    const out = m.printed ? `<span class="ln-out">▸ ${esc(clip(m.printed.replace(/\n+$/, "") || "(empty line)", 60))}</span>` : "";
    return `<div class="log-line k-${m.kind}" data-i="${i}"><span class="ln-no">${String(i + 1).padStart(3, "0")}</span><span class="ln-tag">${k.label}</span><span class="ln-at">${s.line ? "L" + s.line : "—"}</span>` +
      `<div class="ln-main"><span class="ln-msg">${noteToHtml(s.note)}</span>${diffs}${out}</div></div>`;
  }
  function drawLog() {
    const log = viz.log, idx = state.index;
    if (logFor !== state.steps) { log.innerHTML = logHead(); logFor = state.steps; logReach = -1; logIdx = -1; }
    if (idx > logReach) {
      let html = "";
      for (let i = logReach + 1; i <= idx; i++) html += logLine(i);
      log.insertAdjacentHTML("beforeend", html);
      logReach = idx;
    }
    const rows = log.querySelectorAll(".log-line");
    const lo = logIdx < 0 ? 0 : Math.min(logIdx, idx), hi = Math.min(logReach, logIdx < 0 ? idx : Math.max(logIdx, idx));
    for (let i = lo; i <= hi; i++) {
      if (!rows[i]) continue;
      rows[i].classList.toggle("ahead", i > idx);
      rows[i].classList.toggle("current", i === idx);
    }
    logIdx = idx;
    const cur = rows[idx];
    if (cur) {                                             // keep the newest line in view
      const top = cur.offsetTop, bottom = top + cur.offsetHeight;
      if (bottom > log.scrollTop + log.clientHeight - 6) log.scrollTop = bottom - log.clientHeight + 10;
      else if (top < log.scrollTop) log.scrollTop = Math.max(0, top - 6);
    }
  }
  viz.log.addEventListener("click", (e) => {
    const row = e.target.closest(".log-line");
    if (row && state.steps.length) { pause(); goTo(Number(row.dataset.i)); }
  });
  viz.copy.addEventListener("click", () => {
    if (!state.steps.length) { toast("Run your code first - then you can copy the trace."); return; }
    const text = [`$ codeflix trace ${fileName()}`].concat(state.steps.slice(0, state.index + 1).map((s, i) => {
      const m = state.meta[i], d = m.changes.map((c) => `${c.name}=${c.to}`).join(", ");
      return `${String(i + 1).padStart(3, "0")} [${KINDS[m.kind].label.toUpperCase()}] ${s.line ? "L" + s.line : "--"}  ${String(s.note).replace(/`/g, "")}${d ? "  {" + d + "}" : ""}${m.printed ? "  -> " + m.printed.trim() : ""}`;
    })).join("\n");
    const ok = () => toast("Trace copied to the clipboard."), no = () => toast("Your browser blocked copying.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, no); else no();
  });

  // Errors found before the program starts (syntax errors...) also appear in the visualizer + log.
  function vizFatal(err) {
    const label = err.kind === "TooLong" || err.kind === "Empty" ? "Heads up" : err.kind;
    const note = `${label}${err.line ? " on line " + err.line : ""}: ${err.message}`;
    viz.stage.innerHTML = `<div class="scene k-error"><div class="scene-top"><span class="scene-badge"><b>!</b>Error</span><h3 class="scene-title">Nothing ran</h3>${err.line ? `<span class="scene-line">line ${err.line}</span>` : ""}</div>
      <div class="scene-body"><div class="alert"><span class="alert-ico">!</span><div><b>${esc(label)}</b><p>${esc(err.message)}</p></div></div></div></div>`;
    viz.kind.textContent = "Error"; viz.kind.className = "chip chip-kind k-error";
    viz.stats.innerHTML = ["Step", "Line", "Scope", "Depth", "Loop turns", "Calls"].map((k) => `<div class="stat-tile"><small>${k}</small><b>${k === "Line" && err.line ? err.line : "—"}</b></div>`).join("");
    logFor = null;
    viz.log.innerHTML = `<div class="log-head"><span class="prompt">$</span> codeflix trace ${fileName()}</div><div class="log-line k-error current"><span class="ln-no">---</span><span class="ln-tag">Error</span><span class="ln-at">${err.line ? "L" + err.line : "—"}</span><div class="ln-main"><span class="ln-msg">${esc(note)}</span></div></div>`;
  }

  function renderTraceVisual() {
    if (state.metaFor !== state.steps) analyzeAll();
    const i = state.index, m = state.meta[i], s = state.steps[i];
    drawScene(m); drawStats(i, m, s); drawLog();
  }

  // Idle / Running / Paused / Finished / Error  (the pulsing dot and chip colours follow this)
  function setStatus() {
    const n = state.steps.length, last = state.steps[n - 1];
    let st = "idle", label = "Idle";
    if (!n) { if (state.error) { st = "error"; label = "Error"; } }
    else if (state.playing) { st = "running"; label = "Running"; }
    else if (state.index >= n - 1 && last && last.error) { st = "error"; label = "Error"; }
    else if (state.index >= n - 1 && last && (last.done || !state.truncated)) { st = "done"; label = "Finished"; }
    else { st = "paused"; label = "Paused"; }
    viz.box.dataset.status = st;
    viz.status.textContent = label;
  }

  function renderStep() {
    const n = state.steps.length;
    if (!n) return;
    const s = state.steps[state.index];

    if (s.error) setNarration(`<span>&#9888;&#65039; ${noteToHtml(s.note)}</span>`, "error");
    else if (s.done) setNarration(`<span>&#10003; ${noteToHtml(s.note)}</span>`, "done");
    else setNarration(`<span>${noteToHtml(s.note)}</span>`);

    highlight(s.line, !!s.error);
    renderTraceVisual();
    renderVars(s.vars, state.index > 0 ? state.steps[state.index - 1] : null, s.stack.length);
    renderStack(s.stack);
    el.scope.textContent = s.scope === "main" ? "main" : "inside " + s.scope + "()";
    el.output.innerHTML = s.output ? esc(s.output) : `<span class="none">(nothing printed yet)</span>`;
    el.output.scrollTop = el.output.scrollHeight;
    setControls();
    syncEditor();
  }

  function setControls() {
    const n = state.steps.length, last = n - 1;
    el.scrubber.disabled = !n;
    el.scrubber.max = Math.max(last, 0);
    el.scrubber.value = state.index;
    el.scrubber.style.setProperty("--pct", last > 0 ? (state.index / last) * 100 + "%" : "0%");
    el.stepCount.textContent = n ? `Step ${state.index + 1} / ${n}` : "Step 0 / 0";
    el.first.disabled = el.prev.disabled = !n || state.index === 0;
    el.next.disabled = !n || state.index >= last;
    el.play.disabled = !n;
    el.play.innerHTML = state.playing ? "&#10074;&#10074;" : "&#9654;";
    el.play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
    setStatus();
  }

  /* ===================================================================
     7. PLAYBACK
     =================================================================== */
  function goTo(i) {
    state.index = Math.max(0, Math.min(i, state.steps.length - 1));
    renderStep();
  }
  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (state.index < state.steps.length - 1) { goTo(state.index + 1); schedule(); } else pause();
    }, 950 / state.speed);
  }
  function play() {
    if (!state.steps.length) return;
    if (state.index >= state.steps.length - 1) goTo(0);     // finished? start over
    state.playing = true;
    setControls();
    schedule();
  }
  function pause() {
    clearTimeout(state.timer);
    if (state.playing) { state.playing = false; setControls(); }
  }

  el.play.addEventListener("click", () => (state.playing ? pause() : play()));
  el.next.addEventListener("click", () => { pause(); goTo(state.index + 1); });
  el.prev.addEventListener("click", () => { pause(); goTo(state.index - 1); });
  el.first.addEventListener("click", () => { pause(); goTo(0); });
  el.scrubber.addEventListener("input", () => { pause(); goTo(Number(el.scrubber.value)); });
  el.speed.addEventListener("change", () => { state.speed = Number(el.speed.value); if (state.playing) schedule(); });
  el.run.addEventListener("click", () => runCode({ autoplay: true }));

  // Keyboard: space = play/pause, arrows = step. (Ignored while typing.)
  document.addEventListener("keydown", (e) => {
    if (state.page !== "app" || e.target.closest("textarea, input, select, button, a, dialog")) return;
    if (e.key === " ") { e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === "ArrowRight") { pause(); goTo(state.index + 1); }
    else if (e.key === "ArrowLeft") { pause(); goTo(state.index - 1); }
  });

  /* ===================================================================
     8. SAVING
     Not signed in -> localStorage (this browser only).
     Signed in     -> Firestore through cloud.js (any device).
     A saved item looks like:
        { id, title, code, steps, stepCount, updatedAt }
     `steps` is the movie, squeezed into a short text string so it fits.
     =================================================================== */
  const LS_KEY = "codeflix.saved.v1";
  const Local = {
    all() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } },
    write(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); },
    list() { return this.all().sort((a, b) => b.updatedAt - a.updatedAt); },
    save(item) {
      const list = this.all();
      const saved = Object.assign({}, item, { id: item.id || "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), updatedAt: Date.now() });
      const at = list.findIndex((x) => x.id === saved.id);
      if (at >= 0) list[at] = saved; else list.push(saved);
      try { this.write(list); }
      catch (e) {                                          // storage full: keep the code, drop the movie
        saved.steps = null;
        if (at >= 0) list[at] = saved; else list[list.length - 1] = saved;
        this.write(list);
      }
      return saved;
    },
    remove(id) { this.write(this.all().filter((x) => x.id !== id)); }
  };

  // ---- squeeze / unsqueeze the steps (gzip + base64 where the browser supports it) ----
  async function packSteps(steps) {
    if (!steps || !steps.length) return null;
    const json = JSON.stringify(steps);
    if (!window.CompressionStream) return json.length < 800000 ? "raw:" + json : null;
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const out = "gz:" + btoa(bin);
    return out.length < 900000 ? out : null;               // Firestore documents must stay under 1 MB
  }
  async function unpackSteps(text) {
    try {
      if (!text) return null;
      let json;
      if (text.startsWith("raw:")) json = text.slice(4);
      else if (text.startsWith("gz:")) {
        const bin = atob(text.slice(3));
        const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        json = await new Response(stream).text();
      } else return null;
      const steps = JSON.parse(json);
      const ok = Array.isArray(steps) && steps.length && steps.every((s) => s && Array.isArray(s.vars) && Array.isArray(s.stack) && typeof s.note === "string");
      return ok ? steps : null;
    } catch (e) { return null; }
  }

  const usingCloud = () => !!(state.user && cloud().enabled);

  async function saveCurrent() {
    const code = el.code.value;
    if (!code.trim()) { toast("Write some code first, then save."); return; }
    if (code !== state.ranCode) runCode({ autoplay: false });          // make sure the movie matches the code
    const where = usingCloud() ? "cloud" : "local";
    const item = {
      id: state.currentWhere === where ? state.currentId : null,        // same place -> update, otherwise new copy
      title: el.title.value.trim() || "Untitled visualization",
      code, lang: state.lang, steps: await packSteps(state.steps), stepCount: state.steps.length
    };
    try {
      const saved = where === "cloud" ? await cloud().save(item) : Local.save(item);
      state.currentId = saved.id; state.currentWhere = where; state.savedCode = code;
      el.title.value = saved.title;
      toast(where === "cloud" ? "Saved to your account." : "Saved on this device. Sign in with Google to keep it in your account.");
      track("save_visualization", { where });
    } catch (err) {
      console.error(err);
      toast("Could not save: " + (err.message || "unknown error") + ". Your code is still in the editor.");
    }
  }

  async function openItem(item, where) {
    setLang(item.lang || "python");
    el.code.value = item.code || "";
    el.title.value = item.title || "";
    state.currentId = item.id; state.currentWhere = where; state.savedCode = item.code || "";
    saveDraft();
    navigate("app");
    const steps = await unpackSteps(item.steps);
    if (steps) {                                           // use the saved movie
      const last = steps[steps.length - 1];
      state.steps = steps; state.ranCode = el.code.value; state.index = 0;
      state.error = last.error ? { kind: "Error", message: last.note, line: last.line } : null;
      state.truncated = !last.done && !last.error;
      renderStep(); updateLimitNote();
    } else {
      runCode({ autoplay: false });                        // no saved movie? make a fresh one
    }
  }

  el.save.addEventListener("click", saveCurrent);
  el.clear.addEventListener("click", () => {
    if (el.code.value.trim() && el.code.value !== state.savedCode && !confirm("Clear the editor? Unsaved code will be lost.")) return;
    pause();
    el.code.value = ""; el.title.value = "";
    state.currentId = null; state.currentWhere = null; state.savedCode = ""; state.steps = []; state.ranCode = null; state.error = null; state.truncated = false; state.index = 0;
    curLine = errLine = null;
    el.vars.innerHTML = ""; el.stack.innerHTML = ""; el.output.innerHTML = "";
    state.meta = null; state.metaFor = null; drawIdle();
    setNarration("<span>Press <b>Run</b> to start the movie.</span>");
    setControls(); updateLimitNote(); syncEditor(); saveDraft();
    el.code.focus();
  });
  el.exSelect.addEventListener("change", () => { if (el.exSelect.value) loadExample(el.exSelect.value); el.exSelect.value = ""; });

  // Changing language swaps the editor to a starter example of that language.
  $("#langSelect").addEventListener("change", () => {
    const want = $("#langSelect").value, code = el.code.value;
    const stock = EXAMPLES.some((e) => e.code === code);
    if (code.trim() && !stock && code !== state.savedCode && !confirm(`Switch to ${LANG_NAME[want]}? The code in the editor will be replaced by a starter example.`)) {
      $("#langSelect").value = state.lang; return;
    }
    const starter = cardsFor(want)[0];
    pause();
    setLang(want);
    el.code.value = starter.code; el.title.value = starter.title;
    state.currentId = null; state.currentWhere = null; state.savedCode = "";
    runCode({ autoplay: false });
    saveDraft();
  });
  $("#galleryTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lang]");
    if (b) { galleryLang = b.dataset.lang; renderGallery(); }
  });

  /* ===================================================================
     9. MY VISUALIZATIONS PAGE
     =================================================================== */
  let myItems = [];
  async function renderMy() {
    const list = $("#myList"), banner = $("#myBanner"), where = $("#myWhere");
    const cloudOn = usingCloud();
    const localItems = Local.list();
    list.innerHTML = `<div class="empty-state">Loading&hellip;</div>`;
    banner.innerHTML = "";

    if (cloudOn) {
      where.textContent = `Saved in your CodeFlix account (${state.user.email}).`;
      if (localItems.length) banner.innerHTML = `<div class="banner"><span>You have ${localItems.length} visualization${localItems.length === 1 ? "" : "s"} saved on this device.</span>
        <button class="btn btn-primary btn-sm" id="importBtn" type="button">Move to my account</button></div>`;
    } else {
      where.textContent = "Saved on this device only.";
      if (cloud().enabled) banner.innerHTML = `<div class="banner"><span>Sign in with Google to keep your work on every device.</span>
        <button class="btn btn-primary btn-sm" id="bannerSignIn" type="button">Sign in with Google</button></div>`;
    }

    try { myItems = cloudOn ? await cloud().list() : localItems; }
    catch (err) {
      console.error(err);
      list.innerHTML = `<div class="empty-state">Could not load your account items (${esc(err.message || err)}).<br>Check the Firestore rules in the setup guide.</div>`;
      return;
    }
    if (state.page !== "my") return;
    if (!myItems.length) {
      list.innerHTML = `<div class="empty-state"><p><b>Nothing saved yet.</b></p><p>Open the visualizer, run some code and press <b>Save</b>.</p><a class="btn btn-primary" href="#/app">Open the visualizer</a></div>`;
      return;
    }
    list.innerHTML = myItems.map((it) => `
      <article class="card saved">
        <h3>${esc(it.title || "Untitled")}</h3>
        <div class="tags"><span class="tag">${(it.lang || "python") === "c" ? "C" : "Python"}</span></div>
        <pre>${esc((it.code || "").split("\n").slice(0, 5).join("\n"))}</pre>
        <div class="row"><span class="muted small">${it.updatedAt ? new Date(it.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}${it.stepCount ? " &middot; " + it.stepCount + " steps" : ""}</span></div>
        <div class="row">
          <button class="btn btn-primary btn-sm" type="button" data-act="open" data-id="${esc(it.id)}">&#9654; Open</button>
          <button class="btn btn-ghost btn-sm btn-danger" type="button" data-act="delete" data-id="${esc(it.id)}">Delete</button>
        </div>
      </article>`).join("");
  }

  $("#page-my").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "bannerSignIn") return handleSignIn();
    if (btn.id === "importBtn") {
      btn.disabled = true;
      try {
        for (const it of Local.list()) { await cloud().save(Object.assign({}, it, { id: null })); Local.remove(it.id); }
        toast("Moved to your account.");
      } catch (err) { toast("Could not move them: " + (err.message || err)); }
      return renderMy();
    }
    const it = myItems.find((x) => x.id === btn.dataset.id);
    if (!it) return;
    if (btn.dataset.act === "open") openItem(it, usingCloud() ? "cloud" : "local");
    if (btn.dataset.act === "delete" && confirm(`Delete "${it.title || "Untitled"}"? This cannot be undone.`)) {
      try {
        if (usingCloud()) await cloud().remove(it.id); else Local.remove(it.id);
        if (state.currentId === it.id) { state.currentId = null; state.currentWhere = null; }
        toast("Deleted.");
      } catch (err) { toast("Could not delete: " + (err.message || err)); }
      renderMy();
    }
  });

  /* ===================================================================
     10. LOGIN BUTTON
     =================================================================== */
  async function handleSignIn() {
    if (!cloud().enabled) { toast("Google login is not switched on yet. Your work is saved on this device."); return; }
    try { await cloud().signIn(); }
    catch (err) {
      console.error(err);
      toast(err.code === "auth/unauthorized-domain"
        ? "This website address is not allowed yet. Add it in Firebase > Authentication > Settings > Authorized domains."
        : "Sign-in failed: " + (err.message || err));
    }
  }

  function renderAuth(user) {
    state.user = user;
    const area = $("#authArea");
    if (user) {
      const shown = ((state.profile && state.profile.displayName) || user.name || "Student").split(" ")[0];
      area.innerHTML = `<a class="profile-link" href="#/profile" title="My profile" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:inherit">
          ${user.photo ? `<img class="avatar" src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">` : ""}
          <span class="user-name">${esc(shown)}</span></a>
        <button class="btn btn-ghost btn-sm" id="signOutBtn" type="button">Sign out</button>`;
      $("#signOutBtn").addEventListener("click", () => cloud().signOut());
      if (!state.profileLoaded) {                         // fetch the profile once per login
        state.profileLoaded = true;
        cloud().getProfile().then((p) => { state.profile = p; renderAuth(state.user); if (state.page === "profile") renderProfile(); }).catch(() => {});
      }
    } else {
      state.profile = null; state.profileLoaded = false;
      area.innerHTML = `<button class="btn btn-primary btn-sm" id="signInBtn" type="button">Sign in with Google</button>`;
      $("#signInBtn").addEventListener("click", handleSignIn);
    }
    if (state.currentWhere === "cloud" && !user) { state.currentId = null; state.currentWhere = null; }   // signed out: next save is a new local copy
    if (state.page === "my") renderMy();
  }

  /* ---- Profile page (needs login; stored at users/{uid}/profile/main) ---- */
  async function renderProfile() {
    const box = $("#profileBody");
    if (!state.user) {
      box.innerHTML = `<div class="card profile-card"><p><b>Sign in to create your profile.</b></p>
        <p class="muted">Your profile and saved visualizations follow you to any device.</p>
        <button class="btn btn-primary" id="profileSignIn" type="button">Sign in with Google</button></div>`;
      $("#profileSignIn").addEventListener("click", handleSignIn);
      return;
    }
    const u = state.user, p = state.profile || {};
    let count = "-";
    try { count = (await cloud().list()).length; } catch (e) { /* ignore */ }
    if (state.page !== "profile") return;
    const year = p.year || "";
    box.innerHTML = `<div class="card profile-card">
      <div class="profile-top">
        ${u.photo ? `<img class="avatar-lg" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar-lg"></span>`}
        <div><h3>${esc(p.displayName || u.name)}</h3><p>${esc(u.email || "")}</p></div>
      </div>
      <form id="profileForm" class="form-grid">
        <div class="full"><label for="pfName">Display name</label><input id="pfName" maxlength="60" value="${esc(p.displayName || u.name || "")}"></div>
        <div class="full"><label for="pfCollege">College</label><input id="pfCollege" maxlength="100" value="${esc(p.college || CFG.collegeName || "")}"></div>
        <div><label for="pfDept">Department</label><input id="pfDept" maxlength="60" placeholder="e.g. CSE" value="${esc(p.department || "")}"></div>
        <div><label for="pfYear">Year</label><select id="pfYear">${["", "1st year", "2nd year", "3rd year", "4th year", "Other"].map((y) => `<option${y === year ? " selected" : ""}>${y}</option>`).join("")}</select></div>
        <div class="full"><label for="pfRoll">Roll number (optional)</label><input id="pfRoll" maxlength="30" value="${esc(p.rollNo || "")}"></div>
        <div class="full"><button class="btn btn-primary" type="submit">Save profile</button></div>
      </form>
      <div class="stats"><div class="stat"><b>${count}</b><span class="muted small">Saved visualizations</span></div></div>
    </div>`;
    $("#profileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = { displayName: $("#pfName").value.trim(), college: $("#pfCollege").value.trim(), department: $("#pfDept").value.trim(), year: $("#pfYear").value, rollNo: $("#pfRoll").value.trim() };
      try { state.profile = await cloud().saveProfile(data); toast("Profile saved."); renderAuth(state.user); renderProfile(); }
      catch (err) { toast("Could not save profile: " + (err.message || err)); }
    });
  }

  /* ===================================================================
     11. FEEDBACK  (opens the student's email app - no server needed)
     =================================================================== */
  const dlg = $("#feedbackDialog");
  function openFeedback() { dlg.showModal(); $("#fbMsg").focus(); }
  $("#feedbackBtn").addEventListener("click", openFeedback);
  $("[data-open-feedback]").addEventListener("click", openFeedback);
  $("#fbCancel").addEventListener("click", () => dlg.close());
  $("#fbSend").addEventListener("click", () => {
    const admin = CFG.adminEmail || "";
    const msg = $("#fbMsg").value.trim();
    if (!msg) { toast("Please write a short message first."); return; }
    const subject = "CodeFlix feedback: " + $("#fbType").value;
    let code = $("#fbCode").checked && el.code.value.trim() ? "\n\n--- My code ---\n" + el.code.value : "";
    const build = () => `mailto:${admin}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg + code + "\n\n(Sent from " + location.href + ")")}`;
    let url = build();
    if (url.length > 1900) { code = ""; url = build(); }   // some email apps reject very long links
    location.href = url;
    dlg.close();
    toast(`If your email app did not open, write to ${admin}`);
    track("feedback_click");
  });

  /* ===================================================================
     12. START-UP
     =================================================================== */
  function init() {
    // Names from config.js
    $$("[data-college-name]").forEach((n) => { n.textContent = CFG.collegeName || "your college"; });
    // Hide the logo image if the file is missing
    const logo = $(".college-logo");
    logo.addEventListener("error", () => { logo.style.display = "none"; });

    $("#burger").addEventListener("click", () => {
      const open = $("#navLinks").classList.toggle("open");
      $("#burger").setAttribute("aria-expanded", String(open));
    });
    $("#gallery").addEventListener("click", (e) => { const b = e.target.closest("[data-example]"); if (b) loadExample(b.dataset.example); });

    el.code.maxLength = 20000;
    buildGallery();

    // Start the editor with the student's last draft, or a friendly first example.
    const draft = loadDraft();
    if (draft && draft.code && draft.code.trim()) { setLang(draft.lang); el.code.value = draft.code; el.title.value = draft.title || ""; }
    else { setLang("python"); const first = EXAMPLES.find((e) => e.id === "sum-list") || EXAMPLES[0]; if (first) { el.code.value = first.code; el.title.value = first.title; } }
    drawIdle();
    setControls();
    syncEditor();

    // Login state (cloud.js calls us back whenever it changes)
    renderAuth(null);
    cloud().onAuth(renderAuth);

    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    window.addEventListener("resize", syncEditor);
    route();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
