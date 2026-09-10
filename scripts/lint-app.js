#!/usr/bin/env node
//
// Lints the inline <script> blocks in a single-file page.
//
// Why this exists: every function in app.html is a global, because
// onclick="foo()" resolves against window. Nothing enforces that `foo` still
// exists — rename it and you get a button that throws when a user taps it, with
// no build step and no import to break. The Playwright suite covers the flows it
// covers; it cannot cover 600 inline handlers.
//
// no-undef catches both halves of that: calls to functions that no longer
// exist, and accidental globals from a missing const. Handler names referenced
// only from HTML attributes are checked too — see collectHandlerNames.
//
// ESLint can't read .html, so the script blocks are extracted into a buffer that
// keeps every statement on its original line. Reported line numbers are
// therefore app.html's own, and clickable.
//
//   node scripts/lint-app.js [file ...]     (defaults to app.html)

const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
// Only actual JavaScript — skips the application/ld+json block in <head>, which
// is data and doesn't parse as JS.
const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);

function isJavaScript(attrs) {
  const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs);
  return JS_TYPES.has((type ? type[1] : '').trim().toLowerCase());
}
// Attribute handlers are JS too: onclick="foo()" etc.
const HANDLER_RE = /\bon[a-z]+="([^"]*)"/gi;
// …and some handlers are data, not markup: notifActionButtons builds rows like
// { label: '…', onclick: `notifBlockCrew('${id}')` } which are written into an
// attribute later. Same thing as far as "does this function still exist" goes.
const HANDLER_PROP_RE = /\bon[a-z]+\s*:\s*(`[^`]*`|'[^']*')/gi;

// The escaping trap this codebase has fallen into three times. An HTML
// attribute is HTML-decoded BEFORE its JavaScript is parsed, so escHtml's
// &#39; is a plain quote again by the time the string is read — which closes
// the JS string early and lets whatever follows run. escHtml is an HTML-TEXT
// escaper; a JS string needs escJsAttr (or _tagEscAttr in the tag sheet).
// Matches an interpolation that OPENS a single-quoted string inside a handler.
const UNSAFE_ESCAPE_RE = /('\$\{\s*)(escHtml|escapeHtml)\s*\(/g;
// Same position, but carrying a bare identifier. Whether that is safe depends
// on what the identifier holds, which collectJsSafeNames works out below.
const RAW_INTERP_RE = /'\$\{\s*(?!escJsAttr|_tagEscAttr|escHtml|escapeHtml)([A-Za-z_$][\w$.?[\]]*)\s*\}'/g;

/**
 * Locals assigned nothing but escJsAttr()/_tagEscAttr() calls. Several render
 * paths hoist an escaped id into a variable and interpolate that, which is
 * fine — but only if every assignment escapes. A name assigned escHtml()
 * anywhere is NOT safe here, however id-like it looks: escHtml is the wrong
 * escaper for a JS string, and hiding it behind a variable does not change that.
 */
function collectJsSafeNames(code) {
  const assigned = new Map(); // name -> Set of escaper names ('' = none)
  const RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)?\s*\(?/g;
  let m;
  while ((m = RE.exec(code))) {
    const [, name, callee] = m;
    if (!assigned.has(name)) assigned.set(name, new Set());
    assigned.get(name).add(callee || '');
  }
  const safe = new Set();
  for (const [name, callees] of assigned) {
    if (callees.size && [...callees].every(c => c === 'escJsAttr' || c === '_tagEscAttr')) safe.add(name);
  }
  return safe;
}

/**
 * Every interpolation inside an inline handler that lands in a JS string
 * without a JS-string escaper. Reported with the handler text so the fix is
 * obvious from the console line alone.
 */
function collectUnsafeInterpolations(html, jsSafeNames = new Set()) {
  const out = [];
  HANDLER_RE.lastIndex = 0;
  let m;
  while ((m = HANDLER_RE.exec(html))) {
    const body = m[1];
    const line = html.slice(0, m.index).split('\n').length;
    for (const re of [UNSAFE_ESCAPE_RE, RAW_INTERP_RE]) {
      re.lastIndex = 0;
      let hit;
      while ((hit = re.exec(body))) {
        const wrong = re === UNSAFE_ESCAPE_RE;
        if (!wrong && jsSafeNames.has(hit[1])) continue;
        out.push({
          line,
          detail: wrong
            ? `${hit[2]}() escapes for HTML text, not for a JS string`
            : `\`${hit[1]}\` reaches a JS string with no escaping`,
          snippet: body.slice(0, 90),
        });
      }
    }
  }
  return out;
}

