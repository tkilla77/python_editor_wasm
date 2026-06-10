/**
 * Transforms user-written Kara code so it runs correctly in an async context:
 * - Converts `def` to `async def` so kara actions can be awaited inside functions.
 * - Auto-inserts `await` before kara action calls and user-defined function calls.
 */
export function transformKaraCode(editorCode: string): string {
    // Make all user-defined functions async so kara actions can be awaited inside them.
    let code = editorCode.replace(/^(\s*)def (\w+)/gm, '$1async def $2');

    // Collect user-defined function names (now all async) to auto-await their calls.
    const userFnNames = [...code.matchAll(/^\s*async def (\w+)\s*\(/gm)].map(m => m[1]);

    // Auto-insert `await` before kara action calls (guard against double-await).
    code = code.replace(
        /(?<!await )\b(kara\.(move|turnLeft|turnRight|putLeaf|removeLeaf))\s*\(/g,
        'await $1('
    );

    // Auto-insert `await` before calls to user-defined async functions,
    // but not on their definition lines (excluded by (?<!def )).
    if (userFnNames.length > 0) {
        const escaped = userFnNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        code = code.replace(
            new RegExp(`(?<!await )(?<!def )\\b(${escaped.join('|')})\\s*\\(`, 'g'),
            'await $1('
        );
    }

    return code;
}
