/** Strip common leading whitespace from all non-empty lines, then trim. */
export function dedentWorld(s: string): string {
    const lines = s.split('\n');
    const nonEmpty = lines.filter(l => l.trim());
    if (!nonEmpty.length) return '';
    const indent = Math.min(...nonEmpty.map(l => l.match(/^ */)![0].length));
    return lines.map(l => l.slice(indent)).join('\n').trim();
}
