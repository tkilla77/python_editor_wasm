export interface ExercisePermalinkState {
    code: string;
    starter?: string;
    tests?: string;
    solution?: string;
    prompt?: string;
    layout?: string;
    zip?: string;
    timeout?: string;
}

export async function encodeExercise(state: ExercisePermalinkState): Promise<string> {
    const json = JSON.stringify(state);
    const input = new TextEncoder().encode(json);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    // Chunked to avoid stack overflow on large arrays
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeExercise(param: string): Promise<ExercisePermalinkState> {
    const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const text = await new Response(ds.readable).text();
    return JSON.parse(text) as ExercisePermalinkState;
}

// ── HTML sanitizer ───────────────────────────────────────────────────────────
// Allowlist-based: strips all event handlers, scripts, and unknown tags.
// Safe for innerHTML injection on the exercise-view landing page.

const ALLOWED_TAGS: Record<string, string[]> = {
    p: [], div: [], span: [], br: [], hr: [],
    em: [], strong: [], b: [], i: [], u: [],
    code: [], pre: [],
    h1: [], h2: [], h3: [], h4: [],
    ul: [], ol: [], li: [],
    table: [], thead: [], tbody: [], tr: [],
    th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
    blockquote: [],
    a: ['href'],
};
const VOID = new Set(['br', 'hr']);

export function sanitizeHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return walk(doc.body);
}

function walk(node: Node): string {
    let out = '';
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            out += escHtml(child.textContent ?? '');
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el = child as Element;
            const tag = el.tagName.toLowerCase();
            const allowedAttrs = ALLOWED_TAGS[tag];
            if (allowedAttrs === undefined) {
                out += walk(el); // strip tag, keep children
            } else if (VOID.has(tag)) {
                out += `<${tag}>`;
            } else {
                let attrs = '';
                for (const name of allowedAttrs) {
                    const val = el.getAttribute(name);
                    if (val === null) continue;
                    if (name === 'href') {
                        const v = val.trim().toLowerCase();
                        if (v.startsWith('javascript:') || v.startsWith('data:')) continue;
                        attrs += ` href="${escAttr(val)}" target="_blank" rel="noopener noreferrer"`;
                    } else {
                        attrs += ` ${name}="${escAttr(val)}"`;
                    }
                }
                out += `<${tag}${attrs}>${walk(el)}</${tag}>`;
            }
        }
    }
    return out;
}

function escHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
