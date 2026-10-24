/* =====================================================================
   CodeFlix tracer  (tracer.js)
   ---------------------------------------------------------------------
   A tiny interpreter for a SMALL part of Python. It does not just run
   the program - it RECORDS one "step" for every line that executes.
   The visualizer then plays those steps back like a movie.

   What it understands (v1):
     numbers, strings, True/False/None, lists, tuples (for swaps)
     = += -= *= /= //= %=      + - * / // % **     == != < > <= >=
     and / or / not / in       if / elif / else    while   for
     def / return              break / continue / pass
     print(), len(), range(), int(), float(), str(), abs(), min(),
     max(), sum(), round(), list(), sorted()  + common list/str methods

   How it works (3 stages):
     1. tokenize()  - cut the text into small pieces (tokens)
     2. parse()     - turn tokens into a tree (the AST)
     3. execute()   - walk the tree, run it, and record steps

   Public API (used by app.js):
       const result = CodeFlixTracer.trace(sourceText);
       result.steps  -> array of steps   (see record() below)
       result.error  -> null, or { kind, message, line }
       result.truncated -> true if we stopped at the step limit
   ===================================================================== */
(function (global) {
  "use strict";

  /* ---------- Limits for v1 (change here if you want) ---------- */
  const LIMITS = { maxLines: 30, maxSteps: 600, maxDepth: 40, maxSize: 10000 };

  /* ---------- Small helper classes ---------- */
  // An error that carries a Python-style name and the line number.
  class PyError extends Error {
    constructor(kind, message, line) {
      super(message);
      this.kind = kind;     // e.g. "SyntaxError", "NameError"
      this.line = line;     // 1-based line number (or null)
    }
  }
  // Python floats (3.0) must look different from ints (3), so we wrap them.
  class PyFloat { constructor(v) { this.v = v; } }

  /* =====================================================================
     STAGE 1 - TOKENIZER
     Turns text into a flat list of tokens:
        {t:"NUM"|"STR"|"NAME"|"OP"|"NEWLINE"|"INDENT"|"DEDENT"|"EOF", v, line}
     ===================================================================== */
  const KEYWORDS = new Set(["if", "elif", "else", "while", "for", "in", "def", "return",
    "break", "continue", "pass", "and", "or", "not", "True", "False", "None"]);

  // Things real Python has, but CodeFlix v1 does not. We say so politely.
  const UNSUPPORTED = {
    import: "imports", from: "imports", class: "classes", try: "try/except",
    except: "try/except", finally: "try/except", with: "'with' blocks",
    lambda: "lambda functions", global: "'global'", nonlocal: "'nonlocal'",
    del: "'del'", assert: "'assert'", raise: "'raise'", yield: "generators",
    async: "async code", await: "async code", is: "use == instead of 'is'"
  };

  function tokenize(src) {
    const tokens = [];
    const lines = src.split("\n");
    const indents = [0];     // stack of indentation widths
    let depth = 0;           // how many ( or [ are open

    for (let ln = 0; ln < lines.length; ln++) {
      const text = lines[ln].replace(/\r$/, "").replace(/\t/g, "    ");
      const lineNo = ln + 1;
      let i = 0;

      // --- indentation (only at the start of a normal line) ---
      if (depth === 0) {
        let spaces = 0;
        while (i < text.length && text[i] === " ") { spaces++; i++; }
        if (i >= text.length || text[i] === "#") continue;      // blank / comment line
        const top = indents[indents.length - 1];
        if (spaces > top) {
          indents.push(spaces);
          tokens.push({ t: "INDENT", line: lineNo });
        } else if (spaces < top) {
          while (spaces < indents[indents.length - 1]) {
            indents.pop();
            tokens.push({ t: "DEDENT", line: lineNo });
          }
          if (spaces !== indents[indents.length - 1]) {
            throw new PyError("IndentationError",
              "this line is indented differently from the lines above it", lineNo);
          }
        }
      }

      // --- the rest of the line ---
      while (i < text.length) {
        const c = text[i];
        if (c === " ") { i++; continue; }
        if (c === "#") break;                                    // comment

        // numbers
        if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] || ""))) {
          const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
          const isFloat = m[0].includes(".") || /[eE]/.test(m[0]);
          tokens.push({ t: "NUM", v: isFloat ? new PyFloat(parseFloat(m[0])) : parseInt(m[0], 10), line: lineNo });
          i += m[0].length;
          continue;
        }

        // names and keywords
        if (/[A-Za-z_]/.test(c)) {
          const word = /^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(i))[0];
          if (word.length === 1 && /[fFrRbBuU]/.test(word) && (text[i + 1] === '"' || text[i + 1] === "'")) {
            throw new PyError("SyntaxError",
              "f-strings and prefixed strings aren't supported in v1 - join text with + or commas in print()", lineNo);
          }
          tokens.push({ t: "NAME", v: word, line: lineNo });
          i += word.length;
          continue;
        }

        // strings
        if (c === '"' || c === "'") {
          if (text.startsWith(c.repeat(3), i)) {
            throw new PyError("SyntaxError", "triple-quoted strings aren't supported in v1", lineNo);
          }
          let j = i + 1, s = "";
          while (j < text.length && text[j] !== c) {
            if (text[j] === "\\" && j + 1 < text.length) {
              const n = text[j + 1];
              s += n === "n" ? "\n" : n === "t" ? "\t" : n;
              j += 2;
            } else { s += text[j]; j++; }
          }
          if (j >= text.length) {
            throw new PyError("SyntaxError", `this string is missing its closing quote (${c})`, lineNo);
          }
          tokens.push({ t: "STR", v: s, line: lineNo });
          i = j + 1;
          continue;
        }

        // operators (longest match first)
        const three = text.substr(i, 3), two = text.substr(i, 2);
        if (three === "//=" || three === "**=") {
          tokens.push({ t: "OP", v: three, line: lineNo }); i += 3; continue;
        }
        if (["**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%="].includes(two)) {
          tokens.push({ t: "OP", v: two, line: lineNo }); i += 2; continue;
        }
        if ("+-*/%<>=()[],:.".includes(c)) {
          if (c === "(" || c === "[") depth++;
          if (c === ")" || c === "]") {
            depth--;
            if (depth < 0) throw new PyError("SyntaxError", `unexpected closing '${c}' - there is no matching opening bracket`, lineNo);
          }
          tokens.push({ t: "OP", v: c, line: lineNo });
          i++;
          continue;
        }
        if (c === "{" || c === "}") {
          throw new PyError("SyntaxError", "dictionaries and sets ({ }) aren't supported in v1 - try a list [ ]", lineNo);
        }
        throw new PyError("SyntaxError", `unexpected character '${c}'`, lineNo);
      }

      if (depth === 0) tokens.push({ t: "NEWLINE", line: lineNo });
    }

    if (depth > 0) throw new PyError("SyntaxError", "a bracket ( or [ was opened but never closed", lines.length);
    const lastLine = lines.length;
    while (indents.length > 1) { indents.pop(); tokens.push({ t: "DEDENT", line: lastLine }); }
    tokens.push({ t: "EOF", line: lastLine });
    return tokens;
  }

  /* =====================================================================
     STAGE 2 - PARSER
     Builds a tree. Every node is a plain object like
        { type:"Assign", line:3, target:..., value:... }
     ===================================================================== */
  const AUG_OPS = ["+=", "-=", "*=", "/=", "//=", "%=", "**="];

  function parse(tokens) {
    let pos = 0;
    let funcDepth = 0;   // are we inside a def?  (for 'return')
    let loopDepth = 0;   // are we inside a loop? (for 'break' / 'continue')

    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const isOp = (v) => peek().t === "OP" && peek().v === v;
    const isKw = (v) => peek().t === "NAME" && peek().v === v;

    function fail(msg, tok) {
      tok = tok || peek();
      throw new PyError("SyntaxError", msg, tok.line);
    }
    function describeTok(tok) {
      if (tok.t === "NEWLINE" || tok.t === "EOF") return "the end of the line";
      if (tok.t === "STR") return "a string";
      if (tok.t === "NUM") return String(tok.v instanceof PyFloat ? tok.v.v : tok.v);
      if (tok.t === "INDENT") return "an indent";
      return "'" + tok.v + "'";
    }
    function expectOp(v, hint) {
      if (!isOp(v)) fail(hint || `expected '${v}' but found ${describeTok(peek())}`);
      return next();
    }
    function expectColon() {
      if (isOp("=")) fail("found '=' where ':' was expected - use '==' to compare values ('=' is for storing)");
      if (!isOp(":")) fail("this line needs a ':' at the end");
      next();
    }

    /* ----- blocks and statements ----- */
    function parseBlock(headerLine) {
      expectColon();
      if (peek().t === "NEWLINE") {
        next();
        if (peek().t !== "INDENT") {
          throw new PyError("IndentationError",
            "expected an indented block after this line (add 4 spaces before the next line)", headerLine);
        }
        next();
        const body = [];
        while (peek().t !== "DEDENT" && peek().t !== "EOF") body.push(parseStatement());
        if (peek().t === "DEDENT") next();
        return body;
      }
      return [parseSimpleStatement()];       // one-line block:  if x: print(x)
    }

    function parseStatement() {
      const tok = peek();
      if (tok.t === "INDENT") fail("unexpected indent - this line is indented, but the line above doesn't start a block");
      if (tok.t === "NAME") {
        if (UNSUPPORTED[tok.v] && tok.v !== "is") fail(`'${tok.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[tok.v]})`);
        if (tok.v === "elif" || tok.v === "else") fail(`'${tok.v}' has no matching 'if' above it`);
        if (tok.v === "if") return parseIf();
        if (tok.v === "while") return parseWhile();
        if (tok.v === "for") return parseFor();
        if (tok.v === "def") return parseDef();
      }
      return parseSimpleStatement();
    }

    function parseIf() {
      const head = next();                    // the word 'if' or 'elif'
      const test = parseExpr();
      const body = parseBlock(head.line);
      let orelse = [];
      if (isKw("elif")) orelse = [parseIf()];
      else if (isKw("else")) { const e = next(); orelse = parseBlock(e.line); }
      return { type: "If", kw: head.v, line: head.line, test, body, orelse };
    }

    function parseWhile() {
      const head = next();
      const test = parseExpr();
      loopDepth++;
      const body = parseBlock(head.line);
      loopDepth--;
      return { type: "While", line: head.line, test, body };
    }

    function parseFor() {
      const head = next();
      const nameTok = next();
      if (nameTok.t !== "NAME" || KEYWORDS.has(nameTok.v)) fail("'for' must be followed by a variable name, like: for i in range(3):", nameTok);
      if (!isKw("in")) fail("expected the word 'in' - for example: for n in numbers:");
      next();
      const iter = parseExpr();
      loopDepth++;
      const body = parseBlock(head.line);
      loopDepth--;
      return { type: "For", line: head.line, target: nameTok.v, iter, body };
    }

    function parseDef() {
      const head = next();
      const nameTok = next();
      if (nameTok.t !== "NAME" || KEYWORDS.has(nameTok.v)) fail("'def' must be followed by a function name", nameTok);
      expectOp("(", "a function name must be followed by ( )");
      const params = [];
      while (!isOp(")")) {
        const p = next();
        if (p.t !== "NAME" || KEYWORDS.has(p.v)) fail("expected a parameter name here", p);
        params.push(p.v);
        if (isOp("=")) fail("default parameter values aren't supported in v1");
        if (isOp(",")) next(); else if (!isOp(")")) fail("parameters must be separated by commas");
      }
      next();                                  // the ')'
      const savedLoop = loopDepth;
      loopDepth = 0; funcDepth++;
      const body = parseBlock(head.line);
      funcDepth--; loopDepth = savedLoop;
      return { type: "Def", line: head.line, name: nameTok.v, params, body };
    }

    function parseSimpleStatement() {
      const tok = peek();
      let node;
      if (tok.t === "NAME" && tok.v === "return") {
        if (funcDepth === 0) fail("'return' only works inside a function (a 'def')");
        next();
        const value = (peek().t === "NEWLINE" || peek().t === "EOF") ? null : parseExprList();
        node = { type: "Return", line: tok.line, value };
      } else if (tok.t === "NAME" && (tok.v === "break" || tok.v === "continue")) {
        if (loopDepth === 0) fail(`'${tok.v}' only works inside a loop`);
        next();
        node = { type: tok.v === "break" ? "Break" : "Continue", line: tok.line };
      } else if (tok.t === "NAME" && tok.v === "pass") {
        next();
        node = { type: "Pass", line: tok.line };
      } else {
        const first = parseExprList();
        if (isOp("=")) {
          next();
          checkTarget(first);
          const value = parseExprList();
          if (isOp("=")) fail("chained assignment (a = b = 0) isn't supported in v1 - use two lines");
          node = { type: "Assign", line: tok.line, target: first, value };
        } else if (peek().t === "OP" && AUG_OPS.includes(peek().v)) {
          const op = next().v.slice(0, -1);
          if (first.type !== "Name" && first.type !== "Index") fail("can't use this on the left side of " + op + "=");
          const value = parseExpr();
          node = { type: "AugAssign", line: tok.line, op, target: first, value };
        } else {
          node = { type: "ExprStmt", line: tok.line, expr: first };
        }
      }
      const end = peek();
      if (end.t !== "NEWLINE" && end.t !== "EOF") {
        if (end.t === "NAME" && UNSUPPORTED[end.v]) fail(`'${end.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[end.v]})`);
        fail(`unexpected ${describeTok(end)} - check for a missing operator, comma or bracket`);
      }
      if (end.t === "NEWLINE") next();
      return node;
    }

    function checkTarget(node) {
      if (node.type === "Name" || node.type === "Index") return;
      if (node.type === "Tuple") { node.items.forEach(checkTarget); return; }
      fail("you can only store a value into a variable name or a list item");
    }

    /* ----- expressions (lowest precedence first) ----- */
    function parseExprList() {                // a   or   a, b, c   (a tuple)
      const first = parseExpr();
      if (!isOp(",")) return first;
      const items = [first];
      while (isOp(",")) {
        next();
        if (peek().t === "NEWLINE" || isOp("=") || peek().t === "EOF") break;
        items.push(parseExpr());
      }
      return { type: "Tuple", items, line: first.line };
    }

    function parseExpr() { return parseOr(); }

    function parseOr() {
      let left = parseAnd();
      while (isKw("or")) { const t = next(); left = { type: "BoolOp", op: "or", left, right: parseAnd(), line: t.line }; }
      return left;
    }
    function parseAnd() {
      let left = parseNot();
      while (isKw("and")) { const t = next(); left = { type: "BoolOp", op: "and", left, right: parseNot(), line: t.line }; }
      return left;
    }
    function parseNot() {
      if (isKw("not")) { const t = next(); return { type: "Not", operand: parseNot(), line: t.line }; }
      return parseCompare();
    }

    function parseCompare() {
      const left = parseArith();
      const ops = [], rights = [];
      for (;;) {
        const t = peek();
        let op = null;
        if (t.t === "OP" && ["==", "!=", "<", ">", "<=", ">="].includes(t.v)) { op = t.v; next(); }
        else if (t.t === "NAME" && t.v === "in") { op = "in"; next(); }
        else if (t.t === "NAME" && t.v === "not" && tokens[pos + 1].t === "NAME" && tokens[pos + 1].v === "in") {
          op = "not in"; next(); next();
        }
        if (!op) break;
        ops.push(op);
        rights.push(parseArith());
      }
      if (!ops.length) return left;
      return { type: "Compare", left, ops, rights, line: left.line };
    }

    function parseArith() {
      let left = parseTerm();
      while (isOp("+") || isOp("-")) {
        const t = next();
        left = { type: "BinOp", op: t.v, left, right: parseTerm(), line: t.line };
      }
      return left;
    }
    function parseTerm() {
      let left = parseUnary();
      while (isOp("*") || isOp("/") || isOp("//") || isOp("%")) {
        const t = next();
        left = { type: "BinOp", op: t.v, left, right: parseUnary(), line: t.line };
      }
      return left;
    }
    function parseUnary() {
      if (isOp("-") || isOp("+")) {
        const t = next();
        return { type: "Unary", op: t.v, operand: parseUnary(), line: t.line };
      }
      return parsePower();
    }
    function parsePower() {
      const base = parsePostfix();
      if (isOp("**")) {
        const t = next();
        return { type: "BinOp", op: "**", left: base, right: parseUnary(), line: t.line };   // right-assoc
      }
      return base;
    }

    // calls  f(x)   indexes  a[i]   slices  a[1:3]   methods  a.append(x)
    function parsePostfix() {
      let node = parsePrimary();
      for (;;) {
        if (isOp("(")) {
          const t = next();
          const args = [];
          while (!isOp(")")) {
            if (peek().t === "NEWLINE" || peek().t === "EOF") fail("this function call is missing its closing ')'");
            args.push(parseExpr());
            if (isOp("=")) fail("keyword arguments like sep=... aren't supported in v1");
            if (isOp(",")) next(); else if (!isOp(")")) fail("arguments must be separated by commas");
          }
          next();
          node = { type: "Call", func: node, args, line: t.line };
        } else if (isOp("[")) {
          const t = next();
          let lo = null, hi = null, isSlice = false;
          if (!isOp(":")) lo = parseExpr();
          if (isOp(":")) {
            isSlice = true; next();
            if (!isOp("]") && !isOp(":")) hi = parseExpr();
            if (isOp(":")) fail("slices with a step (a[::2]) aren't supported in v1");
          }
          expectOp("]", "this [ is missing its closing ]");
          node = isSlice ? { type: "Slice", obj: node, lo, hi, line: t.line }
                         : { type: "Index", obj: node, index: lo, line: t.line };
        } else if (isOp(".")) {
          const t = next();
          const nameTok = next();
          if (nameTok.t !== "NAME") fail("expected a method name after '.'", nameTok);
          node = { type: "Attr", obj: node, name: nameTok.v, line: t.line };
        } else break;
      }
      return node;
    }

    function parsePrimary() {
      const t = peek();
      if (t.t === "NUM") { next(); return { type: "Const", value: t.v, line: t.line }; }
      if (t.t === "STR") { next(); return { type: "Const", value: t.v, line: t.line }; }
      if (t.t === "NAME") {
        if (t.v === "True" || t.v === "False") { next(); return { type: "Const", value: t.v === "True", line: t.line }; }
        if (t.v === "None") { next(); return { type: "Const", value: null, line: t.line }; }
        if (UNSUPPORTED[t.v]) fail(`'${t.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[t.v]})`);
        if (KEYWORDS.has(t.v)) fail(`'${t.v}' is a Python keyword - it can't be used here`);
        next();
        return { type: "Name", id: t.v, line: t.line };
      }
      if (t.t === "OP" && t.v === "(") {
        next();
        if (isOp(")")) { next(); const e = { type: "Tuple", items: [], line: t.line }; return e; }
        const first = parseExpr();
        if (isOp(",")) {
          const items = [first];
          while (isOp(",")) { next(); if (isOp(")")) break; items.push(parseExpr()); }
          expectOp(")", "this ( is missing its closing )");
          return { type: "Tuple", items, line: t.line };
        }
        expectOp(")", "this ( is missing its closing )");
        first.paren = true;                    // remember the brackets (for printing)
        return first;
      }
      if (t.t === "OP" && t.v === "[") {
        next();
        const items = [];
        while (!isOp("]")) {
          if (peek().t === "NEWLINE" || peek().t === "EOF") fail("this list is missing its closing ]");
          items.push(parseExpr());
          if (isKw("for")) fail("list comprehensions aren't supported in v1 - use a normal for loop");
          if (isOp(",")) next(); else if (!isOp("]")) fail("list items must be separated by commas");
        }
        next();
        return { type: "List", items, line: t.line };
      }
      fail(`unexpected ${describeTok(t)} - Python expected a value here`);
    }

    /* ----- parse the whole program ----- */
    const body = [];
    while (peek().t !== "EOF") body.push(parseStatement());
    return body;
  }

  /* =====================================================================
     STAGE 3 - EXECUTOR
     Walks the tree and runs it. After every line it calls record()
     to save a "step": the line number, a plain-English note, a copy of
     the variables, the call stack and the output so far.
     ===================================================================== */

  /* ---------- Value types ---------- */
  // Python values are stored as:  int -> JS number,  float -> PyFloat,
  // str -> JS string,  bool -> JS boolean,  None -> null,
  // list -> JS array,  tuple -> JS array with .tuple = true
  class PyFunction { constructor(name, params, body, line) { this.name = name; this.params = params; this.body = body; this.line = line; } }
  class PyRange {
    constructor(start, stop, step) {
      if (step === 0) throw new PyError("ValueError", "range() step must not be zero", null);
      this.start = start; this.stop = stop; this.step = step;
      this.length = Math.max(0, Math.ceil((stop - start) / step));
    }
  }
  class Builtin { constructor(name, min, max, fn) { this.name = name; this.min = min; this.max = max; this.fn = fn; } }

  // Signals used to jump out of loops / functions (not real errors)
  class BreakSignal {}
  class ContinueSignal {}
  class ReturnSignal { constructor(value) { this.value = value; } }
  class StopRun {}                         // thrown when we hit the step limit

  const isInt = (v) => typeof v === "number" || typeof v === "boolean";
  const isNum = (v) => isInt(v) || v instanceof PyFloat;
  const numVal = (v) => (v instanceof PyFloat ? v.v : Number(v));

  function typeName(v) {
    if (v === null) return "NoneType";
    if (typeof v === "boolean") return "bool";
    if (typeof v === "number") return "int";
    if (v instanceof PyFloat) return "float";
    if (typeof v === "string") return "str";
    if (Array.isArray(v)) return v.tuple ? "tuple" : "list";
    if (v instanceof PyRange) return "range";
    if (v instanceof PyFunction || v instanceof Builtin) return "function";
    return "object";
  }

  function fmtFloat(x) {
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);   // 3 -> "3.0"
    return String(x);
  }

  // repr = how Python shows a value inside a list / in the variable box
  function repr(v) {
    if (v === null) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return String(v);
    if (v instanceof PyFloat) return fmtFloat(v.v);
    if (typeof v === "string") return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
    if (Array.isArray(v)) {
      const inner = v.map(repr).join(", ");
      return v.tuple ? "(" + inner + (v.length === 1 ? "," : "") + ")" : "[" + inner + "]";
    }
    if (v instanceof PyRange) return v.step === 1 ? `range(${v.start}, ${v.stop})` : `range(${v.start}, ${v.stop}, ${v.step})`;
    if (v instanceof PyFunction) return `<function ${v.name}>`;
    if (v instanceof Builtin) return `<built-in function ${v.name}>`;
    return String(v);
  }
  // what print() shows: strings without quotes, everything else like repr
  const show = (v) => (typeof v === "string" ? v : repr(v));

  function truthy(v) {
    if (v === null) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v instanceof PyFloat) return v.v !== 0;
    if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
    if (v instanceof PyRange) return v.length > 0;
    return true;
  }

  function eq(a, b) {
    if (isNum(a) && isNum(b)) return numVal(a) === numVal(b);
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
    return a === b;
  }

  // returns -1, 0 or 1 (used by < > <= >= and by sorted/min/max)
  function order(a, b, op) {
    let x, y;
    if (isNum(a) && isNum(b)) { x = numVal(a); y = numVal(b); }
    else if (typeof a === "string" && typeof b === "string") { x = a; y = b; }
    else if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const r = order(a[i], b[i], op);
        if (r !== 0) return r;
      }
      return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
    } else {
      throw new PyError("TypeError", `'${op || "<"}' can't compare a ${typeName(a)} with a ${typeName(b)}`, null);
    }
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function checkSize(n) {
    if (n > LIMITS.maxSize) throw new PyError("MemoryError", `that result is too big for CodeFlix v1 (limit ${LIMITS.maxSize} items)`, null);
  }

  function binop(op, a, b) {
    if (op === "+") {
      if (typeof a === "string" && typeof b === "string") { checkSize(a.length + b.length); return a + b; }
      if (Array.isArray(a) && Array.isArray(b) && !a.tuple === !b.tuple) {
        const r = a.concat(b); if (a.tuple) r.tuple = true; return r;
      }
      if ((typeof a === "string" && !isNum(b) && typeof b !== "string") || (typeof b === "string" && isNum(a))) {
        throw new PyError("TypeError", `can't add a ${typeName(a)} and a ${typeName(b)} - convert with str() or int() first`, null);
      }
    }
    if (op === "*") {
      const rep = (seq, n) => {
        const k = Math.max(0, Number(n));
        if (typeof seq === "string") { checkSize(seq.length * k); return seq.repeat(k); }
        checkSize(seq.length * k);
        let out = []; for (let i = 0; i < k; i++) out = out.concat(seq);
        if (seq.tuple) out.tuple = true;
        return out;
      };
      if ((typeof a === "string" || Array.isArray(a)) && isInt(b)) return rep(a, b);
      if ((typeof b === "string" || Array.isArray(b)) && isInt(a)) return rep(b, a);
    }
    if (op === "%" && typeof a === "string") {
      throw new PyError("TypeError", "string formatting with % isn't supported in v1 - join text with + and str()", null);
    }
    if (!isNum(a) || !isNum(b)) {
      throw new PyError("TypeError", `can't use '${op}' between a ${typeName(a)} and a ${typeName(b)}`, null);
    }
    const x = numVal(a), y = numVal(b);
    const anyFloat = a instanceof PyFloat || b instanceof PyFloat;
    let r;
    switch (op) {
      case "+": r = x + y; break;
      case "-": r = x - y; break;
      case "*": r = x * y; break;
      case "/":
        if (y === 0) throw new PyError("ZeroDivisionError", "division by zero", null);
        return new PyFloat(x / y);                      // "/" always gives a float
      case "//":
        if (y === 0) throw new PyError("ZeroDivisionError", "integer division by zero", null);
        r = Math.floor(x / y); break;
      case "%":
        if (y === 0) throw new PyError("ZeroDivisionError", "modulo by zero", null);
        r = x - y * Math.floor(x / y); break;
      case "**":
        r = Math.pow(x, y);
        if (!anyFloat && y < 0) return new PyFloat(r);
        break;
      default: throw new PyError("SyntaxError", "unknown operator " + op, null);
    }
    if (anyFloat) return new PyFloat(r);
    if (!Number.isSafeInteger(r)) throw new PyError("OverflowError", "that number is too big for CodeFlix v1 - try smaller numbers", null);
    return r;
  }

  function makeIter(v) {
    if (Array.isArray(v)) { let i = 0; return { next: () => (i < v.length ? { done: false, value: v[i++] } : { done: true }) }; }
    if (typeof v === "string") { let i = 0; return { next: () => (i < v.length ? { done: false, value: v[i++] } : { done: true }) }; }
    if (v instanceof PyRange) { let i = 0; return { next: () => (i < v.length ? { done: false, value: v.start + v.step * i++ } : { done: true }) }; }
    throw new PyError("TypeError", `a ${typeName(v)} is not something you can loop over`, null);
  }
  function toArray(v) {
    const it = makeIter(v), out = [];
    for (;;) {
      const r = it.next();
      if (r.done) return out;
      out.push(r.value);
      checkSize(out.length);
    }
  }

  function indexOf(seq, idx, what) {
    if (!isInt(idx)) throw new PyError("TypeError", `${what} indices must be whole numbers, not ${typeName(idx)}`, null);
    let i = Number(idx);
    if (i < 0) i += seq.length;
    if (i < 0 || i >= seq.length) throw new PyError("IndexError", `${what} index out of range`, null);
    return i;
  }
  function sliceBounds(len, lo, hi) {
    for (const b of [lo, hi]) if (b !== null && !isInt(b)) throw new PyError("TypeError", "slice positions must be whole numbers", null);
    let a = lo === null ? 0 : Number(lo), b = hi === null ? len : Number(hi);
    if (a < 0) a = Math.max(0, a + len);
    if (b < 0) b = Math.max(0, b + len);
    a = Math.min(a, len); b = Math.min(b, len);
    return [a, Math.max(a, b)];
  }

  function contains(container, item) {
    if (typeof container === "string") {
      if (typeof item !== "string") throw new PyError("TypeError", "'in <string>' needs a string on the left", null);
      return container.includes(item);
    }
    if (Array.isArray(container)) return container.some((x) => eq(x, item));
    if (container instanceof PyRange) return toArray(container).some((x) => eq(x, item));
    throw new PyError("TypeError", `a ${typeName(container)} can't be used with 'in'`, null);
  }

  function roundHalfEven(x) {
    const r = Math.round(x);
    return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
  }

  /* ---------- Methods:  my_list.append(3)   "hi".upper() ---------- */
  const method = (min, max, fn) => ({ min, max, fn });
  const LIST_METHODS = {
    append: method(1, 1, (l, [x]) => { l.push(x); return null; }),
    extend: method(1, 1, (l, [o]) => { toArray(o).forEach((x) => l.push(x)); return null; }),
    insert: method(2, 2, (l, [i, x]) => {
      let k = Number(i); if (k < 0) k = Math.max(0, k + l.length);
      l.splice(Math.min(k, l.length), 0, x); return null;
    }),
    pop: method(0, 1, (l, a) => {
      if (!l.length) throw new PyError("IndexError", "pop from an empty list", null);
      return l.splice(a.length ? indexOf(l, a[0], "pop") : l.length - 1, 1)[0];
    }),
    remove: method(1, 1, (l, [x]) => {
      const k = l.findIndex((y) => eq(x, y));
      if (k < 0) throw new PyError("ValueError", "remove(x): x is not in the list", null);
      l.splice(k, 1); return null;
    }),
    reverse: method(0, 0, (l) => { l.reverse(); return null; }),
    sort: method(0, 0, (l) => { l.sort((a, b) => order(a, b)); return null; }),
    index: method(1, 1, (l, [x]) => {
      const k = l.findIndex((y) => eq(x, y));
      if (k < 0) throw new PyError("ValueError", "that value is not in the list", null);
      return k;
    }),
    count: method(1, 1, (l, [x]) => l.filter((y) => eq(x, y)).length)
  };
  const TUPLE_METHODS = { index: LIST_METHODS.index, count: LIST_METHODS.count };

  const needStr = (x, name) => {
    if (typeof x !== "string") throw new PyError("TypeError", `${name}() needs a string, not a ${typeName(x)}`, null);
    return x;
  };
  const STR_METHODS = {
    upper: method(0, 0, (s) => s.toUpperCase()),
    lower: method(0, 0, (s) => s.toLowerCase()),
    strip: method(0, 0, (s) => s.trim()),
    capitalize: method(0, 0, (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()),
    isdigit: method(0, 0, (s) => /^[0-9]+$/.test(s)),
    isalpha: method(0, 0, (s) => /^[A-Za-z]+$/.test(s)),
    split: method(0, 1, (s, a) => {
      let parts;
      if (!a.length) parts = s.trim() === "" ? [] : s.trim().split(/\s+/);
      else { if (needStr(a[0], "split") === "") throw new PyError("ValueError", "empty separator", null); parts = s.split(a[0]); }
      return parts;
    }),
    join: method(1, 1, (s, [l]) => toArray(l).map((x) => needStr(x, "join")).join(s)),
    replace: method(2, 2, (s, [a, b]) => s.split(needStr(a, "replace")).join(needStr(b, "replace"))),
    startswith: method(1, 1, (s, [x]) => s.startsWith(needStr(x, "startswith"))),
    endswith: method(1, 1, (s, [x]) => s.endsWith(needStr(x, "endswith"))),
    find: method(1, 1, (s, [x]) => s.indexOf(needStr(x, "find"))),
    count: method(1, 1, (s, [x]) => (needStr(x, "count") === "" ? s.length + 1 : s.split(x).length - 1))
  };

  /* ---------- Turn an expression tree back into text (for narration) ---------- */
  function unparse(n) {
    let s;
    switch (n.type) {
      case "Const": s = repr(n.value); break;
      case "Name": s = n.id; break;
      case "List": s = "[" + n.items.map(unparse).join(", ") + "]"; break;
      case "Tuple": s = "(" + n.items.map(unparse).join(", ") + (n.items.length === 1 ? "," : "") + ")"; break;
      case "Unary": s = n.op + unparse(n.operand); break;
      case "Not": s = "not " + unparse(n.operand); break;
      case "BoolOp": case "BinOp": s = unparse(n.left) + " " + n.op + " " + unparse(n.right); break;
      case "Compare": s = unparse(n.left) + n.ops.map((o, i) => " " + o + " " + unparse(n.rights[i])).join(""); break;
      case "Call": s = unparse(n.func) + "(" + n.args.map(unparse).join(", ") + ")"; break;
      case "Index": s = unparse(n.obj) + "[" + unparse(n.index) + "]"; break;
      case "Slice": s = unparse(n.obj) + "[" + (n.lo ? unparse(n.lo) : "") + ":" + (n.hi ? unparse(n.hi) : "") + "]"; break;
      case "Attr": s = unparse(n.obj) + "." + n.name; break;
      default: s = "?";
    }
    return n.paren ? "(" + s + ")" : s;
  }
  const c = (s) => "`" + s + "`";          // wrap text in backticks (the UI turns these into <code>)

  /* ---------- The executor ---------- */
  function execute(ast, opts) {
    const steps = [];
    // One "frame" per function call. frames[0] is the main program.
    const frames = [{ name: "main", params: [], vars: new Map(), last: new Map(), lastItems: new Map(), line: 0 }];
    let output = "";
    let lastPrint = "";
    let currentLine = 0;
    const top = () => frames[frames.length - 1];

    /* --- snapshots: what the UI draws for one step --- */
    function snapshotVars(frame) {
      const list = [];
      const newLast = new Map(), newItems = new Map();
      frame.vars.forEach((val, name) => {
        if (val instanceof PyFunction) return;                // functions aren't shown as boxes
        const text = repr(val);
        const items = Array.isArray(val) ? val.map(repr) : null;
        const prev = frame.lastItems.get(name);
        list.push({
          name, type: typeName(val), text, items,
          changed: frame.last.get(name) !== text,
          changedItems: items && prev ? items.map((t, i) => prev[i] !== t) : null
        });
        newLast.set(name, text);
        newItems.set(name, items);
      });
      frame.last = newLast;
      frame.lastItems = newItems;
      return list;
    }
    function makeStep(line, note, extra) {
      const frame = top();
      return Object.assign({
        line, note,
        scope: frame.name,
        vars: snapshotVars(frame),
        stack: frames.map((f) => ({
          name: f.name,
          args: f.params.map((p) => p + "=" + (f.vars.has(p) ? repr(f.vars.get(p)) : "?")).join(", "),
          line: f.line
        })),
        output
      }, extra || {});
    }
    function record(line, note) {
      if (steps.length >= opts.maxSteps) throw new StopRun();
      steps.push(makeStep(line, note));
    }

    /* --- variables --- */
    function findName(id) {
      const f = top();
      if (f.vars.has(id)) return { found: true, value: f.vars.get(id) };
      if (frames[0].vars.has(id)) return { found: true, value: frames[0].vars.get(id) };
      if (BUILTINS.has(id)) return { found: true, value: BUILTINS.get(id) };
      return { found: false };
    }

    /* --- built-in functions --- */
    const BUILTINS = new Map();
    const def = (name, min, max, fn) => BUILTINS.set(name, new Builtin(name, min, max, fn));
    def("print", 0, Infinity, (args) => {
      lastPrint = args.map(show).join(" ");
      output += lastPrint + "\n";
      if (output.length > 4000) output = output.slice(0, 4000) + "...";
      return null;
    });
    def("len", 1, 1, ([x]) => {
      if (typeof x === "string" || Array.isArray(x) || x instanceof PyRange) return x.length;
      throw new PyError("TypeError", `a ${typeName(x)} has no len()`, null);
    });
    def("range", 1, 3, (a) => {
      for (const x of a) if (!isInt(x)) throw new PyError("TypeError", `range() needs whole numbers, not a ${typeName(x)}`, null);
      const n = a.map(Number);
      return n.length === 1 ? new PyRange(0, n[0], 1) : new PyRange(n[0], n[1], n.length === 3 ? n[2] : 1);
    });
    def("int", 1, 1, ([x]) => {
      if (typeof x === "string") {
        if (!/^\s*[+-]?\d+\s*$/.test(x)) throw new PyError("ValueError", `can't turn ${repr(x)} into an int`, null);
        return parseInt(x, 10);
      }
      if (isNum(x)) return Math.trunc(numVal(x));
      throw new PyError("TypeError", `int() can't convert a ${typeName(x)}`, null);
    });
    def("float", 1, 1, ([x]) => {
      if (typeof x === "string") {
        if (!/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(x)) throw new PyError("ValueError", `can't turn ${repr(x)} into a float`, null);
        return new PyFloat(parseFloat(x));
      }
      if (isNum(x)) return new PyFloat(numVal(x));
      throw new PyError("TypeError", `float() can't convert a ${typeName(x)}`, null);
    });
    def("str", 1, 1, ([x]) => show(x));
    def("bool", 1, 1, ([x]) => truthy(x));
    def("abs", 1, 1, ([x]) => {
      if (!isNum(x)) throw new PyError("TypeError", `abs() needs a number, not a ${typeName(x)}`, null);
      return x instanceof PyFloat ? new PyFloat(Math.abs(x.v)) : Math.abs(Number(x));
    });
    const pick = (name, sign) => def(name, 1, Infinity, (a) => {
      const items = a.length === 1 ? toArray(a[0]) : a;
      if (!items.length) throw new PyError("ValueError", `${name}() has nothing to compare`, null);
      return items.reduce((best, x) => (order(x, best, name) * sign > 0 ? x : best));
    });
    pick("max", 1); pick("min", -1);
    def("sum", 1, 1, ([l]) => toArray(l).reduce((t, x) => binop("+", t, x), 0));
    def("round", 1, 2, (a) => {
      if (!isNum(a[0])) throw new PyError("TypeError", `round() needs a number, not a ${typeName(a[0])}`, null);
      const x = numVal(a[0]);
      if (a.length === 1) return roundHalfEven(x);
      const f = Math.pow(10, Number(a[1]));
      return new PyFloat(roundHalfEven(x * f) / f);
    });
    def("list", 0, 1, (a) => (a.length ? toArray(a[0]) : []));
    def("sorted", 1, 1, ([x]) => toArray(x).sort((p, q) => order(p, q)));
    def("input", 0, 1, () => {
      throw new PyError("NotSupported", "input() isn't supported in v1 - just set the value in your code, like  age = 20", null);
    });

    /* --- evaluating expressions --- */
    function evalExpr(n) {
      switch (n.type) {
        case "Const": return n.value;
        case "Name": {
          const r = findName(n.id);
          if (!r.found) throw new PyError("NameError", `the name '${n.id}' isn't defined yet - did you misspell it, or forget to set it?`, null);
          return r.value;
        }
        case "List": return n.items.map(evalExpr);
        case "Tuple": { const a = n.items.map(evalExpr); a.tuple = true; return a; }
        case "Unary": {
          const v = evalExpr(n.operand);
          if (!isNum(v)) throw new PyError("TypeError", `can't use unary '${n.op}' on a ${typeName(v)}`, null);
          const r = n.op === "-" ? -numVal(v) : numVal(v);
          return v instanceof PyFloat ? new PyFloat(r) : r;
        }
        case "Not": return !truthy(evalExpr(n.operand));
        case "BoolOp": {
          const l = evalExpr(n.left);
          if (n.op === "and") return truthy(l) ? evalExpr(n.right) : l;
          return truthy(l) ? l : evalExpr(n.right);
        }
        case "BinOp": return binop(n.op, evalExpr(n.left), evalExpr(n.right));
        case "Compare": {
          let left = evalExpr(n.left);
          for (let i = 0; i < n.ops.length; i++) {
            const right = evalExpr(n.rights[i]);
            const op = n.ops[i];
            let ok;
            if (op === "==") ok = eq(left, right);
            else if (op === "!=") ok = !eq(left, right);
            else if (op === "in") ok = contains(right, left);
            else if (op === "not in") ok = !contains(right, left);
            else {
              const r = order(left, right, op);
              ok = op === "<" ? r < 0 : op === ">" ? r > 0 : op === "<=" ? r <= 0 : r >= 0;
            }
            if (!ok) return false;
            left = right;
          }
          return true;
        }
        case "Index": {
          let obj = evalExpr(n.obj);
          const idx = evalExpr(n.index);
          if (obj instanceof PyRange) obj = toArray(obj);
          if (typeof obj === "string") return obj[indexOf(obj, idx, "string")];
          if (Array.isArray(obj)) return obj[indexOf(obj, idx, obj.tuple ? "tuple" : "list")];
          throw new PyError("TypeError", `a ${typeName(obj)} can't be indexed with [ ]`, null);
        }
        case "Slice": {
          let obj = evalExpr(n.obj);
          if (obj instanceof PyRange) obj = toArray(obj);
          const [a, b] = sliceBounds(obj.length, n.lo ? evalExpr(n.lo) : null, n.hi ? evalExpr(n.hi) : null);
          if (typeof obj === "string") return obj.slice(a, b);
          if (Array.isArray(obj)) { const r = obj.slice(a, b); if (obj.tuple) r.tuple = true; return r; }
          throw new PyError("TypeError", `a ${typeName(obj)} can't be sliced`, null);
        }
        case "Call": return evalCall(n);
        case "Attr": throw new PyError("AttributeError", `'${n.name}' must be called with ( ), like  items.${n.name}(...)`, null);
        default: throw new PyError("SyntaxError", "can't run this kind of expression: " + n.type, null);
      }
    }

    function evalCall(n) {
      if (n.func.type === "Attr") return callMethod(n);
      let fn;
      if (n.func.type === "Name") {
        const r = findName(n.func.id);
        if (!r.found) throw new PyError("NameError", `the function '${n.func.id}' isn't defined - did you misspell it, or forget to define it above?`, null);
        fn = r.value;
      } else fn = evalExpr(n.func);
      const args = n.args.map(evalExpr);
      if (fn instanceof Builtin) {
        if (args.length < fn.min || args.length > fn.max) {
          throw new PyError("TypeError", `${fn.name}() got ${args.length} argument${args.length === 1 ? "" : "s"}, which isn't the right number`, null);
        }
        return fn.fn(args);
      }
      if (fn instanceof PyFunction) return callUser(fn, args);
      throw new PyError("TypeError", `a ${typeName(fn)} can't be called like a function`, null);
    }

    function callMethod(n) {
      const obj = evalExpr(n.func.obj);
      const name = n.func.name;
      const args = n.args.map(evalExpr);
      let table = null;
      if (Array.isArray(obj)) table = obj.tuple ? TUPLE_METHODS : LIST_METHODS;
      else if (typeof obj === "string") table = STR_METHODS;
      const m = table && Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
      if (!m) throw new PyError("AttributeError", `a ${typeName(obj)} has no method called '${name}' (in CodeFlix v1)`, null);
      if (args.length < m.min || args.length > m.max) {
        throw new PyError("TypeError", `${name}() got ${args.length} argument${args.length === 1 ? "" : "s"}, which isn't the right number`, null);
      }
      return m.fn(obj, args);
    }

    function callUser(fn, args) {
      if (args.length !== fn.params.length) {
        throw new PyError("TypeError",
          `${fn.name}() needs ${fn.params.length} value${fn.params.length === 1 ? "" : "s"} but got ${args.length}`, null);
      }
      if (frames.length >= opts.maxDepth) {
        throw new PyError("RecursionError",
          `too many nested calls (limit ${opts.maxDepth}) - does the function ever stop calling itself?`, null);
      }
      const frame = { name: fn.name, params: fn.params, vars: new Map(), last: new Map(), lastItems: new Map(), line: fn.line };
      fn.params.forEach((p, i) => frame.vars.set(p, args[i]));
      const callerLine = currentLine;
      frames.push(frame);
      try {
        record(callerLine, `Call ${c(fn.name + "(" + args.map(repr).join(", ") + ")")} - a new box is added to the call stack.`);
        execBlock(fn.body);
        return null;                                  // ran off the end: returns None
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        if (e instanceof PyError) {
          if (e.line == null) e.line = currentLine;
          if (!e.step) e.step = makeStep(e.line, `${e.kind}: ${e.message}`, { error: true });
        }
        throw e;
      } finally {
        frames.pop();
        currentLine = callerLine;
      }
    }

    /* --- assigning --- */
    function assignTo(t, v) {
      if (t.type === "Name") { top().vars.set(t.id, v); return; }
      if (t.type === "Index") {
        const obj = evalExpr(t.obj), idx = evalExpr(t.index);
        if (!Array.isArray(obj) || obj.tuple) throw new PyError("TypeError", `a ${typeName(obj)} doesn't allow changing items with [ ] = ...`, null);
        obj[indexOf(obj, idx, "list assignment")] = v;
        return;
      }
      if (t.type === "Tuple") {
        if (!Array.isArray(v) && typeof v !== "string") throw new PyError("TypeError", `can't unpack a ${typeName(v)} into several names`, null);
        const vals = toArray(v);
        if (vals.length !== t.items.length) {
          throw new PyError("ValueError", `expected ${t.items.length} values to unpack but got ${vals.length}`, null);
        }
        t.items.forEach((x, i) => assignTo(x, vals[i]));
      }
    }

    /* --- statements --- */
    function execBlock(stmts) { for (const s of stmts) execStmt(s); }

    function execStmt(node) {
      currentLine = node.line;
      top().line = node.line;
      switch (node.type) {
        case "Assign": {
          const v = evalExpr(node.value);
          assignTo(node.target, v);
          let note;
          if (node.target.type === "Name") {
            note = node.value.type === "Const"
              ? `Store ${c(repr(v))} in ${c(node.target.id)}.`
              : `Work out ${c(unparse(node.value))} = ${c(repr(v))} and store it in ${c(node.target.id)}.`;
          } else if (node.target.type === "Index") {
            note = `Change the list item ${c(unparse(node.target))} to ${c(repr(v))}.`;
          } else {
            note = `Assign several values at once: ${c(unparse(node.target))} gets ${c(repr(v))}.`;
          }
          record(node.line, note);
          break;
        }
        case "AugAssign": {
          const old = evalExpr(node.target);
          const rhs = evalExpr(node.value);
          const oldText = repr(old);                       // saved before a list may change
          let result;
          if (Array.isArray(old) && !old.tuple && node.op === "+" && Array.isArray(rhs)) {
            rhs.slice().forEach((x) => old.push(x));       // list += list changes the list itself
            result = old;
          } else {
            result = binop(node.op, old, rhs);
            assignTo(node.target, result);
          }
          record(node.line, `${c(unparse(node.target))} was ${c(oldText)}, so ${c(oldText)} ${node.op} ${c(repr(rhs))} gives ${c(repr(result))}.`);
          break;
        }
        case "If": {
          const t = truthy(evalExpr(node.test));
          const what = node.kw === "elif" ? "Check the next condition" : "Check";
          const next = t ? "Run the indented block below."
            : node.orelse.length ? "Skip that block and move on to the other branch." : "Skip the block.";
          record(node.line, `${what} ${c(unparse(node.test))} -> ${t ? "True" : "False"}. ${next}`);
          execBlock(t ? node.body : node.orelse);
          break;
        }
        case "While": {
          for (;;) {
            const t = truthy(evalExpr(node.test));
            record(node.line, `Check ${c(unparse(node.test))} -> ${t ? "True: run the loop body again." : "False: leave the loop."}`);
            if (!t) break;
            let broke = false;
            try { execBlock(node.body); }
            catch (e) { if (e instanceof BreakSignal) broke = true; else if (!(e instanceof ContinueSignal)) throw e; }
            if (broke) break;
          }
          break;
        }
        case "For": {
          const it = makeIter(evalExpr(node.iter));
          for (;;) {
            const r = it.next();
            if (r.done) { record(node.line, "No items left - the loop is finished."); break; }
            top().vars.set(node.target, r.value);
            record(node.line, `Loop: ${c(node.target)} takes the next value, ${c(repr(r.value))}.`);
            let broke = false;
            try { execBlock(node.body); }
            catch (e) { if (e instanceof BreakSignal) broke = true; else if (!(e instanceof ContinueSignal)) throw e; }
            if (broke) break;
          }
          break;
        }
        case "Def": {
          top().vars.set(node.name, new PyFunction(node.name, node.params, node.body, node.line));
          record(node.line, `Define the function ${c(node.name + "(" + node.params.join(", ") + ")")}. Its code only runs when something calls it.`);
          break;
        }
        case "Return": {
          const v = node.value ? evalExpr(node.value) : null;
          record(node.line, v === null && !node.value ? "Return nothing to the caller." : `Return ${c(repr(v))} to the caller - this call leaves the stack.`);
          throw new ReturnSignal(v);
        }
        case "Break":
          record(node.line, `${c("break")} - jump out of the loop right now.`);
          throw new BreakSignal();
        case "Continue":
          record(node.line, `${c("continue")} - skip the rest of this round and start the next one.`);
          throw new ContinueSignal();
        case "Pass":
          record(node.line, `${c("pass")} does nothing - it just fills the empty block.`);
          break;
        case "ExprStmt": {
          lastPrint = null;
          evalExpr(node.expr);
          const isPrint = node.expr.type === "Call" && node.expr.func.type === "Name" && node.expr.func.id === "print";
          if (isPrint && lastPrint !== null) record(node.line, lastPrint === "" ? "Print an empty line." : `Print ${c(lastPrint)} on the screen.`);
          else record(node.line, `Run ${c(unparse(node.expr))}.`);
          break;
        }
        default:
          throw new PyError("SyntaxError", "can't run this kind of statement: " + node.type, node.line);
      }
    }

    /* --- run the whole program --- */
    let error = null, truncated = false;
    try {
      execBlock(ast);
      steps.push(makeStep(null, "The program finished.", { done: true }));
    } catch (e) {
      if (e instanceof StopRun) truncated = true;
      else if (e instanceof PyError) {
        if (e.line == null) e.line = currentLine;
        steps.push(e.step || makeStep(e.line, `${e.kind}: ${e.message}`, { error: true }));
        error = { kind: e.kind, message: e.message, line: e.line };
      } else if (e instanceof RangeError) {
        error = { kind: "RecursionError", message: "the code is nested too deeply", line: currentLine };
        steps.push(makeStep(currentLine, `${error.kind}: ${error.message}`, { error: true }));
      } else throw e;
    }
    return { steps, error, truncated };
  }

  /* =====================================================================
     PUBLIC FUNCTION - this is what app.js calls
     ===================================================================== */
  function trace(source, userOpts) {
    const opts = Object.assign({}, LIMITS, userOpts || {});
    source = String(source || "").replace(/\s+$/, "");
    if (!source.trim()) {
      return { steps: [], truncated: false, error: { kind: "Empty", message: "Type or paste some Python code first.", line: null } };
    }
    const lineCount = source.split("\n").length;
    if (lineCount > opts.maxLines) {
      return { steps: [], truncated: false, error: { kind: "TooLong",
        message: `Your code has ${lineCount} lines, but CodeFlix v1 allows ${opts.maxLines}. Please shorten it.`, line: null } };
    }
    try {
      const ast = parse(tokenize(source));
      return execute(ast, opts);
    } catch (e) {
      if (e instanceof PyError) {
        return { steps: [], truncated: false, error: { kind: e.kind, message: e.message, line: e.line } };
      }
      return { steps: [], truncated: false, error: { kind: "InternalError",
        message: "Something unexpected went wrong inside CodeFlix (" + e.message + ").", line: null } };
    }
  }

  const api = { trace, LIMITS };
  global.CodeFlixTracer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // lets us test in Node
})(typeof window !== "undefined" ? window : globalThis);
