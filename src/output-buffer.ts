export const MAX_OUTPUT_LINES = 100;
export const MAX_OUTPUT_CHARS = 5000;

/**
 * Pure function: appends `newText` to `current`, enforces line/char limits,
 * and returns the new buffer string. No side effects; safe to unit test.
 */
export function appendOutput(current: string, newText: string): string {
    let result = current + newText;

    // Strip any existing notice and carry its counts forward so the final
    // notice reflects total dropped output, not just the latest increment.
    let prevDroppedLines = 0;
    let prevDroppedChars = 0;
    if (result.startsWith('...[output trimmed:')) {
        const nl = result.indexOf('\n');
        if (nl > 0) {
            const notice = result.slice(0, nl);
            const lm = notice.match(/(\d+) lines/);
            const cm = notice.match(/~(\d+) chars/);
            if (lm) prevDroppedLines = parseInt(lm[1], 10);
            if (cm) prevDroppedChars = parseInt(cm[1], 10);
            result = result.slice(nl + 1);
        }
    }

    const noticeParts: string[] = [];

    const lines = result.split(/\r?\n/);
    const newDroppedLines = lines.length > MAX_OUTPUT_LINES ? lines.length - MAX_OUTPUT_LINES : 0;
    const totalDroppedLines = prevDroppedLines + newDroppedLines;
    if (newDroppedLines > 0) result = lines.slice(-MAX_OUTPUT_LINES).join('\n');
    if (totalDroppedLines > 0) noticeParts.push(`${totalDroppedLines} lines`);

    const newDroppedChars = result.length > MAX_OUTPUT_CHARS ? result.length - MAX_OUTPUT_CHARS : 0;
    const totalDroppedChars = prevDroppedChars + newDroppedChars;
    if (newDroppedChars > 0) {
        result = result.slice(-MAX_OUTPUT_CHARS);
        const nl = result.indexOf('\n');
        if (nl > 0) result = result.slice(nl + 1);
    }
    if (totalDroppedChars > 0) noticeParts.push(`~${totalDroppedChars} chars`);

    return noticeParts.length > 0
        ? `...[output trimmed: ${noticeParts.join(', ')}]...\n` + result
        : result;
}
