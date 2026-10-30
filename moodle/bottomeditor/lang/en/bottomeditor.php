<?php
$string['modulename']        = 'Python Exercise';
$string['modulenameplural']  = 'Python Exercises';
$string['modulename_help']   = 'Embed an interactive Python coding exercise with automated test-based grading.';
$string['pluginname']        = 'Python Exercise';
$string['pluginadministration'] = 'Python Exercise administration';

// Form fields
$string['prompt']            = 'Exercise prompt';
$string['prompt_help']       = 'Description shown above the editor. Supports HTML.';
$string['startercode']       = 'Starter code';
$string['startercode_help']  = 'Initial Python code shown in the editor. Students can reset to this code.';
$string['testcode']          = 'Test assertions';
$string['testcode_help']     = 'Python assert statements run when the student clicks Run. Leave empty for free-form exercises (no automated grading).';
$string['solutioncode']      = 'Solution code';
$string['solutioncode_help'] = 'Shown when the student requests the solution (if enabled).';
$string['layout']            = 'Editor layout';
$string['layout_console']    = 'Text console';
$string['layout_canvas']     = 'Canvas (turtle graphics)';
$string['layout_split']      = 'Split (editor + canvas + console)';
$string['enablesolution']    = 'Show solution button';
$string['enablesolution_help'] = 'Allow students to reveal the solution. Disable for assessments.';
$string['stepmode']          = 'Step-by-step execution';
$string['stepmode_help']     = 'Run plays the student\'s code line by line, highlighting the current line and showing variable values; a bar below the code offers Step, Play/Pause and speed. Tests still run at full speed. Needs a current browser (Chrome/Edge 137+, Firefox 153+, Safari 27+).';
$string['nodebug']           = 'Disable breakpoints';
$string['nodebug_help']      = 'By default, students can click a line number to set a breakpoint: Run then pauses there and lets them step through the code. Check this to turn that off.';
$string['showenergy']        = 'Show energy';
$string['showenergy_help']   = 'Show how many lines the code executed after each run. Counting slows execution, so leave this off for heavy computations.';
$string['multifile']         = 'Allow multiple files';
$string['multifile_help']    = 'Show file tabs so students can add their own modules or data files.';
$string['maxenergy']         = 'Maximum energy';
$string['maxenergy_help']    = 'Maximum number of executed lines. Solutions that use more fail an extra "energy() <= N" check. 0 means no limit.';
$string['maxmemory']         = 'Maximum memory';
$string['maxmemory_help']    = 'Maximum number of non-blank, non-comment code lines. Longer solutions fail an extra "memory() <= N" check. 0 means no limit.';

// Admin settings
$string['scriptbaseurl']      = 'Script base URL';
$string['scriptbaseurl_desc'] = 'Base URL for the bottom-exercise.js bundle (no trailing slash). Change to use a self-hosted copy.';

// Capabilities
$string['bottomeditor:view']   = 'View Python exercise';
$string['bottomeditor:submit'] = 'Submit attempt';
$string['bottomeditor:grade']  = 'Grade attempts';
