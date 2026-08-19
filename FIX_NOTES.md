# v2.1.0 Ninety-One Percent Of It Was Pictures

The question was what to do about network traffic. Measuring it first turned the
answer around: a three-minute match pulled about 12.3 MB of art and 1.24 MB of
netcode, so 91% of what a player downloads is pictures. Of the netcode's share,
only 320 KB is payload — the rest is IP/UDP/DTLS/SCTP framing around one packet
per tick. Compressing every input byte to nothing would have saved a quarter of
the smaller half.

Both halves are addressed, in proportion.

**The art was PNG.** All 598 generated images, including twelve cut-in
backgrounds stored as 1672x941 PNG — a photographic full-screen image in the one
format least suited to it. They are WebP at quality 85 now, chosen by looking at
contact sheets of the six *worst* files at 4x magnification rather than by
picking a number, which `npm run assets:calibrate` regenerates.
*Fix: `scripts/asset_format.py` holds the format and quality for all three
pipelines, so a different quality is one constant rather than eight edits.
`alpha_quality=100` keeps the alpha channel bit-exact, which is what lets both
validators go on asserting that a fully transparent pixel is exactly zero.*

**Forty percent of every cut-in background had never been on a screen.** The
cut-in draws them centred at a resting scale of 1.0 on a 1280x720 canvas, so the
middle 1280x720 pixels map 1:1 and only the glitch tween's four pixels of travel
reach further. The rest was margin.
*Fix: cropped to 1296x728 in `extract_skill_assets.py`. A crop and not a resize —
at 1:1, resizing would blur what cropping leaves pixel-exact. Poses are the
opposite case and were left alone: `INSTALL_BODY_SCALE` is 2, so a transformation
already draws a 360x360 source at 500 px.*

**Twenty-six megabytes shipped on every release that no browser ever asked
for.** The source cards live under `public/`, which Vite copies into `dist`
verbatim, but only the offline Python pipeline reads them — something
`e2e/smoke.spec.ts` had been asserting was never fetched for as long as it
existed.
*Fix: moved to `asset_pipeline_backups/cards/`. The pre-conversion PNGs are kept
beside them, out of `public/`, and the calibration script reads them: measuring a
candidate encoding against an already-encoded image would answer the wrong
question.*

**Every input message repeated frames the opponent already had.** The
retransmission window was `max(12, 3 * inputDelay)` frames wide regardless of
what had arrived — over-provisioned on a healthy link and a guess on a bad one.
*Fix: each packet now carries `nextWanted`, the lowest tick its sender still
needs, and only unacked frames are repeated. The invariant is that a frame leaves
the send buffer only once the peer has said, in a packet we parsed, that it has
it. The old window discarded by age with no evidence of receipt, which is the
mechanism behind the deadlock its own comment warned about; with no ack ever
received the window is the old formula byte for byte, so the worst case is not
worse than before.*

**The wire codec had never been tested on a bad link.** `linkHarness` passed
message objects between the two ends and never called `encodeInput`, so five
latency and loss scenarios exercised the session and none of them exercised the
bytes.
*Fix: the harness encodes and decodes for real, and counts what it sends, which
turns the saving into a regression test — `lockstep.bandwidth.test.ts` runs the
same match twice, once with acks and once against a simulated older peer, and
asserts the two worlds finish byte-identical while the traffic drops.*

**A missing asset was a warning.** Poses and cut-in backgrounds had no on-disk
existence test the way skill cells did, and a failed load logged
`console.warn`, which the browser tests ignore — so a bad rename would have
rendered an invisible fighter and passed.
*Fix: `assetPaths.test.ts` checks all 240 pose paths and twelve backgrounds
against the filesystem, load failures are `console.error`, and `smoke.spec.ts`
carries a per-directory byte budget that fails by a factor of four if the
pipeline ever reverts to PNG.*

## Measured

    dist                113.5 MB -> 14.75 MB
    per match            12.3 MB -> 2.1 MB worst case

    netcode payload per packet
    delay 3, clean        29.4 B -> 18.8 B   -36%
    delay 8, 20% loss     52.4 B -> 28.6 B   -45%
    delay 12, relay       74.8 B -> 37.8 B   -50%

Headers are untouched, so total netcode traffic falls by about a tenth on a
direct link and a third on the relay. Minor rather than major: the wire format
is backward compatible by construction — an older peer that sends no ack leaves
its opponent on the old fixed window, and the tail rides on the existing kind
byte so a relay that predates it forwards the packet untouched.

---

# v2.0.0 Two Hundred And Twenty-Six Pictures

