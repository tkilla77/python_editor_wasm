import { describe, it, expect } from 'vitest';
import { appendOutput, MAX_OUTPUT_LINES, MAX_OUTPUT_CHARS } from './output-buffer.js';

describe('appendOutput', () => {
    it('appends text to an empty buffer', () => {
        expect(appendOutput('', 'hello\n')).toBe('hello\n');
    });

    it('appends text to existing content', () => {
        expect(appendOutput('foo\n', 'bar\n')).toBe('foo\nbar\n');
    });

    it('does not trim when under limits', () => {
        const result = appendOutput('line1\n', 'line2\n');
        expect(result).not.toContain('trimmed');
    });

    it('trims when line count exceeds MAX_OUTPUT_LINES', () => {
        const existing = Array.from({ length: MAX_OUTPUT_LINES }, (_, i) => `line${i}`).join('\n');
        const result = appendOutput(existing, '\nextra');
        expect(result).toContain('...[output trimmed:');
        expect(result).toContain('1 lines');
    });

    it('trims when char count exceeds MAX_OUTPUT_CHARS', () => {
        const existing = 'a'.repeat(MAX_OUTPUT_CHARS);
        const result = appendOutput(existing, 'b'.repeat(10));
        expect(result).toContain('...[output trimmed:');
        expect(result).toContain('~10 chars');
    });

    it('replaces a stale trim notice at the start rather than stacking notices', () => {
        const withNotice = '...[output trimmed: 5 lines]...\nold content\n';
        const result = appendOutput(withNotice, 'new line\n');
        const count = (result.match(/\.\.\.\[output trimmed:/g) ?? []).length;
        expect(count).toBeLessThanOrEqual(1);
    });

    it('includes both line and char trim reasons when both limits are exceeded', () => {
        const manyLines = Array.from({ length: MAX_OUTPUT_LINES + 5 }, () => 'x'.repeat(50)).join('\n');
        const result = appendOutput('', manyLines);
        expect(result).toContain('lines');
    });
});
