# Special challenge mods

## Added special mod category

These mods are separate from the normal Quick Play mod selector.

A second selector is added under the normal mod selector:

```text
Special: No Special
Special: Asceticism
Special: Loaded Dice
Special: Freefall
Special: Last Stand
Special: Damnation
Special: The Exile
Special: The Warlock
```

The selector is shown in AI Battle and Garbage Lab, like the normal mod selector.

## Implemented mods

### Asceticism

Implemented:

```text
- NEXT visible count = 1
- piece queue is randomised outside seven-bag behavior
- hold is disabled
- garbage holes are contiguous width 2
```

### Loaded Dice

Implemented:

```text
- starts from a dice-like board pattern
- garbage scatter chance is very high
- line clears cause 1.15s stun
```

### Freefall

Implemented:

```text
- human gravity becomes effectively instant
```

### Last Stand

Implemented:

```text
- top 6 rows are marked as danger height
- topout if stack enters that reduced-height zone
- incoming garbage x3
- straight garbage behavior through scatterChance = 0
```

The board overlay shows the reduced-height danger area.

### Damnation

Implemented:

```text
- starts from a cursed board pattern
- All-Spins disabled
- garbage holes become 6 or 7 cells wide
- BLIGHTED mechanic
```

BLIGHTED behavior:

```text
Normal clear:
  sends/cancels 0

Clear garbage:
  enables next BLIGHTED clear

BLIGHTED clear:
  attack = floor(attack * 1.75 + 1)
```

### The Exile

Implemented:

```text
- placed pieces are permanently invisible
- only top 3 garbage rows are visible
- starts with 3 garbage rows
```

### The Warlock

Implemented:

```text
- All-Spin enabled
- starts with 10 messy garbage rows
- repeating the same clear action causes topout
- non-spin clears are tracked as VOID
- spin-zero sends at least 2 lines
```

Warlock action names:

```text
SPIN_0
SPIN_1
SPIN_2
SPIN_3
SPIN_4
VOID
```

## Engine changes

`GarbageOptions` now supports:

```ts
holeWidth?: number;
largeHoleCount?: number;
largeHoleExtraChance?: number;
```

Used for:

```text
Asceticism: width-2 connected holes
Damnation: 6/7-wide holes
```

## Render changes

`drawBoard()` now supports:

```ts
nextVisibleCount?: number;
topCutRows?: number;
visibleGarbageRows?: number;
```

Used for:

```text
Asceticism: NEXT 1
Last Stand: danger-height overlay
The Exile: only top 3 garbage rows visible
```

## Build

Checked with:

```bash
npm run build
```

Result: passed.