// Globals the page gets from the CDN <script> tags in <head>, plus the ones
// loaded on demand (see loadJsQR / loadLeaflet / maybeInitEruda in app.html).
// Callable browser globals that can legitimately appear in an attribute.
const BROWSER_CALLABLES = [
  'alert', 'confirm', 'prompt', 'setTimeout', 'clearTimeout', 'setInterval',
  'requestAnimationFrame', 'fetch', 'open', 'close', 'print', 'focus', 'blur',
];

const VENDOR_GLOBALS = {
  supabase: 'readonly',
  L: 'readonly',
  jsQR: 'readonly',
  QRCode: 'readonly',
  html2canvas: 'readonly',
  Cropper: 'readonly',
  eruda: 'readonly',
  Chart: 'readonly',
};

/**
 * Blank out JS comments inside <script> blocks, keeping length and line breaks
 * so every offset still maps to the original file.
 *
 * The handler scan reads raw HTML, so an attribute written inside a comment —
 * `// onclick="fn('HERE')" does not escape` — looked like a real handler and was
 * reported as calling an undefined function. Comments are not code.
 */
function blankScriptComments(html) {
  const out = html.split('');
  const keep = (ch) => (ch === '\n' ? '\n' : ' ');
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    if (!isJavaScript(m[1])) continue;
    const start = m.index + m[0].indexOf('>') + 1;
    const body = m[2];
    // Only comments that begin a line. Matching // or /* anywhere is not safe
    // without a real tokenizer: a `/*` inside a string or regex literal opens a
    // comment that never closes where you expect, and blanking runs on through
    // hundreds of lines of genuine markup. Restricting to line-leading comments
    // covers the case that motivated this (a standalone explanatory line) and
    // cannot run away.
    for (const c of body.matchAll(/^[ \t]*\/\/[^\n]*/gm)) {
      for (let i = start + c.index; i < start + c.index + c[0].length; i++) out[i] = keep(out[i]);
    }
  }
  return out.join('');
}

/** Extract inline scripts into a buffer where each line keeps its source line number. */
function extractScripts(html) {
  const lines = new Array(html.split('\n').length).fill('');
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    if (!isJavaScript(m[1])) continue;
    const body = m[2];
    const startLine = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1;
    body.split('\n').forEach((text, i) => { lines[startLine + i] = text; });
  }
  return lines.join('\n');
}

/**
 * Globals created by assignment rather than declaration — `window.foo = ...`,
 * which is how the Ko-fi block at the end of app.html exports its handlers.
 * A bare call to one resolves through the global object at runtime, so these
 * are defined; no-undef just can't see it.
 */
function collectWindowGlobals(code) {
  const names = new Set();
  for (const m of code.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(m[1]);
  return names;
}

/**
 * Names invoked from HTML attributes (onclick="renderFoo(1)"), which the script
 * body may never reference. Declaring them as used keeps no-unused-vars quiet
 * about functions that are only reachable from markup.
 */
function collectHandlerNames(html) {
  return new Set(collectHandlerCalls(html).map(c => c.name));
}

// Keywords and built-ins that look like calls inside an attribute but aren't
// handlers: onclick="if(x)foo()", onclick="Number(this.value)".
const NOT_HANDLERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'throw',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON',
  'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'Set', 'Map', 'RegExp', 'Promise', 'Error',
]);

