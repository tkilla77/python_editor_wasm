<?php
defined('MOODLE_INTERNAL') || die();

$functions = [
    'mod_bottomeditor_submit_attempt' => [
        'classname'     => 'mod_bottomeditor\external\submit_attempt',
        'methodname'    => 'execute',
        'description'   => 'Record the result of a test run and update the gradebook.',
        'type'          => 'write',
        'ajax'          => true,
        'loginrequired' => true,
    ],
];
