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