/**
 * Every function call made from an HTML event attribute or an onclick: data
 * property, with its source line.
 *
 * Single-quoted strings are blanked first, because
 * onmouseover="this.style.transform='translateY(-2px)'" is not a call to
 * translateY. Backtick templates are deliberately NOT blanked: most generated
 * markup here reads onclick="${cond ? `joinCrew('${id}')` : …}", so the real
 * handler call lives *inside* the template and blanking it hides exactly what
 * this check is looking for.
 */
function collectHandlerCalls(html) {
  const calls = [];
  const scan = (source, index) => {
    const line = html.slice(0, index).split('\n').length;
    const body = source
      .replace(/&quot;(?:\\.|[^\\])*?&quot;/g, "''")
      .replace(/'(?:\\.|[^'\\])*'/g, "''");
    for (const call of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = call[2];
      if (!NOT_HANDLERS.has(name)) calls.push({ name, line });
    }
  };

  let m;
  HANDLER_RE.lastIndex = 0;
  while ((m = HANDLER_RE.exec(html)) !== null) scan(m[1], m.index);
  HANDLER_PROP_RE.lastIndex = 0;
  while ((m = HANDLER_PROP_RE.exec(html)) !== null) scan(m[1].slice(1, -1), m.index);
  return calls;
}

/**
 * Top-level declarations — the app's globals. Parsed rather than regexed so a
 * function declared inside a block isn't mistaken for one.
 */
function collectDeclaredGlobals(code) {
  const espree = require('espree');
  const names = new Set();
  let ast;
  try {
    ast = espree.parse(code, { ecmaVersion: 2023, sourceType: 'script', loc: false });
  } catch (e) {
    return null; // a parse error is reported by ESLint itself; skip this check
  }
  const addPattern = (node) => {
    if (!node) return;
    if (node.type === 'Identifier') names.add(node.name);
    else if (node.type === 'ObjectPattern') node.properties.forEach(p => addPattern(p.value || p.argument));
    else if (node.type === 'ArrayPattern') node.elements.forEach(addPattern);
    else if (node.type === 'AssignmentPattern') addPattern(node.left);
    else if (node.type === 'RestElement') addPattern(node.argument);
  };
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id) names.add(node.id.name);
    else if (node.type === 'VariableDeclaration') node.declarations.forEach(d => addPattern(d.id));
    else if (node.type === 'ClassDeclaration' && node.id) names.add(node.id.name);
  }
  return names;
}

