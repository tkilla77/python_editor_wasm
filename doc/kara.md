# Kara — Grid World Guide

Kara is a ladybug that lives in a grid world. She can move, turn, pick up
and place leaves, and push mushrooms. Trees block her path.

The `<kara-editor>` component is a variant of `<bottom-editor>`  ([Documentation →](index.html))tailored
for Kara programs: no imports needed, animated step-by-step execution, and
a compact console showing only error messages.

**Source:** [github.com/tkilla77/python_editor_wasm](https://github.com/tkilla77/python_editor_wasm) · [Original Kara (SwissEduc)](https://www.swisseduc.ch/informatik/karatojava/kara/index.html)

---

## Quick start

```html
<script type="module" src="https://bottom.ch/editor/stable/kara-editor.js"></script>

<kara-editor>
<kara-world>
#########
#...>...#
#########
</kara-world>
kara.move()
kara.move()
kara.turnLeft()
</kara-editor>
```

<kara-editor>
<kara-world>
#########
#...>...#
#########
</kara-world>
kara.move()
kara.move()
kara.turnLeft()
</kara-editor>

---

## The world

Define the world inside a `<kara-world>` child element using a simple text grid:

| Character | Meaning |
|-----------|---------|
| `#` | Tree (also used for borders) |
| `T` | Tree (inside the grid) |
| `>` | Kara facing right |
| `<` | Kara facing left |
| `^` | Kara facing up |
| `v` | Kara facing down |
| `L` | Leaf |
| `M` | Mushroom |
| `.` | Empty cell |

If no `<kara-world>` is given, a default empty grid is used.

---

## Commands

| Command | Description |
|---------|-------------|
| `kara.move()` | Move one step in the current direction |
| `kara.turnLeft()` | Turn 90° counter-clockwise |
| `kara.turnRight()` | Turn 90° clockwise |
| `kara.putLeaf()` | Place a leaf on the current cell |
| `kara.removeLeaf()` | Pick up the leaf on the current cell |

`await` is inserted automatically — just write `kara.move()`, not `await kara.move()`.

---

## Sensors

| Sensor | Returns |
|--------|---------|
| `kara.treeFront()` | `True` if there is a tree directly ahead |
| `kara.treeLeft()` | `True` if there is a tree to the left |
| `kara.treeRight()` | `True` if there is a tree to the right |
| `kara.mushroomFront()` | `True` if there is a mushroom directly ahead |
| `kara.onLeaf()` | `True` if Kara is standing on a leaf |

---

## Mushrooms

Kara can push a mushroom if the cell behind it is empty or has a leaf.
Pushing into a tree or another mushroom raises a `KaraException`.

<kara-editor step="300">
<kara-world>
##########
#..>M....#
##########
</kara-world>
kara.move()
kara.move()
kara.move()
</kara-editor>

---

## Sensors example

<kara-editor step="200">
<kara-world>
##########
#>......T#
#........#
##########
</kara-world>
while not kara.treeFront():
    kara.move()
    if kara.onLeaf():
        kara.removeLeaf()
    else:
        kara.putLeaf()
</kara-editor>

---

## Attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `step` | `200` | Animation delay between steps in milliseconds; `0` for instant |
| `autorun` | off | Run the program automatically when Pyodide is ready |
| `timeout` | `30` | Maximum run time in seconds; `inf` to disable |

---

## Labyrinth Example
<kara-editor step="50" timeout="60">
    <kara-world>
     TTTTTTTTTTTTTTTTTT
     T>               T
     TTTTTTTTTTTTTTTT T
     T              T T
     TTT TTTTTTTTTTTT T
     T                T
     TTTTTTTT TTTTTTTTT
     T              T T
     TTT TTTTTTTTTTTT T
     T                T
     TTTTTTTT TTTTTTTTT
     T              T T
     TTT TTTTTTTTTTTT T
     T                T
     TTTTTTTT TTTTTTTTT
     T                T
     TTTTTTTTTTTTLTTTTT
    </kara-world>
while not kara.mushroomFront():
    if not kara.onLeaf():
        kara.turnRight()
        kara.move()
    elif not kara.treeFront():
        kara.move()
    else:
        kara.turnLeft()
</kara-editor>
---

## Exceptions

When Kara cannot execute a command, a `KaraException` is raised:

- `Tree blocking the path!` — `kara.move()` would walk into a tree or boundary
- `Cannot push mushroom — blocked!` — the cell behind the mushroom is occupied
- `Already a leaf here!` — `kara.putLeaf()` on a cell that already has a leaf
- `No leaf here!` — `kara.removeLeaf()` on an empty cell

The exception message is shown in the console panel below the world.
