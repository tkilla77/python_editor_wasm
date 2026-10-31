import type { FileSpec } from './editor.js';

/** Extra files declared as direct <template filename="..."> children of `host`. */
export function readFileTemplates(host: Element): { name: string; code: string }[] {
    return Array.from(host.querySelectorAll(':scope > template[filename]')).map(t => ({
        name: t.getAttribute('filename')!,
        code: ((t as HTMLTemplateElement).content.textContent ?? '').replace(/^\n/, ''),
    }));
}

/**
 * Authored files with their current contents: each template's text is its
 * original (the Revert target), an override with the same name supplies the
 * current text, and overrides without a template (user-added files) follow.
 */
export function mergeFiles(templates: { name: string; code: string }[], overrides: FileSpec[]): FileSpec[] {
    const authored = new Set(templates.map(t => t.name));
    return [
        ...templates.map(t => ({
            name: t.name,
            code: overrides.find(f => f.name === t.name)?.code ?? t.code,
            initial: t.code,
        })),
        ...overrides.filter(f => !authored.has(f.name)),
    ];
}