async function lintFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  const code = extractScripts(html);
  // Handler scanning runs over a copy with JS comments blanked; ESLint still
  // sees the real source.
  const scanHtml = blankScriptComments(html);
  if (!code.trim()) {
    console.log(`${file}: no inline scripts`);
    return 0;
  }
  const handlerNames = collectHandlerNames(scanHtml);
  const windowGlobals = collectWindowGlobals(code);

  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'script',
        globals: {
          // Browser surface the page actually uses.
          window: 'readonly', document: 'readonly', navigator: 'readonly',
          location: 'writable', history: 'readonly', console: 'readonly',
          localStorage: 'readonly', sessionStorage: 'readonly', crypto: 'readonly',
          fetch: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
          Blob: 'readonly', File: 'readonly', FileReader: 'readonly', Image: 'readonly',
          FormData: 'readonly', Headers: 'readonly', Response: 'readonly', Request: 'readonly',
          setTimeout: 'readonly', clearTimeout: 'readonly',
          setInterval: 'readonly', clearInterval: 'readonly',
          requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
          matchMedia: 'readonly', getComputedStyle: 'readonly', alert: 'readonly',
          MutationObserver: 'readonly', IntersectionObserver: 'readonly',
          ResizeObserver: 'readonly', MouseEvent: 'readonly', KeyboardEvent: 'readonly',
          CustomEvent: 'readonly', Event: 'readonly', AbortController: 'readonly',
          DOMParser: 'readonly', XMLHttpRequest: 'readonly', WebSocket: 'readonly',
          performance: 'readonly', screen: 'readonly', devicePixelRatio: 'readonly',
          atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly',
          prompt: 'readonly', confirm: 'readonly', CSS: 'readonly',
          Notification: 'readonly', caches: 'readonly', indexedDB: 'readonly',
          TextEncoder: 'readonly', TextDecoder: 'readonly',
          MediaRecorder: 'readonly', Audio: 'readonly', AudioContext: 'readonly',
          createImageBitmap: 'readonly', ImageData: 'readonly', Intl: 'readonly',
          ...VENDOR_GLOBALS,
          ...Object.fromEntries([...windowGlobals].map(n => [n, 'readonly'])),
        },
      },
      linterOptions: { reportUnusedDisableDirectives: false },
      rules: {
        'no-undef': 'error',
        'no-dupe-keys': 'error',
        'no-dupe-args': 'error',
        'no-func-assign': 'error',
        'no-unreachable': 'error',
        'no-cond-assign': 'error',
        'no-const-assign': 'error',
        'no-class-assign': 'error',
        'no-compare-neg-zero': 'error',
        'no-dupe-else-if': 'error',
        'no-duplicate-case': 'error',
        'no-self-assign': 'error',
        'no-sparse-arrays': 'error',
        'use-isnan': 'error',
        'valid-typeof': 'error',
        // Redeclaring a top-level function silently replaces the earlier one —
        // easy to do by accident in a 32k-line file, impossible to spot by eye.
        'no-redeclare': 'error',
        // Handlers reachable only from markup are filtered out of the results
        // below rather than here — the rule has no option for it.
        'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      },
    },
  });

  const [result] = await eslint.lintText(code, { filePath: `${file}.inline.js` });
  const messages = result.messages.filter(msg => {
    // A function only called from an HTML attribute is not unused.
    if (msg.ruleId === 'no-unused-vars') {
      const name = /'([^']+)'/.exec(msg.message)?.[1];
      if (name && handlerNames.has(name)) return false;
    }
    return true;
  });

  const errors = messages.filter(m => m.severity === 2);
  const warnings = messages.filter(m => m.severity === 1);

  for (const m of messages) {
    const level = m.severity === 2 ? 'error' : 'warn';
    console.log(`${file}:${m.line}:${m.column}  ${level}  ${m.message}  ${m.ruleId || ''}`);
  }

  // The check no-undef can't do: ESLint never sees HTML attributes, so a handler
  // left pointing at a renamed or deleted function is invisible to it — and that
  // is the failure this whole script exists to catch. A dead handler is a button
  // that throws when a user taps it.
  let deadHandlers = 0;
  const declared = collectDeclaredGlobals(code);
  if (declared) {
    const known = new Set([
      ...declared, ...windowGlobals, ...Object.keys(VENDOR_GLOBALS), ...BROWSER_CALLABLES,
    ]);
    const seen = new Set();
    for (const { name, line } of collectHandlerCalls(scanHtml)) {
      if (known.has(name) || seen.has(name)) continue;
      seen.add(name);
      deadHandlers++;
      console.log(`${file}:${line}  error  inline handler calls '${name}', which is not defined  dead-handler`);
    }
  }

  // The other check ESLint can't do. Two live cross-user XSS holes in this file
  // came from exactly this shape, so it is an error, not a warning.
  let unsafeInterps = 0;
  for (const { line, detail, snippet } of collectUnsafeInterpolations(scanHtml, collectJsSafeNames(code))) {
    unsafeInterps++;
    console.log(`${file}:${line}  error  ${detail} — use escJsAttr: ${snippet}  unsafe-handler-interpolation`);
  }

  const total = errors.length + deadHandlers + unsafeInterps;
  console.log(`\n${file}: ${total} error(s), ${warnings.length} warning(s)` +
    (deadHandlers ? ` — ${deadHandlers} dead inline handler(s)` : '') +
    (unsafeInterps ? ` — ${unsafeInterps} unsafely interpolated handler(s)` : ''));
  return total;
}

(async () => {
  const files = process.argv.slice(2);
  const targets = files.length ? files : [path.join(__dirname, '..', 'app.html')];
  let failed = 0;
  for (const f of targets) failed += await lintFile(f);
  process.exit(failed ? 1 : 0);
})();