The upgraded build shipped 226 pieces of skill art and a specification for how
the twelve ultimates should look. The port that brought its *gameplay* across —
frame data, hitbox timelines, summons, installs — left the presentation behind.
Fifty of those images were loaded and four per fighter were ever drawn. The other
176 sat in `public/assets/skills/` where nothing could reach them.

Numbered as a major because one control is gone; see the last section.

**Every ultimate looked the same.** Twelve finishers, and each one played as a
white flash, a camera shake and a line of English text. The timelines underneath
were faithful — alien really does sweep low before it bombards, salad really is
an overhead into a low — but none of it was visible, so the read the frame data
offers was one a player had no way to take.
*Fix: `src/fighters/ultimateVisuals.ts`, a beat table on the same tick clock as
`ultimateTimelines.ts`, and `src/render/UltimateStage.ts` to play it. alien's
scan lines land on the sweep and five spheres converge on the spot it locked;
salad's bowl is visible falling for forty ticks before it lands; ok calls four
brothers, ropes you, and pulls a gun. Nothing in the beat table draws — it is
data, so a thirteenth fighter is an entry rather than a class.*

**A transformation was a colour.** doge, goblin, blade and pink each have a full
second set of poses drawn in their transformed body — idle, walk, crouch, jump,
both normals, guard, flinch, knocked out. The renderer applied
`sprite.setTint(accent)` and drew the ordinary sheet underneath. Eight seconds of
being a different fighter looked like eight seconds of being yellow.
*Fix: `src/fighters/installPoses.ts` maps every pose to its transformed cell, the
body doubles as the delivered notes specify, and blade's two swords mount on left
and right sockets. The hurtbox doubles with it — that is the trade the
transformation makes, and it is the one part of this work inside the simulation.*

**A companion had one frame.** tempura's nine clones shared a single drawing, so
a formation of nine read as a texture rather than nine things each worth knocking
down. scared's husky held one pose for its entire ten seconds, giving no tell
before it bit.
*Fix: `src/fighters/summonArt.ts` derives the frame from simulation state —
cooldown, distance, hit points, formation slot. The husky walks, winds up, bites,
gloats when you outrun it, flinches when hit and dissolves when it goes. The
clones wear five faces between them.*

**A charge special looked identical at all three levels.** The whole point of
holding a button is that the opponent can see what is coming; the only tell was
how long the wind-up lasted. Each fighter's three effect cells — alien's beam
thickening, blade's sword lengthening, scared's portal widening — had never been
drawn.
*Fix: `src/render/effectCells.ts`. Six of the twelve hang their art on the
projectile, beam or zone they spawn; the other six are melee and spawn nothing,
so theirs is drawn at the fighter on release.*

**Every cut-in showed the same cell.** All twelve portraits pointed at `D`, the
charge special's release frame. It was a defensible retreat — the upgraded
build's own per-fighter picks include a green explosion with no cat in it — but
it made wizard's portrait a bare magic circle 168x65, stretched to 360 pixels
tall, and left blade holding the shield its ultimate is about throwing away.
*Fix: the portrait is taken from the ultimate's own script rather than chosen a
second time, so the cut-in and the arena cannot disagree about who is fighting.*

**`S + H` no longer fires the ultimate.** It was kept from before the dedicated
button existed, and the crouch buffer holds for eight ticks — so it claimed *any*
special press within eight ticks of touching down. With a full meter that spent
the whole bar; with an empty one it threw the 236 instead. Either way a crouching
player could not reach their charge special, which is the move a player who knows
no motions actually uses. It also forced a precedence rule onto the motion parser
that had been quietly wrong until the tests were run on a full meter.
*Change: the ultimate is `T` (P1) and `I` (P2). The special button is always the
special button, with no cooldown, as the delivered notes specify.*

Regression cover: `src/render/__tests__/skillAssetCoverage.test.ts` asserts every
one of the 226 images is claimed by something that draws it, with exactly one
documented exemption — `blade/K`, the cell the two swords were split out of, which
would put a third sword on screen. `src/net/__tests__/lockstep.install.test.ts`
runs all four transformations across a lossy link and requires byte-identical
worlds, because the hurtbox change is the only part of this that could desync.
`src/sim/__tests__/replay.golden.test.ts` gained a scenario in which somebody
actually hits a transformed fighter: the existing transformation replay ran
doge's install for 534 ticks and sauce never once connected, so until now the
boxes could have been changed to anything and every snapshot would still have
passed. `e2e/ultimates.spec.ts` fires one in a browser and holds it to an object
budget, a stall floor and a recovery check.

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
