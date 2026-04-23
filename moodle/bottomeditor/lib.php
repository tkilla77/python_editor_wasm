<?php
defined('MOODLE_INTERNAL') || die();

function bottomeditor_supports(string $feature): ?bool {
    return match ($feature) {
        FEATURE_GRADE_HAS_GRADE   => true,
        FEATURE_BACKUP_MOODLE2    => true,
        FEATURE_MOD_INTRO         => true,
        FEATURE_SHOW_DESCRIPTION  => true,
        default                   => null,
    };
}

function bottomeditor_add_instance(stdClass $data, ?moodleform $mform = null): int {
    global $DB;
    $data->timecreated = $data->timemodified = time();
    $id = $DB->insert_record('bottomeditor', $data);
    $data->id = $id;
    bottomeditor_grade_item_update($data);
    return $id;
}

function bottomeditor_update_instance(stdClass $data, ?moodleform $mform = null): bool {
    global $DB;
    $data->timemodified = time();
    $data->id = $data->instance;
    $DB->update_record('bottomeditor', $data);
    bottomeditor_grade_item_update($data);
    return true;
}

function bottomeditor_delete_instance(int $id): bool {
    global $DB;
    $record = $DB->get_record('bottomeditor', ['id' => $id]);
    if (!$record) return false;
    $DB->delete_records('bottomeditor', ['id' => $id]);
    grade_update('mod/bottomeditor', $record->course, 'mod', 'bottomeditor', $id, 0, null, ['deleted' => 1]);
    return true;
}

function bottomeditor_grade_item_update(stdClass $bottomeditor, array|string $grades = null): int {
    $params = [
        'itemname'  => $bottomeditor->name,
        'gradetype' => GRADE_TYPE_VALUE,
        'grademax'  => 100,
        'grademin'  => 0,
    ];
    if ($grades === 'reset') {
        $params['reset'] = true;
        $grades = null;
    }
    return grade_update('mod/bottomeditor', $bottomeditor->course, 'mod', 'bottomeditor',
                        $bottomeditor->id, 0, $grades, $params);
}

function bottomeditor_get_coursemodule_info(stdClass $coursemodule): cached_cm_info {
    global $DB;
    $info = new cached_cm_info();
    $record = $DB->get_record('bottomeditor', ['id' => $coursemodule->instance], 'id, name, intro, introformat');
    if ($record) {
        $info->name = $record->name;
        if ($coursemodule->showdescription) {
            $info->content = format_module_intro('bottomeditor', $record, $coursemodule->id, false);
        }
    }
    return $info;
}
