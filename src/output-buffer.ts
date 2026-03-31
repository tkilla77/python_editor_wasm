export const MAX_OUTPUT_LINES = 100;
export const MAX_OUTPUT_CHARS = 5000;

/**
 * Pure function: appends `newText` to `current`, enforces line/char limits,
 * and returns the new buffer string. No side effects; safe to unit test.
 */
export function appendOutput(current: string, newText: string): string {
    let result = current + newText;

    // Remove stale trim notice before recalculating limits.
    if (result.startsWith('...[output trimmed:')) {
        const nl = result.indexOf('\n');
        if (nl > 0) result = result.slice(nl + 1);
    }

    const noticeParts: string[] = [];

    const lines = result.split(/\r?\n/);
    if (lines.length > MAX_OUTPUT_LINES) {
        noticeParts.push(`${lines.length - MAX_OUTPUT_LINES} lines`);
        result = lines.slice(-MAX_OUTPUT_LINES).join('\n');
    }

    if (result.length > MAX_OUTPUT_CHARS) {
        noticeParts.push(`~${result.length - MAX_OUTPUT_CHARS} chars`);
        result = result.slice(-MAX_OUTPUT_CHARS);
        const nl = result.indexOf('\n');
        if (nl > 0) result = result.slice(nl + 1);
    }

    return noticeParts.length > 0
        ? `...[output trimmed: ${noticeParts.join(', ')}]...\n` + result
        : result;
}
