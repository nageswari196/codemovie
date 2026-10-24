/* =====================================================================
   CodeFlix C tracer  (ctracer.js)
   ---------------------------------------------------------------------
   A tiny interpreter for the BASICS of C. Like tracer.js (Python), it
   does not just run the program - it RECORDS one "step" per line that
   runs, in exactly the same format, so the same screen can play it.

   What it understands (v1):
     #include (ignored)   #define NAME value
     int long short char float double void
     variables, 1-D arrays, char arrays used as strings
     + - * / %   == != < > <= >=   && || !   ?:   & | ^ ~ << >>
     = += -= *= /= %=   ++ --   (type) casts   sizeof
     if / else if / else   while   do-while   for   break   continue
     functions with parameters and return (arrays are passed by reference)
     printf  puts  putchar  abs  fabs  sqrt  pow  floor  ceil  strlen

   NOT in v1 (it says so politely): pointers, scanf/input, structs,
   switch, 2-D arrays, malloc, files.

   Stages:  1. tokenize()  2. parse()  3. execute()

   Public API (used by app.js):
       const result = CodeFlixC.trace(sourceText);
       result.steps / result.error / result.truncated   (same as Python)
   ===================================================================== */
(function (global) {
  "use strict";

  const LIMITS = { maxLines: 30, maxSteps: 600, maxDepth: 40, maxSize: 10000 };

  class CError extends Error {
    constructor(kind, message, line) { super(message); this.kind = kind; this.line = line; }
  }
  class CF { constructor(v) { this.v = v; } }                 // a float / double value (ints are plain JS numbers)
  class CArray { constructor(base, len) { this.base = base; this.items = new Array(len).fill(undefined); } }

  /* =====================================================================
     STAGE 1 - TOKENIZER
     tokens: {t:"NUM"|"CHR"|"STR"|"NAME"|"OP"|"EOF", v, raw, line}
     ===================================================================== */
  const KEYWORDS = new Set(["if", "else", "while", "do", "for", "return", "break", "continue", "sizeof",
    "int", "long", "short", "char", "float", "double", "void", "unsigned", "signed", "const", "static"]);
  const TYPE_WORDS = new Set(["int", "long", "short", "char", "float", "double", "void", "unsigned", "signed", "const", "static"]);
  const UNSUPPORTED = {
    struct: "structs", union: "unions", typedef: "typedef", enum: "enums", switch: "switch statements", case: "switch statements",
    default: "switch statements", goto: "goto", extern: "extern", register: "register", volatile: "volatile", inline: "inline"
  };
  const UNSUPPORTED_CALLS = {
    scanf: "scanf() isn't supported in v1 - give the variable a value in your code, like  int age = 20;",
    gets: "gets() isn't supported in v1", fgets: "fgets() isn't supported in v1", getchar: "getchar() isn't supported in v1 - there is no keyboard input",
    malloc: "malloc() (pointers / dynamic memory) isn't supported in v1", calloc: "calloc() isn't supported in v1", free: "free() isn't supported in v1",
    strcpy: "strcpy() isn't supported in v1", strcmp: "strcmp() isn't supported in v1", strcat: "strcat() isn't supported in v1",
    fopen: "files aren't supported in v1", rand: "rand() isn't supported in v1", srand: "srand() isn't supported in v1", exit: "exit() isn't supported in v1 - use return"
  };

  function escapeChar(n) {
    return { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b" }[n] ?? n;
  }

  function lex(src, startLine, macros, directives) {
    const tokens = [];
    const n = src.length;
    let i = 0, line = startLine, lineStart = true;

    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; lineStart = true; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) throw new CError("SyntaxError", "this /* comment is never closed with */", line);
        line += (src.slice(i, end).match(/\n/g) || []).length;
        i = end + 2; continue;
      }

      // --- #include / #define lines ---
      if (c === "#" && lineStart && directives) {
        let j = i; while (j < n && src[j] !== "\n") j++;
        const text = src.slice(i + 1, j).trim();
        const def = /^define\s+([A-Za-z_]\w*)(\(?)\s*(.*)$/.exec(text);
        if (def) {
          if (def[2]) throw new CError("SyntaxError", "#define macros with parameters aren't supported in v1 - write a function instead", line);
          if (!def[3]) throw new CError("SyntaxError", `#define ${def[1]} needs a value, like  #define ${def[1]} 10`, line);
          macros[def[1]] = def[3].trim();
        }
        i = j; continue;
      }
      lineStart = false;

      // --- numbers ---
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
        const m = /^(0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([fFlLuU]*)/.exec(src.slice(i));
        const hex = /^0[xX]/.test(m[1]);
        const isFloat = !hex && (/[.eE]/.test(m[1]) || /[fF]/.test(m[2]));
        tokens.push({ t: "NUM", v: hex ? parseInt(m[1], 16) : parseFloat(m[1]), isFloat, raw: m[0], line });
        i += m[0].length; continue;
      }

      // --- names (and #define replacements) ---
      if (/[A-Za-z_]/.test(c)) {
        const word = /^[A-Za-z_]\w*/.exec(src.slice(i))[0];
        i += word.length;
        if (Object.prototype.hasOwnProperty.call(macros, word)) {
          lex(macros[word], line, {}, false).forEach((t) => { if (t.t !== "EOF") tokens.push(Object.assign(t, { line })); });
        } else tokens.push({ t: "NAME", v: word, raw: word, line });
        continue;
      }

      // --- "strings" ---
      if (c === '"') {
        let j = i + 1, s = "";
        while (j < n && src[j] !== '"' && src[j] !== "\n") {
          if (src[j] === "\\" && j + 1 < n) { s += escapeChar(src[j + 1]); j += 2; } else { s += src[j]; j++; }
        }
        if (j >= n || src[j] !== '"') throw new CError("SyntaxError", 'this string is missing its closing quote (")', line);
        tokens.push({ t: "STR", v: s, raw: src.slice(i, j + 1), line });
        i = j + 1; continue;
      }

      // --- 'c' characters ---
      if (c === "'") {
        let j = i + 1, s = "";
        while (j < n && src[j] !== "'" && src[j] !== "\n") {
          if (src[j] === "\\" && j + 1 < n) { s += escapeChar(src[j + 1]); j += 2; } else { s += src[j]; j++; }
        }
        if (j >= n || src[j] !== "'") throw new CError("SyntaxError", "this character is missing its closing quote (')", line);
        if (s.length !== 1) throw new CError("SyntaxError", "single quotes hold exactly ONE character, like 'a'. For text use double quotes: \"hello\"", line);
        tokens.push({ t: "CHR", v: s.charCodeAt(0), raw: src.slice(i, j + 1), line });
        i = j + 1; continue;
      }

      // --- operators ---
      const three = src.substr(i, 3), two = src.substr(i, 2);
      if (three === "<<=" || three === ">>=") { tokens.push({ t: "OP", v: three, line }); i += 3; continue; }
      if (["++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "->"].includes(two)) {
        tokens.push({ t: "OP", v: two, line }); i += 2; continue;
      }
      if ("+-*/%<>=!&|^~?:;,(){}[].".includes(c)) { tokens.push({ t: "OP", v: c, line }); i++; continue; }
      throw new CError("SyntaxError", `unexpected character '${c}'`, line);
    }
    tokens.push({ t: "EOF", line });
    return tokens;
  }

  function tokenize(src) { return lex(src, 1, {}, true); }

  /* =====================================================================
     STAGE 2 - PARSER
     ===================================================================== */
  const ASSIGN_OPS = ["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="];
  const PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  const NO_POINTERS = "pointers (*) aren't supported in v1 - try plain variables and arrays";

  function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const isOp = (v) => peek().t === "OP" && peek().v === v;
    const isName = (v) => peek().t === "NAME" && peek().v === v;
    const isTypeStart = (tok) => tok.t === "NAME" && TYPE_WORDS.has(tok.v);

    function fail(msg, tok) { throw new CError("SyntaxError", msg, (tok || peek()).line); }
    function describeTok(t) {
      if (t.t === "EOF") return "the end of the program";
      if (t.t === "STR") return "a string";
      if (t.t === "CHR") return "a character";
      if (t.t === "NUM") return t.raw;
      return "'" + t.v + "'";
    }
    function expectOp(v, hint) {
      if (!isOp(v)) fail(hint || `expected '${v}' but found ${describeTok(peek())}`);
      return next();
    }
    function expectSemi() {                                   // a missing ; belongs to the line BEFORE
      if (!isOp(";")) {
        const prev = tokens[pos - 1] || peek();
        throw new CError("SyntaxError", `missing ';' at the end of this line (found ${describeTok(peek())} instead)`, prev.line);
      }
      next();
    }

    /* ----- types ----- */
    function parseType() {
      const words = [];
      while (isTypeStart(peek())) words.push(next().v);
      let base = "int";
      if (words.includes("void")) base = "void";
      else if (words.includes("double")) base = "double";
      else if (words.includes("float")) base = "float";
      else if (words.includes("char")) base = "char";
      else if (words.includes("short")) base = "short";
      else if (words.includes("long")) base = "long";
      if (isOp("*")) fail(NO_POINTERS);
      return base;
    }

    /* ----- declarations:  int a = 1, b[3] = {1,2,3}; ----- */
    function parseDecl(vtype, line, noSemi) {
      if (vtype === "void") fail("a variable can't have type 'void'");
      const decls = [];
      do {
        const nameTok = next();
        if (nameTok.t !== "NAME" || KEYWORDS.has(nameTok.v)) fail("expected a variable name here", nameTok);
        if (isOp("*")) fail(NO_POINTERS);
        const d = { name: nameTok.v, isArray: false, size: null, init: null };
        if (isOp("[")) {
          next(); d.isArray = true;
          if (!isOp("]")) d.size = parseAssign();
          expectOp("]", "this [ is missing its closing ]");
          if (isOp("[")) fail("2-D arrays aren't supported in v1 - use a 1-D array");
        }
        if (isOp("=")) {
          next();
          if (isOp("{")) {
            const open = next(); const items = [];
            while (!isOp("}")) {
              if (peek().t === "EOF") fail("this { list is never closed with }", open);
              items.push(parseAssign());
              if (isOp(",")) next(); else if (!isOp("}")) fail("values in { } must be separated by commas");
            }
            next();
            d.init = { type: "InitList", items, line: open.line };
          } else d.init = parseAssign();
        }
        decls.push(d);
        if (isOp(",")) next(); else break;
      } while (true);
      if (!noSemi) expectSemi();
      return { type: "Decl", line, vtype, decls };
    }

    /* ----- statements ----- */
    function parseBlock() {
      const open = expectOp("{");
      const body = [];
      while (!isOp("}")) {
        if (peek().t === "EOF") fail("this { is never closed with a }", open);
        body.push(parseStatement());
      }
      next();
      return { type: "Block", line: open.line, body };
    }
    function parseBody() {                                    // body of if/while/for: a block or ONE statement
      if (isOp("{")) return parseBlock();
      const s = parseStatement();
      return { type: "Block", line: s.line, body: [s] };
    }
    function parseParenExpr() {
      expectOp("(", "expected '(' here");
      const e = parseExprComma();
      expectOp(")", "this ( is missing its closing )");
      return e;
    }

    function parseStatement() {
      const tok = peek();
      if (tok.t === "NAME") {
        if (UNSUPPORTED[tok.v]) fail(`'${tok.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[tok.v]})`);
        if (tok.v === "else") fail("'else' has no matching 'if' above it");
        if (tok.v === "if") return parseIf(false);
        if (tok.v === "while") { next(); const test = parseParenExpr(); return { type: "While", line: tok.line, test, body: parseBody() }; }
        if (tok.v === "do") {
          next(); const body = parseBody();
          if (!isName("while")) fail("a do { ... } block must be followed by  while (condition);");
          const w = next(); const test = parseParenExpr(); expectSemi();
          return { type: "DoWhile", line: tok.line, condLine: w.line, test, body };
        }
        if (tok.v === "for") return parseFor();
        if (tok.v === "return") {
          next();
          const value = isOp(";") ? null : parseExprComma();
          expectSemi();
          return { type: "Return", line: tok.line, value };
        }
        if (tok.v === "break" || tok.v === "continue") { next(); expectSemi(); return { type: tok.v === "break" ? "Break" : "Continue", line: tok.line }; }
        if (isTypeStart(tok)) { const ty = parseType(); return parseDecl(ty, tok.line, false); }
      }
      if (isOp("{")) return parseBlock();
      if (isOp(";")) { next(); return { type: "Empty", line: tok.line }; }
      const expr = parseExprComma();
      expectSemi();
      return { type: "ExprStmt", line: tok.line, expr };
    }

    function parseIf(isElseIf) {
      const head = next();
      const test = parseParenExpr();
      const body = parseBody();
      let orelse = null;
      if (isName("else")) {
        next();
        orelse = isName("if") ? parseIf(true) : parseBody();
      }
      return { type: "If", line: head.line, test, body, orelse, elseIf: isElseIf };
    }

    function parseFor() {
      const head = next();
      expectOp("(", "'for' must be followed by ( ... )");
      let init = null, test = null, update = null;
      if (!isOp(";")) {
        if (isTypeStart(peek())) { const ty = parseType(); init = parseDecl(ty, head.line, true); }
        else init = parseExprComma();
      }
      expectSemi();
      if (!isOp(";")) test = parseExprComma();
      expectSemi();
      if (!isOp(")")) update = parseExprComma();
      expectOp(")", "this for ( ... is missing its closing )");
      return { type: "For", line: head.line, init, test, update, body: parseBody() };
    }

    /* ----- expressions (lowest precedence first) ----- */
    function parseExprComma() {
      const first = parseAssign();
      if (!isOp(",")) return first;
      const items = [first];
      while (isOp(",")) { next(); items.push(parseAssign()); }
      return { type: "Comma", items, line: first.line };
    }

    function parseAssign() {
      const left = parseTernary();
      if (peek().t === "OP" && ASSIGN_OPS.includes(peek().v)) {
        const t = next();
        if (left.type !== "Name" && left.type !== "Index") fail("the left side of " + t.v + " must be a variable or an array item", t);
        return { type: "Assign", op: t.v, target: left, value: parseAssign(), line: t.line };
      }
      return left;
    }

    function parseTernary() {
      const test = parseBinary(1);
      if (isOp("?")) {
        const t = next();
        const a = parseAssign();
        expectOp(":", "the ? needs a matching ':'  (condition ? yes : no)");
        const b = parseAssign();
        return { type: "Cond", test, a, b, line: t.line };
      }
      return test;
    }

    function parseBinary(minPrec) {
      let left = parseUnary();
      for (;;) {
        const t = peek();
        const prec = t.t === "OP" ? PREC[t.v] : undefined;
        if (!prec || prec < minPrec) break;
        next();
        const right = parseBinary(prec + 1);
        left = { type: "Binary", op: t.v, left, right, line: t.line };
      }
      return left;
    }

    function parseUnary() {
      const t = peek();
      if (t.t === "OP") {
        if (t.v === "&" || t.v === "*") fail(NO_POINTERS);
        if (t.v === "!" || t.v === "-" || t.v === "+" || t.v === "~") { next(); return { type: "Unary", op: t.v, operand: parseUnary(), line: t.line }; }
        if (t.v === "++" || t.v === "--") {
          next(); const target = parseUnary();
          if (target.type !== "Name" && target.type !== "Index") fail("'" + t.v + "' only works on a variable or array item", t);
          return { type: "IncDec", op: t.v, prefix: true, target, line: t.line };
        }
        if (t.v === "(" && isTypeStart(tokens[pos + 1])) {                  // a cast:  (int) x
          next(); const ctype = parseType();
          expectOp(")", "this cast is missing its closing )");
          return { type: "Cast", ctype, expr: parseUnary(), line: t.line };
        }
      }
      if (t.t === "NAME" && t.v === "sizeof") {
        next();
        if (isOp("(") && isTypeStart(tokens[pos + 1])) {
          next(); const base = parseType(); expectOp(")", "this sizeof( is missing its closing )");
          return { type: "Sizeof", base, text: base, line: t.line };
        }
        const expr = parseUnary();
        return { type: "Sizeof", expr, text: unparse(expr), line: t.line };
      }
      return parsePostfix();
    }

    function parsePostfix() {
      let node = parsePrimary();
      for (;;) {
        if (isOp("[")) {
          const t = next();
          const index = parseExprComma();
          expectOp("]", "this [ is missing its closing ]");
          node = { type: "Index", obj: node, index, line: t.line };
        } else if (isOp("(")) {
          const t = next();
          if (node.type !== "Name") fail("only a function name can be followed by ( )", t);
          if (UNSUPPORTED_CALLS[node.id]) fail(UNSUPPORTED_CALLS[node.id], tokens[pos - 2]);
          const args = [];
          while (!isOp(")")) {
            if (peek().t === "EOF" || isOp(";")) fail("this function call is missing its closing ')'", t);
            args.push(parseAssign());
            if (isOp(",")) next(); else if (!isOp(")")) fail("arguments must be separated by commas");
          }
          next();
          node = { type: "Call", name: node.id, args, line: t.line };
        } else if (isOp("++") || isOp("--")) {
          const t = next();
          if (node.type !== "Name" && node.type !== "Index") fail("'" + t.v + "' only works on a variable or array item", t);
          node = { type: "IncDec", op: t.v, prefix: false, target: node, line: t.line };
        } else if (isOp(".") || isOp("->")) {
          fail("structs ( . and -> ) aren't supported in v1");
        } else break;
      }
      return node;
    }

    function parsePrimary() {
      const t = peek();
      if (t.t === "NUM") { next(); return { type: "Num", value: t.v, isFloat: t.isFloat, raw: t.raw, line: t.line }; }
      if (t.t === "CHR") { next(); return { type: "Chr", value: t.v, raw: t.raw, line: t.line }; }
      if (t.t === "STR") { next(); return { type: "Str", value: t.v, raw: t.raw, line: t.line }; }
      if (t.t === "NAME") {
        if (UNSUPPORTED[t.v]) fail(`'${t.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[t.v]})`);
        if (KEYWORDS.has(t.v)) fail(`'${t.v}' is a C keyword - it can't be used here`);
        next();
        return { type: "Name", id: t.v, line: t.line };
      }
      if (t.t === "OP" && t.v === "(") {
        next();
        const e = parseExprComma();
        expectOp(")", "this ( is missing its closing )");
        e.paren = true;
        return e;
      }
      fail(`unexpected ${describeTok(t)} - C expected a value here`);
    }

    /* ----- the whole program: functions, global variables ----- */
    const program = [];
    while (peek().t !== "EOF") {
      const tok = peek();
      if (tok.t === "NAME" && UNSUPPORTED[tok.v]) fail(`'${tok.v}' isn't supported in CodeFlix v1 (${UNSUPPORTED[tok.v]})`);
      if (isOp("}")) fail("unexpected '}' - there is no matching '{'");
      if (!isTypeStart(tok)) fail(`unexpected ${describeTok(tok)} - at the top level C expects a function or a variable, starting with a type like int`);
      const rtype = parseType();
      const nameTok = peek();
      if (nameTok.t !== "NAME" || KEYWORDS.has(nameTok.v)) fail("expected a name here", nameTok);
      if (tokens[pos + 1].t === "OP" && tokens[pos + 1].v === "(") {         // a function
        next(); next();
        const params = [];
        if (isName("void") && tokens[pos + 1].t === "OP" && tokens[pos + 1].v === ")") next();
        while (!isOp(")")) {
          if (peek().t === "EOF") fail("this function's ( is never closed", nameTok);
          if (!isTypeStart(peek())) fail("each parameter needs a type, like  int n", peek());
          const base = parseType();
          const p = next();
          if (p.t !== "NAME" || KEYWORDS.has(p.v)) fail("expected a parameter name here", p);
          let isArray = false;
          if (isOp("[")) { next(); if (!isOp("]")) parseAssign(); expectOp("]"); isArray = true; }
          params.push({ name: p.v, base, isArray });
          if (isOp(",")) next(); else if (!isOp(")")) fail("parameters must be separated by commas");
        }
        next();
        if (isOp(";")) { next(); continue; }                                   // a prototype - nothing to run
        if (!isOp("{")) fail("a function needs its body in { } after the ( )");
        program.push({ type: "Func", name: nameTok.v, rtype, params, line: nameTok.line, body: parseBlock() });
      } else {
        program.push(parseDecl(rtype, nameTok.line, false));                    // a global variable
      }
    }
    return program;
  }

  /* ---------- Turn an expression tree back into text (for narration) ---------- */
  function unparse(n) {
    let s;
    switch (n.type) {
      case "Num": case "Chr": s = n.raw; break;
      case "Str": s = n.raw; break;
      case "Name": s = n.id; break;
      case "Index": s = unparse(n.obj) + "[" + unparse(n.index) + "]"; break;
      case "Call": s = n.name + "(" + n.args.map(unparse).join(", ") + ")"; break;
      case "Unary": s = n.op + unparse(n.operand); break;
      case "IncDec": s = n.prefix ? n.op + unparse(n.target) : unparse(n.target) + n.op; break;
      case "Binary": s = unparse(n.left) + " " + n.op + " " + unparse(n.right); break;
      case "Assign": s = unparse(n.target) + " " + n.op + " " + unparse(n.value); break;
      case "Cond": s = unparse(n.test) + " ? " + unparse(n.a) + " : " + unparse(n.b); break;
      case "Cast": s = "(" + n.ctype + ")" + unparse(n.expr); break;
      case "Sizeof": s = "sizeof(" + n.text + ")"; break;
      case "Comma": s = n.items.map(unparse).join(", "); break;
      case "InitList": s = "{" + n.items.map(unparse).join(", ") + "}"; break;
      default: s = "?";
    }
    return n.paren ? "(" + s + ")" : s;
  }
  const c = (s) => "`" + s + "`";
  const declText = (d) => d.vtype + " " + d.decls.map((x) => x.name + (x.isArray ? "[" + (x.size ? unparse(x.size) : "") + "]" : "") + (x.init ? " = " + unparse(x.init) : "")).join(", ");

  /* =====================================================================
     STAGE 3 - EXECUTOR
     ===================================================================== */
  class BreakSignal {}
  class ContinueSignal {}
  class ReturnSignal { constructor(value) { this.value = value; } }
  class StopRun {}

  const SIZES = { char: 1, short: 2, int: 4, long: 8, float: 4, double: 8, void: 1 };
  const isF = (v) => v instanceof CF;
  const isScalar = (v) => typeof v === "number" || v instanceof CF;
  const numVal = (v) => (v instanceof CF ? v.v : v);

  function fmtFloat(x, base) {
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
    let s = String(parseFloat(x.toPrecision(base === "float" ? 7 : 15)));
    if (/^-?\d+$/.test(s)) s += ".0";
    return s;
  }
  function charRepr(n) {
    if (n === 0) return "'\\0'";
    if (n === 10) return "'\\n'";
    if (n === 9) return "'\\t'";
    if (n >= 32 && n <= 126) return "'" + String.fromCharCode(n) + "'";
    return String(n);
  }
  // how a single value is shown, given its declared type
  function repr(base, v) {
    if (v === undefined) return "?";
    if (isF(v)) return fmtFloat(v.v, base);
    if (base === "char") return charRepr(v);
    return String(v);
  }
  function arrayText(arr) { return "[" + arr.items.map((x) => repr(arr.base, x)).join(", ") + "]"; }
  function arrayToString(arr) {
    let s = "";
    for (const x of arr.items) { if (x === 0 || x === undefined) break; s += String.fromCharCode(x); }
    return s;
  }

  // Convert a value so it fits a variable of this type (like C does on assignment)
  function coerce(base, v) {
    if (v === undefined) throw new CError("TypeError", "this value doesn't exist - a function with type 'void' gives nothing back", null);
    if (v instanceof CArray) throw new CError("TypeError", "you can't store a whole array in one variable", null);
    if (typeof v === "string") throw new CError("TypeError", 'text in "quotes" can only be used in printf(...) or to fill a char array like  char name[] = "Asha";', null);
    const x = numVal(v);
    switch (base) {
      case "float": return new CF(Math.fround(x));
      case "double": return new CF(x);
      case "char": return (Math.trunc(x) << 24) >> 24;
      case "short": return (Math.trunc(x) << 16) >> 16;
      case "int": return Math.trunc(x) | 0;
      case "long": return Math.trunc(x);
      default: return x;
    }
  }

  function binop(op, a, b) {
    if (!isScalar(a) || !isScalar(b)) {
      const bad = !isScalar(a) ? a : b;
      throw new CError("TypeError", `can't use '${op}' with ${bad instanceof CArray ? "a whole array" : typeof bad === "string" ? "text" : "a missing value"}`, null);
    }
    const x = numVal(a), y = numVal(b);
    const anyFloat = isF(a) || isF(b);
    let r;
    switch (op) {
      case "+": r = x + y; break;
      case "-": r = x - y; break;
      case "*": r = x * y; break;
      case "/":
        if (anyFloat) return new CF(x / y);
        if (y === 0) throw new CError("ZeroDivisionError", "division by zero (C would crash here)", null);
        return Math.trunc(x / y);
      case "%":
        if (anyFloat) throw new CError("TypeError", "'%' only works on whole numbers (int / char)", null);
        if (y === 0) throw new CError("ZeroDivisionError", "remainder by zero (C would crash here)", null);
        return x % y;
      case "==": return x === y ? 1 : 0;
      case "!=": return x !== y ? 1 : 0;
      case "<": return x < y ? 1 : 0;
      case ">": return x > y ? 1 : 0;
      case "<=": return x <= y ? 1 : 0;
      case ">=": return x >= y ? 1 : 0;
      case "&": case "|": case "^": case "<<": case ">>":
        if (anyFloat) throw new CError("TypeError", `'${op}' only works on whole numbers (int / char)`, null);
        return op === "&" ? (x & y) : op === "|" ? (x | y) : op === "^" ? (x ^ y) : op === "<<" ? (x << y) : (x >> y);
      default: throw new CError("SyntaxError", "unknown operator " + op, null);
    }
    if (anyFloat) return new CF(r);
    if (!Number.isSafeInteger(r)) throw new CError("OverflowError", "that number is too big for CodeFlix v1 - try smaller numbers", null);
    return r;
  }

  // printf("...", values)
  function formatPrintf(fmt, args) {
    let ai = 0;
    return fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|L|z)?([diuoxXfFeEgGcsp%])/g, (m, flags, width, prec, conv) => {
      if (conv === "%") return "%";
      if (ai >= args.length) throw new CError("TypeError", `printf has more % codes than values (this one is ${m})`, null);
      const a = args[ai++];
      const needInt = () => { if (typeof a !== "number") throw new CError("TypeError", `'${m}' needs a whole number (int or char) but got ${isF(a) ? "a float - use %f" : "something else"}`, null); };
      let s, numeric = true;
      switch (conv) {
        case "d": case "i": needInt(); s = String(a); break;
        case "u": needInt(); s = String(a >>> 0); break;
        case "x": needInt(); s = (a >>> 0).toString(16); break;
        case "X": needInt(); s = (a >>> 0).toString(16).toUpperCase(); break;
        case "o": needInt(); s = (a >>> 0).toString(8); break;
        case "c": needInt(); s = String.fromCharCode(a); numeric = false; break;
        case "s":
          numeric = false;
          if (typeof a === "string") s = a;
          else if (a instanceof CArray) s = arrayToString(a);
          else throw new CError("TypeError", "'%s' needs text or a char array", null);
          if (prec !== undefined) s = s.slice(0, Number(prec));
          break;
        case "f": case "F":
          if (!isF(a)) throw new CError("TypeError", `'${m}' needs a float or double but got a whole number - convert it first, e.g. (float)x`, null);
          s = a.v.toFixed(prec === undefined ? 6 : Number(prec)); break;
        case "e": case "E":
          if (!isF(a)) throw new CError("TypeError", `'${m}' needs a float or double`, null);
          s = a.v.toExponential(prec === undefined ? 6 : Number(prec)).replace(/e([+-])(\d)$/, "e$10$2"); if (conv === "E") s = s.toUpperCase(); break;
        case "g": case "G":
          if (!isF(a)) throw new CError("TypeError", `'${m}' needs a float or double`, null);
          s = String(parseFloat(a.v.toPrecision(prec === undefined ? 6 : Math.max(1, Number(prec))))); break;
        default: throw new CError("TypeError", `printf code ${m} isn't supported in v1`, null);
      }
      if (numeric && /^[-]?\d/.test(s) || numeric && /^-?(inf|nan)/.test(s)) {
        if (flags.includes("+") && !s.startsWith("-")) s = "+" + s;
        else if (flags.includes(" ") && !s.startsWith("-")) s = " " + s;
      }
      if (width && s.length < Number(width)) {
        const w = Number(width);
        if (flags.includes("-")) s = s.padEnd(w);
        else if (flags.includes("0") && numeric) { const sign = /^[-+ ]/.test(s) ? s[0] : ""; s = sign + s.slice(sign.length).padStart(w - sign.length, "0"); }
        else s = s.padStart(w);
      }
      return s;
    });
  }

  function execute(program, opts) {
    const steps = [];
    const funcs = new Map();
    const globals = new Map();               // name -> variable
    const frames = [];
    let output = "";
    let lastPrint = null;
    let currentLine = 0;
    const top = () => frames[frames.length - 1];

    // A variable is { base:"int", isArray:false, value }  (value is a CArray for arrays)
    function newFrame(name, fn, params, line) {
      return { name, fn, params, scopes: [new Map()], last: new Map(), lastItems: new Map(), line };
    }
    function typeLabel(v) { return v.isArray ? `${v.base}[${v.value.items.length}]` : v.base; }

    /* --- snapshots: what the screen draws for one step --- */
    function visibleVars(frame) {
      const m = new Map();
      globals.forEach((v, k) => m.set(k, v));
      frame.scopes.forEach((sc) => sc.forEach((v, k) => { m.delete(k); m.set(k, v); }));
      return m;
    }
    function snapshotVars(frame) {
      const list = [], newLast = new Map(), newItems = new Map();
      visibleVars(frame).forEach((v, name) => {
        const items = v.isArray ? v.value.items.map((x) => repr(v.base, x)) : null;
        const text = v.isArray ? arrayText(v.value) : repr(v.base, v.value);
        const prev = frame.lastItems.get(name);
        list.push({
          name, type: typeLabel(v), text, items,
          changed: frame.last.get(name) !== text,
          changedItems: items && prev ? items.map((t, i) => prev[i] !== t) : null
        });
        newLast.set(name, text); newItems.set(name, items);
      });
      frame.last = newLast; frame.lastItems = newItems;
      return list;
    }
    function argText(f, p) {
      const v = f.scopes[0].get(p.name);
      return v ? p.name + "=" + (v.isArray ? arrayText(v.value) : repr(v.base, v.value)) : p.name + "=?";
    }
    function makeStep(line, note, extra) {
      const frame = top();
      return Object.assign({
        line, note, scope: frame.name,
        vars: snapshotVars(frame),
        stack: frames.map((f) => ({ name: f.name, args: f.params.map((p) => argText(f, p)).join(", "), line: f.line })),
        output
      }, extra || {});
    }
    function record(line, note) {
      if (steps.length >= opts.maxSteps) throw new StopRun();
      steps.push(makeStep(line, note));
    }

    /* --- variables --- */
    function lookup(name) {
      const f = top();
      for (let i = f.scopes.length - 1; i >= 0; i--) if (f.scopes[i].has(name)) return f.scopes[i].get(name);
      return globals.get(name) || null;
    }
    function needVar(name) {
      const v = lookup(name);
      if (!v) throw new CError("NameError", `the name '${name}' isn't declared - did you misspell it, or forget to write its type (like int ${name};)?`, null);
      return v;
    }
    function declare(target, name, v) {
      if (target.has(name)) throw new CError("NameError", `'${name}' is already declared in this block`, null);
      target.set(name, v);
    }

    /* --- array helpers --- */
    function arrayOf(node) {
      if (node.type !== "Name") throw new CError("TypeError", "2-D arrays and indexing a value that isn't a simple array name aren't supported in v1", null);
      const v = needVar(node.id);
      if (!v.isArray) throw new CError("TypeError", `'${node.id}' is not an array, so it can't be used with [ ]`, null);
      return v;
    }
    function indexFor(arrVar, name, idx) {
      if (typeof idx !== "number") throw new CError("TypeError", "an array index must be a whole number", null);
      const len = arrVar.value.items.length;
      if (idx < 0 || idx >= len) throw new CError("IndexError", `index ${idx} is outside the array '${name}' (valid positions: 0 to ${len - 1}) - in real C this is a dangerous bug`, null);
      return idx;
    }

    /* --- evaluating expressions --- */
    function evalExpr(n) {
      switch (n.type) {
        case "Num": return n.isFloat ? new CF(n.value) : n.value;
        case "Chr": return n.value;
        case "Str": return n.value;
        case "Name": {
          const v = needVar(n.id);
          if (v.isArray) return v.value;
          if (v.value === undefined) throw new CError("RuntimeError", `'${n.id}' has no value yet - give it one first (real C would show a random "garbage" number here)`, null);
          return v.value;
        }
        case "Index": {
          const v = arrayOf(n.obj);
          const i = indexFor(v, n.obj.id, evalExpr(n.index));
          const x = v.value.items[i];
          if (x === undefined) throw new CError("RuntimeError", `${n.obj.id}[${i}] has no value yet - fill the array first (real C would show garbage)`, null);
          return x;
        }
        case "Call": return evalCall(n);
        case "Unary": {
          const v = evalExpr(n.operand);
          if (!isScalar(v)) throw new CError("TypeError", `can't use '${n.op}' here`, null);
          if (n.op === "!") return numVal(v) === 0 ? 1 : 0;
          if (n.op === "-") return isF(v) ? new CF(-v.v) : -v;
          if (n.op === "~") { if (isF(v)) throw new CError("TypeError", "'~' only works on whole numbers", null); return ~v; }
          return v;
        }
        case "IncDec": return doIncDec(n).value;
        case "Binary": {
          if (n.op === "&&") return numVal(evalExpr(n.left)) !== 0 && numVal(evalExpr(n.right)) !== 0 ? 1 : 0;
          if (n.op === "||") return numVal(evalExpr(n.left)) !== 0 || numVal(evalExpr(n.right)) !== 0 ? 1 : 0;
          return binop(n.op, evalExpr(n.left), evalExpr(n.right));
        }
        case "Assign": return doAssign(n).result;
        case "Cond": return numVal(evalExpr(n.test)) !== 0 ? evalExpr(n.a) : evalExpr(n.b);
        case "Cast": return coerce(n.ctype === "void" ? "int" : n.ctype, evalExpr(n.expr));
        case "Sizeof": {
          if (n.base) return SIZES[n.base];
          if (n.expr.type === "Name") { const v = needVar(n.expr.id); return v.isArray ? v.value.items.length * SIZES[v.base] : SIZES[v.base]; }
          if (n.expr.type === "Index" && n.expr.obj.type === "Name") { const v = needVar(n.expr.obj.id); return SIZES[v.base]; }
          return 4;
        }
        case "Comma": { let r; n.items.forEach((x) => { r = evalExpr(x); }); return r; }
        default: throw new CError("SyntaxError", "can't run this kind of expression: " + n.type, null);
      }
    }

    // store into a variable or array item; returns {base, value}
    function storeTo(target, value) {
      if (target.type === "Name") {
        const v = needVar(target.id);
        if (v.isArray) throw new CError("TypeError", `'${target.id}' is an array - you can't assign to the whole array; change one item like ${target.id}[0] = 5;`, null);
        v.value = coerce(v.base, value);
        return { base: v.base, value: v.value };
      }
      const v = arrayOf(target.obj);
      const i = indexFor(v, target.obj.id, evalExpr(target.index));
      v.value.items[i] = coerce(v.base, value);
      return { base: v.base, value: v.value.items[i] };
    }
    function readFrom(target) {                                    // current value (or undefined) of a target
      if (target.type === "Name") { const v = needVar(target.id); return { base: v.base, value: v.value }; }
      const v = arrayOf(target.obj);
      const i = indexFor(v, target.obj.id, evalExpr(target.index));
      return { base: v.base, value: v.value.items[i] };
    }

    function doAssign(n) {
      const rhs = evalExpr(n.value);
      let old = null, val = rhs;
      if (n.op !== "=") {
        old = readFrom(n.target);
        if (old.value === undefined) throw new CError("RuntimeError", `${unparse(n.target)} has no value yet, so ${n.op} can't use it`, null);
        val = binop(n.op.slice(0, -1), old.value, rhs);
      }
      const stored = storeTo(n.target, val);
      return { old, rhs, result: stored.value, base: stored.base };
    }
    function doIncDec(n) {
      const cur = readFrom(n.target);
      if (cur.value === undefined) throw new CError("RuntimeError", `${unparse(n.target)} has no value yet, so ${n.op} can't use it`, null);
      const nv = binop(n.op === "++" ? "+" : "-", cur.value, 1);
      const stored = storeTo(n.target, nv);
      return { old: cur.value, base: cur.base, result: stored.value, value: n.prefix ? stored.value : cur.value };
    }

    /* --- calls --- */
    function evalCall(n) {
      if (UNSUPPORTED_CALLS[n.name]) throw new CError("NotSupported", UNSUPPORTED_CALLS[n.name], null);
      if (n.name === "printf") return doPrintf(n);
      if (funcs.has(n.name)) return callUser(funcs.get(n.name), n.args.map(evalExpr));
      const args = n.args.map(evalExpr);
      const need = (k) => { if (args.length !== k) throw new CError("TypeError", `${n.name}() needs ${k} value${k === 1 ? "" : "s"} but got ${args.length}`, null); };
      const num = (i) => { if (!isScalar(args[i])) throw new CError("TypeError", `${n.name}() needs a number`, null); return numVal(args[i]); };
      switch (n.name) {
        case "puts": need(1); {
          const s = typeof args[0] === "string" ? args[0] : args[0] instanceof CArray ? arrayToString(args[0]) : null;
          if (s === null) throw new CError("TypeError", "puts() needs text or a char array", null);
          emit(s + "\n"); return 1;
        }
        case "putchar": need(1); emit(String.fromCharCode(num(0))); return num(0);
        case "abs": need(1); return Math.abs(Math.trunc(num(0)));
        case "fabs": need(1); return new CF(Math.abs(num(0)));
        case "sqrt": need(1); return new CF(Math.sqrt(num(0)));
        case "pow": need(2); return new CF(Math.pow(num(0), num(1)));
        case "floor": need(1); return new CF(Math.floor(num(0)));
        case "ceil": need(1); return new CF(Math.ceil(num(0)));
        case "strlen": need(1); {
          if (typeof args[0] === "string") return args[0].length;
          if (!(args[0] instanceof CArray)) throw new CError("TypeError", "strlen() needs text or a char array", null);
          return arrayToString(args[0]).length;
        }
        default: throw new CError("NameError", `the function '${n.name}' isn't defined - did you misspell it, or forget to write it above main()?`, null);
      }
    }

    function emit(text) {
      lastPrint = (lastPrint === null ? "" : lastPrint) + text;
      output += text;
      if (output.length > 4000) output = output.slice(0, 4000) + "...";
    }
    function doPrintf(n) {
      if (!n.args.length || n.args[0].type !== "Str") throw new CError("TypeError", 'printf needs text in "quotes" as its first value, like  printf("Hello\\n");', null);
      const vals = n.args.slice(1).map(evalExpr);
      emit(formatPrintf(n.args[0].value, vals));
      return 0;
    }

    function callUser(fn, args) {
      if (args.length !== fn.params.length) {
        throw new CError("TypeError", `${fn.name}() needs ${fn.params.length} value${fn.params.length === 1 ? "" : "s"} but got ${args.length}`, null);
      }
      if (frames.length >= opts.maxDepth) {
        throw new CError("RecursionError", `too many nested calls (limit ${opts.maxDepth}) - does the function ever stop calling itself?`, null);
      }
      const frame = newFrame(fn.name, fn, fn.params, fn.line);
      fn.params.forEach((p, i) => {
        const a = args[i];
        if (p.isArray) {
          if (!(a instanceof CArray)) throw new CError("TypeError", `${fn.name}() expects an array for '${p.name}'`, null);
          frame.scopes[0].set(p.name, { base: p.base, isArray: true, value: a });
        } else {
          if (a instanceof CArray) throw new CError("TypeError", `${fn.name}() expects a single value for '${p.name}', not a whole array`, null);
          frame.scopes[0].set(p.name, { base: p.base, isArray: false, value: coerce(p.base, a) });
        }
      });
      const callerLine = currentLine;
      const shown = args.map((a, i) => (a instanceof CArray ? arrayText(a) : repr(fn.params[i].base, frame.scopes[0].get(fn.params[i].name).value)));
      frames.push(frame);
      try {
        record(callerLine, `Call ${c(fn.name + "(" + shown.join(", ") + ")")} - a new box is added to the call stack.`);
        execBlock(fn.body);
        return undefined;                                  // ran off the end without return
      } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        if (e instanceof CError) {
          if (e.line == null) e.line = currentLine;
          if (!e.step) e.step = makeStep(e.line, `${e.kind}: ${e.message}`, { error: true });
        }
        throw e;
      } finally {
        frames.pop();
        currentLine = callerLine;
      }
    }

    /* --- statements --- */
    function execBlock(block) {
      const f = top();
      f.scopes.push(new Map());
      try { for (const s of block.body) execStmt(s); }
      finally { f.scopes.pop(); }
    }

    function execDecl(node, isGlobal) {
      const target = isGlobal ? globals : top().scopes[top().scopes.length - 1];
      const phrases = [];
      for (const d of node.decls) {
        const base = node.vtype;
        if (!d.isArray) {
          let value;
          if (d.init) {
            if (d.init.type === "InitList") throw new CError("TypeError", `'${d.name}' is a single variable, so it can't be filled with { }`, null);
            value = coerce(base, evalExpr(d.init));
          }
          declare(target, d.name, { base, isArray: false, value });
          if (d.init) {
            phrases.push(d.init.type === "Num" || d.init.type === "Chr"
              ? `Create ${c(base + " " + d.name)} and store ${c(repr(base, value))} in it.`
              : `Work out ${c(unparse(d.init))} = ${c(repr(base, value))} and store it in the new variable ${c(d.name)}.`);
          } else phrases.push(`Create ${c(base + " " + d.name)} - it has no value yet.`);
          continue;
        }
        // arrays
        let len = null;
        if (d.size) {
          const sz = evalExpr(d.size);
          if (typeof sz !== "number" || sz <= 0) throw new CError("TypeError", "an array size must be a positive whole number", null);
          len = sz;
        }
        let items = null;
        if (d.init && d.init.type === "InitList") items = d.init.items.map((x) => evalExpr(x));
        else if (d.init && d.init.type === "Str") {
          if (base !== "char") throw new CError("TypeError", "only a char array can be filled with text", null);
          items = Array.from(d.init.value).map((ch) => ch.charCodeAt(0)); items.push(0);
        } else if (d.init) throw new CError("TypeError", `an array needs { } or "text" to fill it`, null);
        if (len === null) {
          if (!items) throw new CError("TypeError", `array '${d.name}' needs a size, like ${d.name}[5]`, null);
          len = items.length;
        }
        if (len > opts.maxSize) throw new CError("MemoryError", `that array is too big for CodeFlix v1 (limit ${opts.maxSize} items)`, null);
        if (items && items.length > len) throw new CError("TypeError", `too many starting values for '${d.name}' (it has room for ${len})`, null);
        const arr = new CArray(base, len);
        if (items) for (let i = 0; i < len; i++) arr.items[i] = i < items.length ? coerce(base, items[i]) : 0;
        declare(target, d.name, { base, isArray: true, value: arr });
        phrases.push(items
          ? `Create the array ${c(base + " " + d.name + "[" + len + "]")} holding ${c(arrayText(arr))}.`
          : `Create the array ${c(base + " " + d.name + "[" + len + "]")} - its items have no values yet.`);
      }
      record(node.line, phrases.join(" "));
    }

    function runLoopBody(body) {                           // returns true if the loop must stop (break)
      try { execBlock(body); }
      catch (e) { if (e instanceof BreakSignal) return true; if (!(e instanceof ContinueSignal)) throw e; }
      return false;
    }

    function execStmt(node) {
      currentLine = node.line;
      top().line = node.line;
      switch (node.type) {
        case "Block": execBlock(node); break;
        case "Empty": break;
        case "Decl": execDecl(node, false); break;
        case "ExprStmt": execExprStmt(node); break;
        case "If": {
          const t = numVal(evalExpr(node.test)) !== 0;
          const what = node.elseIf ? "Check the next condition" : "Check";
          const nx = t ? "Run the block below." : node.orelse ? "Skip it and move to the other branch." : "Skip the block.";
          record(node.line, `${what} ${c(unparse(node.test))} -> ${t ? "True" : "False"}. ${nx}`);
          if (t) execBlock(node.body); else if (node.orelse) execStmt(node.orelse);
          break;
        }
        case "While": {
          for (;;) {
            const t = numVal(evalExpr(node.test)) !== 0;
            record(node.line, `Check ${c(unparse(node.test))} -> ${t ? "True: run the loop body again." : "False: leave the loop."}`);
            if (!t) break;
            if (runLoopBody(node.body)) break;
          }
          break;
        }
        case "DoWhile": {
          for (;;) {
            if (runLoopBody(node.body)) break;
            currentLine = node.condLine; top().line = node.condLine;
            const t = numVal(evalExpr(node.test)) !== 0;
            record(node.condLine, `Check ${c(unparse(node.test))} -> ${t ? "True: run the body again." : "False: leave the loop."}`);
            if (!t) break;
          }
          break;
        }
        case "For": {
          const f = top();
          f.scopes.push(new Map());
          try {
            let lead = "";
            if (node.init) {
              if (node.init.type === "Decl") {
                const target = f.scopes[f.scopes.length - 1];
                for (const d of node.init.decls) {
                  const value = d.init ? coerce(node.init.vtype, evalExpr(d.init)) : undefined;
                  declare(target, d.name, { base: node.init.vtype, isArray: false, value });
                }
                lead = `Start the loop: ${c(declText(node.init))}. `;
              } else { evalExpr(node.init); lead = `Start the loop: ${c(unparse(node.init))}. `; }
            }
            let first = true;
            for (;;) {
              if (!first && node.update) { evalExpr(node.update); lead = `Update ${c(unparse(node.update))}. `; }
              first = false;
              const t = node.test ? numVal(evalExpr(node.test)) !== 0 : true;
              record(node.line, `${lead}Check ${c(node.test ? unparse(node.test) : "(no condition)")} -> ${t ? "True: run the loop body." : "False: leave the loop."}`);
              lead = "";
              if (!t) break;
              if (runLoopBody(node.body)) break;
            }
          } finally { f.scopes.pop(); }
          break;
        }
        case "Return": {
          const fn = top().fn;
          let v;
          if (node.value) {
            if (fn.rtype === "void") throw new CError("TypeError", `${fn.name}() is 'void', so it can't return a value`, null);
            v = coerce(fn.rtype, evalExpr(node.value));
          }
          record(node.line, node.value
            ? `Return ${c(repr(fn.rtype, v))} to the caller${fn.name === "main" ? " - the program is about to end" : " - this call leaves the stack"}.`
            : "Return to the caller (nothing to give back).");
          throw new ReturnSignal(v);
        }
        case "Break": record(node.line, `${c("break")} - jump out of the loop right now.`); throw new BreakSignal();
        case "Continue": record(node.line, `${c("continue")} - skip the rest of this round and start the next one.`); throw new ContinueSignal();
        default: throw new CError("SyntaxError", "can't run this kind of statement: " + node.type, node.line);
      }
    }

    function execExprStmt(node) {
      const e = node.expr;
      lastPrint = null;
      if (e.type === "Assign") {
        const r = doAssign(e);
        const t = unparse(e.target);
        if (e.op === "=") {
          record(node.line, e.target.type === "Name"
            ? (e.value.type === "Num" || e.value.type === "Chr" ? `Store ${c(repr(r.base, r.result))} in ${c(t)}.` : `Work out ${c(unparse(e.value))} = ${c(repr(r.base, r.result))} and store it in ${c(t)}.`)
            : `Change the array item ${c(t)} to ${c(repr(r.base, r.result))}.`);
        } else {
          record(node.line, `${c(t)} was ${c(repr(r.base, r.old.value))}, so ${c(repr(r.base, r.old.value))} ${e.op.slice(0, -1)} ${c(repr(r.base, r.rhs))} gives ${c(repr(r.base, r.result))}.`);
        }
        return;
      }
      if (e.type === "IncDec") {
        const r = doIncDec(e);
        record(node.line, `${c(unparse(e))} changes ${c(unparse(e.target))} from ${c(repr(r.base, r.old))} to ${c(repr(r.base, r.result))}.`);
        return;
      }
      evalExpr(e);
      const isPrint = e.type === "Call" && (e.name === "printf" || e.name === "puts" || e.name === "putchar");
      if (isPrint && lastPrint !== null) {
        const shown = lastPrint.replace(/\n$/, "").replace(/\n/g, "\\n");
        record(node.line, shown === "" && lastPrint === "\n" ? "Print an empty line." : `Print ${c(shown)} on the screen.`);
      } else record(node.line, `Run ${c(unparse(e))}.`);
    }

    /* --- run the whole program --- */
    let error = null, truncated = false;
    try {
      program.forEach((item) => {
        if (item.type !== "Func") return;
        if (funcs.has(item.name)) throw new CError("NameError", `the function '${item.name}' is written twice`, item.line);
        funcs.set(item.name, item);
      });
      const mainFn = funcs.get("main");
      if (!mainFn) throw new CError("NoMain", "A C program needs a main() function - that is where it starts. Example:  int main() { ... return 0; }", null);
      frames.push(newFrame("main", mainFn, [], mainFn.line));
      for (const item of program) if (item.type === "Decl") { currentLine = item.line; execDecl(item, true); }
      try { execBlock(mainFn.body); }
      catch (e) { if (!(e instanceof ReturnSignal)) throw e; }
      steps.push(makeStep(null, "The program finished.", { done: true }));
    } catch (e) {
      if (e instanceof StopRun) truncated = true;
      else if (e instanceof CError) {
        if (e.line == null) e.line = currentLine || null;
        steps.push(e.step || (frames.length ? makeStep(e.line, `${e.kind}: ${e.message}`, { error: true }) : { line: e.line, note: `${e.kind}: ${e.message}`, scope: "main", vars: [], stack: [], output, error: true }));
        error = { kind: e.kind, message: e.message, line: e.line };
      } else if (e instanceof RangeError) {
        error = { kind: "RecursionError", message: "the code is nested too deeply", line: currentLine };
        steps.push(makeStep(currentLine, `${error.kind}: ${error.message}`, { error: true }));
      } else throw e;
    }
    if (error && error.kind === "NoMain") steps.length = 0;     // shown in the narration bar instead
    return { steps, error, truncated };
  }

  /* =====================================================================
     PUBLIC FUNCTION - this is what app.js calls
     ===================================================================== */
  function trace(source, userOpts) {
    const opts = Object.assign({}, LIMITS, userOpts || {});
    source = String(source || "").replace(/\s+$/, "");
    if (!source.trim()) {
      return { steps: [], truncated: false, error: { kind: "Empty", message: "Type or paste some C code first.", line: null } };
    }
    const lineCount = source.split("\n").length;
    if (lineCount > opts.maxLines) {
      return { steps: [], truncated: false, error: { kind: "TooLong",
        message: `Your code has ${lineCount} lines, but CodeFlix v1 allows ${opts.maxLines}. Please shorten it.`, line: null } };
    }
    try {
      return execute(parse(tokenize(source)), opts);
    } catch (e) {
      if (e instanceof CError) return { steps: [], truncated: false, error: { kind: e.kind, message: e.message, line: e.line } };
      return { steps: [], truncated: false, error: { kind: "InternalError",
        message: "Something unexpected went wrong inside CodeFlix (" + e.message + ").", line: null } };
    }
  }

  const api = { trace, LIMITS };
  global.CodeFlixC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
