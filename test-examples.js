// Run with:  node test-examples.js
// Checks that every gallery example (Python AND C) runs without error inside the v1 limits.
global.window = global;
const py = require("./tracer.js");
const cc = require("./ctracer.js");
require("./examples.js");
require("./examples-c.js");
let bad = 0;
for (const ex of window.CODEFLIX_EXAMPLES) {
  const isC = ex.lang === "c";
  const r = (isC ? cc : py).trace(ex.code);
  const lines = ex.code.split("\n").length;
  const ok = !r.error && !r.truncated && lines <= 30;
  if (!ok) bad++;
  const last = r.steps[r.steps.length - 1];
  console.log((ok ? "OK  " : "FAIL") + " " + (isC ? "C  " : "Py ") + ex.id.padEnd(24) + " lines=" + String(lines).padStart(2) +
    " steps=" + String(r.steps.length).padStart(3) + (r.error ? "  ERROR: " + r.error.message : "") +
    "  out=" + JSON.stringify((last ? last.output || "" : "").trim().split("\n").slice(-1)[0]));
}
// error-handling checks (Python)
for (const [name, code] of [["syntax", "x = = 3"], ["indent", "if True:\nprint(1)"], ["name", "print(y)"],
  ["too long", Array(31).fill("x = 1").join("\n")], ["infinite", "i = 0\nwhile True:\n    i += 1"],
  ["fstring", 'print(f"hi")'], ["import", "import os"]]) {
  const r = py.trace(code);
  console.log("PY-ERR " + name.padEnd(9) + " " + JSON.stringify(r.error), "steps=" + r.steps.length, "truncated=" + r.truncated);
}
// error-handling checks (C)
for (const [name, code] of [
  ["missing ;", "int main() {\n    int x = 5\n    return 0;\n}"],
  ["no main", "int x = 5;"],
  ["undeclared", "int main() {\n    y = 3;\n    return 0;\n}"],
  ["pointer", "int main() {\n    int *p;\n    return 0;\n}"],
  ["scanf", 'int main() {\n    int a;\n    scanf("%d", &a);\n    return 0;\n}'],
  ["div zero", "int main() {\n    int a = 1 / 0;\n    return 0;\n}"],
  ["out of range", "int main() {\n    int a[3] = {1,2,3};\n    a[5] = 1;\n    return 0;\n}"],
  ["%d with float", 'int main() {\n    float f = 1.5;\n    printf("%d", f);\n    return 0;\n}'],
  ["infinite", "int main() {\n    while (1) { }\n    return 0;\n}"],
  ["unclosed {", "int main() {\n    int x = 1;"],
  ["too long", Array(31).fill("int x;").join("\n")],
  ["recursion", "int f(int n) { return f(n + 1); }\nint main() {\n    f(1);\n    return 0;\n}"],
  ["uninit read", "int main() {\n    int a;\n    int b = a + 1;\n    return 0;\n}"]]) {
  const r = cc.trace(code);
  console.log("C-ERR  " + name.padEnd(14) + " " + JSON.stringify(r.error), "steps=" + r.steps.length, "truncated=" + r.truncated);
}
process.exit(bad ? 1 : 0);
