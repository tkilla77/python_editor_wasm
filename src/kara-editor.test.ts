import { describe, it, expect } from 'vitest';
import { dedentWorld } from './kara-world.js';
import { transformKaraCode } from './kara-transform.js';

describe('dedentWorld', () => {
    it('returns empty string for blank input', () => {
        expect(dedentWorld('')).toBe('');
        expect(dedentWorld('   \n   \n')).toBe('');
    });

    it('leaves already-clean world unchanged', () => {
        const world = '#########\n#...>...#\n#########';
        expect(dedentWorld(world)).toBe(world);
    });

    it('strips common leading whitespace from indented worlds', () => {
        const indented = '\n    #########\n    #...>...#\n    #########\n';
        expect(dedentWorld(indented)).toBe('#########\n#...>...#\n#########');
    });

    it('strips surrounding blank lines (trim)', () => {
        const world = '\n\n#########\n#...>...#\n#########\n\n';
        expect(dedentWorld(world)).toBe('#########\n#...>...#\n#########');
    });

    it('handles mixed indent by stripping only the minimum', () => {
        // 4-space indent overall, but one line has 6 spaces → min is 4
        const indented = '    #########\n      #..>#\n    #########';
        expect(dedentWorld(indented)).toBe('#########\n  #..>#\n#########');
    });
});

describe('transformKaraCode', () => {
    it('auto-awaits kara actions at top level', () => {
        const result = transformKaraCode('kara.move()\nkara.turnLeft()');
        expect(result).toContain('await kara.move()');
        expect(result).toContain('await kara.turnLeft()');
    });

    it('does not double-await already-awaited calls', () => {
        const result = transformKaraCode('await kara.move()');
        expect(result).not.toContain('await await');
    });

    it('converts def to async def', () => {
        const result = transformKaraCode('def step():\n    kara.move()');
        expect(result).toContain('async def step()');
        expect(result).toContain('await kara.move()');
    });

    it('auto-awaits calls to user-defined functions', () => {
        const code = 'def step():\n    kara.move()\n\nstep()\nstep()';
        const result = transformKaraCode(code);
        expect(result).toContain('await step()');
        // Definition line itself must not gain an extra await
        expect(result).not.toContain('await async def');
    });

    it('handles nested functions', () => {
        const code = 'def walk(n):\n    def one():\n        kara.move()\n    one()';
        const result = transformKaraCode(code);
        expect(result).toContain('async def walk');
        expect(result).toContain('async def one');
        expect(result).toContain('await one()');
    });

    it('preserves indented def (method-like)', () => {
        const code = '    def helper():\n        kara.turnRight()';
        const result = transformKaraCode(code);
        expect(result).toContain('    async def helper()');
    });
});
