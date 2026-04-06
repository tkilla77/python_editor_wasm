import { describe, it, expect } from 'vitest';
import { dedentWorld } from './kara-world.js';

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
