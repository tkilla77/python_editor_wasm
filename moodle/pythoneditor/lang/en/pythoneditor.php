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

// Admin settings
$string['scriptbaseurl']      = 'Script base URL';
$string['scriptbaseurl_desc'] = 'Base URL for the bottom-exercise.js bundle (no trailing slash). Change to use a self-hosted copy.';

// Capabilities
$string['pythoneditor:view']   = 'View Python exercise';
$string['pythoneditor:submit'] = 'Submit attempt';
$string['pythoneditor:grade']  = 'Grade attempts';
