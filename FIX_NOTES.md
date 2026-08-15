# v1.3 Online Lobby Input

Two bugs found by the two-browser end-to-end test, both in room-code entry.

**Room codes containing G threw the player out of the lobby.**
- `G` and `M` were the global "back" and "mute" shortcuts, and both are in the
  room-code alphabet. Typing a code like `CGHUEN` triggered the shortcut instead
  of entering the character.
- While a code is being typed, letters are now text and nothing else. `Escape`
  still leaves, since it is not a character anyone can need.

**Typed characters were duplicated and reordered.**
- Phaser's keyboard event stream was observed replaying its queue in this scene:
  one press arrived as several events, including ones already handled. Pressing
  `RW96UD` produced `RRWRW9`.
- Harmless in a menu, where a repeat just re-selects the same entry, and invisible
  to the battle input sampler, which is idempotent by design. Fatal for typing.
- The lobby now listens to the DOM directly, which delivers exactly one keydown
  per press. It deliberately does not call `preventDefault` — that is the v1.2
  bug — and ignores `event.repeat` so a resting finger cannot add characters.

Regression cover: `e2e/online-match.spec.ts` types a real, server-issued room code
in a second browser and plays a match through it.

---

# v1.2 Player 2 Arrow Keys Restored

Found on 2026-08-15 while building the end-to-end smoke suite.

Symptom:
- In `2P VS P2`, Player 2 could not move, jump or crouch at all. P2's attack keys
  (`J` / `K` / `L`) worked, so the mode looked half-functional rather than broken.
- `Space` also did nothing as a "press any key" / confirm input.
- Every other letter key was unaffected, which is why this survived manual testing.

Root cause:
- `main.ts` registered `window.addEventListener('keydown', e => e.preventDefault())`
  for the arrow keys and space, to stop the page scrolling.
- That listener ran at module load, i.e. **before** `new Phaser.Game()` attached its
  own `window` listener.
- Phaser's `KeyboardManager.onKeyDown` discards any event whose `defaultPrevented`
  is already `true`, so those five keys never reached the game at all — they were
  not queued, so no `Key.isDown`, no `JustDown`, no scene `keydown` handler.

Fix:
- Removed the manual listener.
- Declared the same keys in Phaser's own capture list via
  `gameConfig.input.keyboard.capture`. Phaser calls `preventDefault` from inside its
  handler, *after* queueing the event, so page scrolling is still blocked and the
  game still receives the key.

Regression cover:
- `e2e/smoke.spec.ts` → "both players can walk with their own keys in 2P mode"
  drives a real 2P battle and asserts both fighters move, so a repeat of the
  P1-works/P2-doesn't asymmetry fails the build.
- `e2e/smoke.spec.ts` → "space works as a confirm key on the title screen".

---

# v1.1 Character Select Input Fix

Fixed the character select dead-end reported on 2026-08-15.

Root cause addressed:
- Menu input previously relied on `KeyboardEvent.key`.
- With Chinese / Japanese / Korean IME enabled, letter keys can be reported as composition input instead of `w`, `a`, `s`, `d`, `f`, etc.
- Character select therefore appeared frozen even though the scene was running.

Changes:
- Character Select now uses physical `KeyboardEvent.code` (`KeyW`, `KeyA`, `KeyS`, `KeyD`, `KeyF`, etc.).
- 1P Character Select also accepts Arrow Keys + Enter / Space as a fallback.
- Character cards are clickable and clicking confirms the current player.
- Mode Select, Result, Title mute key, and Battle global keys also use physical key codes.
- Battle PlayerController now registers explicit Phaser KeyCodes.
- Keyboard plugin is explicitly enabled when entering Character Select and Battle controllers.
