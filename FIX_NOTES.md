# v1.4.1 The Letter F, And A Cat With No Eyes

Numbered as a patch, and from here on the headings follow semver: nothing below
is a new feature, so the minor version does not move. The earlier headings keep
the numbers they were written with.

Two bugs reported from playing the game, both of a kind automated tests were
never going to notice on their own: one hides behind a random code, the other is
only visible if something looks at the picture.

**Any room code containing F was impossible to type.** F is the confirm key on
every other screen, and code entry kept that habit — so typing the F of `2F7KHN`
submitted the two characters entered so far, and the player got "no such room"
for a code they had read out correctly. The hint under the field already said
`ENTER : JOIN`; the F was an undocumented extra that cost the alphabet a letter.
This is the same class of bug as the G and M shortcuts in v1.3, missed then
because G and M throw the player out of the lobby loudly, while F fails as a
plausible-looking rejected join.
*Fix: while a code is being typed, F is a character. Enter submits, as the hint
says. The end-to-end suite now types the whole 31-character alphabet, rather than
whatever code the server happened to issue — the old test passed or failed by
luck of the draw, and F appears in roughly one code in five.*

**崩潰喵喵貓 fought with holes where its eyes should be.** Poses are cut out of
the character cards at boot by keying out the black backdrop, and the test was
per-pixel: dark enough, therefore background. The cats are photographs, so their
pupils are that same black — and so are open mouths, the dark leaves on 沙拉貓's
plate, and the inside of 魔法胖橘's cauldron. All of it was punched through to
the stage behind.
Every fighter was affected; the collapse cat is simply the one whose eyes are
large, dark and dead centre.
*Fix: backdrop is now defined by position as well as colour — the dark region
that reaches the edge of the crop. The pass floods inward from the border instead
of sweeping the image, so dark areas the cat encloses are never reached. The
anti-aliased fringe still fades exactly as before, because only pixels the flood
arrives at are touched.*

Regression cover: `e2e/online-match.spec.ts` types every character of the room
code alphabet and reports which one did nothing; `src/systems/__tests__` covers
the backdrop pass directly, over hand-drawn pixel maps with pupils in them. The
cutout logic was pulled out of the class to make that possible — it is pure
arithmetic over a pixel buffer and needs neither Phaser nor a canvas.

---

# v1.4 Online Matches Dropping On Keypress

Reported as "the connection drops the moment you press a key", reproducing even
with both players on one machine. None of it was a connection problem. Five
separate defects, each of which alone was enough to make a match unplayable, and
none of which appears with one browser open.

**Desync on keypress.** The battle scene sampled the keyboard on every rendered
frame, including frames where the simulation could not advance because it was
waiting for the opponent. Each of those offered the session a fresh value for a
tick it had already transmitted, and the session overwrote it — but the opponent
keeps the first value it receives and ignores later ones, so the two clients ran
that tick from different inputs. The scene treats a reported desync as a lost
connection and leaves the match, which is what the player saw. Holding still gave
the same sample every time and looked fine.
*Fix: a transmitted frame is final, and the scene samples once per tick.*

**The two clients disagreed about the transport.** Whether to use the direct
connection was decided as `transportKind === 'p2p' && peerChannel !== null`, and
those two facts arrive from different places — the verdict from the host through
the server, the channel handle from this client's own negotiation. Over loopback
they land together; over a real network the verdict arrives first, so the guest
saw "direct" with no channel yet and fell back to the relay while the host used
the data channel. Neither heard the other.
*Fix: the host proposes, the guest confirms what it can actually use, the host
starts on that confirmation.*

**The two clients disagreed about the input delay.** Each computed its own from
its own measured round trip — the deployment showed host 3, guest 2. The delay
decides how many opening ticks run on primed neutral input, so different values
leave each side waiting for a frame the other was never going to send. Every
client on one machine measures the same round trip and agrees by accident, which
is why this survived until a deployment.
*Fix: agreed in the same handshake as the transport, taking the larger of the two.*

**A stall became a permanent backlog.** The fixed-timestep accumulator grew
without bound: a stalled tick broke out of the loop without consuming time while
the next frame added more. Lockstep can never work that debt off, because both
clients are gated on the same inputs. Measured at 4.6 seconds behind after a
single exchange, at which point every keypress lands seconds late.
*Fix: the accumulator is bounded, and a stall keeps only a few ticks of backlog.*

**Retransmission was throttled by frame rate.** The data channel is deliberately
unreliable, so recovery from a dropped message depends on how often the batch is
repeated — and that was throttled by call count, while a stalled client makes one
call per rendered frame. At 17 fps that was two retransmissions a second.
Compounding it, the redundancy window was a flat 8 frames, which stopped being
wider than the input delay once the delay was raised to 8; a client sitting a full
delay behind then needed frames that had already left the window for good.
*Fix: throttled by elapsed time, and the window scales with the delay.*

Regression cover: unit tests that a transmitted frame cannot change and that
mismatched delays deadlock; an integration test running a client that offers a
different frame every iteration while stalled; another running a delay of 8
through 15% loss. `F2` now reports ticks per second and the session state, which
is what identified three of these in one run each.

Still open: in a rig running two headless browsers, an online match drops from 60
ticks per second to near zero while synthetic keys are being dispatched, and
recovers instantly when they stop. Local play under identical mashing is
unaffected, which points at the harness rather than the game — but it is not
proven.

---

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
