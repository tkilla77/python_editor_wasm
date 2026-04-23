<?php
/**
 * Standalone regex tests for the bottomeditor syntax plugin.
 * Run with: php test.php
 *
 * Stubs the DokuWiki base class so syntax.php can be loaded without the
 * full framework. The pattern under test is read directly from the
 * production class constant.
 */

// Minimal stub — just enough for syntax.php to parse without errors.
if (!class_exists('DokuWiki_Syntax_Plugin')) {
    class DokuWiki_Syntax_Plugin {}
}

require __DIR__ . '/syntax.php';

$pattern = '/' . syntax_plugin_bottomeditor::ELEMENT_PATTERN . '/';

// ── Helpers ───────────────────────────────────────────────────────────────────

$pass = 0;
$fail = 0;

function check(string $desc, bool $ok): void {
    global $pass, $fail;
    if ($ok) {
        echo "  PASS  $desc\n";
        $pass++;
    } else {
        echo "  FAIL  $desc\n";
        $fail++;
    }
}

function matches(string $input): array {
    global $pattern;
    preg_match_all($pattern, $input, $m);
    return $m[0];
}

// ── Basic matching ────────────────────────────────────────────────────────────

$hits = matches('<bottom-editor autorun>print("hi")</bottom-editor>');
check('matches bottom-editor with attribute and content', count($hits) === 1);
check('preserves opening tag with attribute', str_contains($hits[0], '<bottom-editor autorun>'));
check('preserves content', str_contains($hits[0], 'print("hi")'));
check('preserves closing tag', str_contains($hits[0], '</bottom-editor>'));

// ── Multi-line content ────────────────────────────────────────────────────────

$ml = "<bottom-editor>\nfor i in range(10):\n    print(i)\n</bottom-editor>";
$hits = matches($ml);
check('matches multi-line content', count($hits) === 1);
check('preserves newlines in content', str_contains($hits[0], "\n"));

// ── bottom-exercise with template children ────────────────────────────────────

$ex = <<<HTML
<bottom-exercise id="sum">
<template data-type="starter">def sum(a, b): pass</template>
<template data-type="test">assert sum(1,2)==3</template>
</bottom-exercise>
HTML;
$hits = matches($ex);
check('matches bottom-exercise with template children', count($hits) === 1);
check('preserves template children', str_contains($hits[0], '<template data-type="starter">'));

// ── kara-editor ───────────────────────────────────────────────────────────────

$hits = matches('<kara-editor world="maze"></kara-editor>');
check('matches kara-editor', count($hits) === 1);

// ── Multiple elements on same page ───────────────────────────────────────────

$page = <<<HTML
Some text before.
<bottom-editor>code1</bottom-editor>
Some text between.
<bottom-exercise id="ex2"><template data-type="starter">code2</template></bottom-exercise>
Some text after.
HTML;
$hits = matches($page);
check('finds both elements on a page', count($hits) === 2);
check('surrounding text is not consumed', !str_contains($hits[0], 'Some text'));

// ── Backreference: mismatched closing tag must not match ──────────────────────

$hits = matches('<bottom-editor>code</bottom-exercise>');
check('mismatched closing tag does not match', count($hits) === 0);

// ── Empty content ─────────────────────────────────────────────────────────────

$hits = matches('<bottom-editor></bottom-editor>');
check('matches element with empty content', count($hits) === 1);

// ── Result ────────────────────────────────────────────────────────────────────

echo "\n$pass passed, $fail failed\n";
exit($fail > 0 ? 1 : 0);
