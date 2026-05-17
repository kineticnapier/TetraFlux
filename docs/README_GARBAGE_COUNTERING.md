# Garbage visualization and countering

## What changed

```text
src/engine/tetris.ts
src/main.ts
src/render.ts
```

## Behavior

```text
Incoming garbage is visible as a vertical G meter next to each board.
When a player locks a piece, outgoing attack cancels that player's incoming garbage first.
Any remaining attack is sent to the opponent's visible garbage queue.
Any incoming garbage still left after cancellation materializes after that lock.
```

This is TETR.IO-like rather than exact TETR.IO emulation.

## Important implementation detail

Before this change, `lockPiece()` applied pending garbage immediately. That meant the player could not counter visible incoming garbage with the attack from the same lock.

Now `lockPiece()` only calculates attack and spawns the next piece. The match controller in `main.ts` resolves cancellation and then applies the remaining incoming garbage.
