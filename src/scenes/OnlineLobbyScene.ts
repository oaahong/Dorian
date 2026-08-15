import * as Phaser from 'phaser';
import { FIGHTERS } from '../fighters/fighterData';
import { LockstepSession } from '../net/LockstepSession';
import { OnlineClient, type RoomState } from '../net/OnlineClient';
import { endOnlineMatch, onlineMatch } from '../net/onlineMatch';
import { ROOM_CODE_ALPHABET } from '../net/roomCode';
import { AudioManager } from '../systems/AudioManager';
import { gameState, type StageId } from '../systems/GameState';
import { SpriteExtractor } from '../systems/SpriteExtractor';
import { COLORS, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../utils/constants';

/**
 * Room-code matchmaking: create a room and read the code out, or type a friend's.
 *
 * Input uses physical `KeyboardEvent.code` throughout, for the reason recorded in
 * FIX_NOTES.md — with a CJK IME active `event.key` can arrive as composition text,
 * which is exactly how the original character select managed to look frozen. That
 * matters more here than anywhere else, because this screen is the one where a
 * player types.
 */

type Phase = 'connecting' | 'menu' | 'entering-code' | 'in-room' | 'error';

export class OnlineLobbyScene extends Phaser.Scene {
  private client: OnlineClient | null = null;
  private phase: Phase = 'connecting';
  private room: RoomState | null = null;
  private typedCode = '';
  private cursor = 0;
  private locked = false;
  private message = '';
  private inputLockedUntil = 0;
  private leaving = false;

  private title!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image;

  constructor() {
    super('OnlineLobbyScene');
  }

  create(): void {
    this.phase = 'connecting';
    this.room = null;
    this.typedCode = '';
    this.cursor = 0;
    this.locked = false;
    this.message = '';
    this.leaving = false;
    this.inputLockedUntil = this.time.now + 300;

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.add.rectangle(GAME_WIDTH / 2, 80, 1000, 100, 0x090909).setStrokeStyle(3, COLORS.gold);
    this.title = this.add.text(GAME_WIDTH / 2, 80, 'ONLINE VS', {
      fontFamily: FONT_FAMILY, fontSize: '48px', color: '#E9B928', stroke: '#050505', strokeThickness: 8,
    }).setOrigin(.5);

    this.body = this.add.text(GAME_WIDTH / 2, 250, '', {
      fontFamily: FONT_FAMILY, fontSize: '30px', color: '#F3E9D0', align: 'center', lineSpacing: 16,
    }).setOrigin(.5);

    this.portrait = this.add.image(GAME_WIDTH / 2, 470, SpriteExtractor.textureKey(FIGHTERS[0]!.id, 'idle'))
      .setOrigin(.5, 1).setVisible(false);

    this.status = this.add.text(GAME_WIDTH / 2, 560, '', {
      fontFamily: FONT_FAMILY, fontSize: '20px', color: '#00C8FF',
    }).setOrigin(.5);

    this.hint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 60, '', {
      fontFamily: FONT_FAMILY, fontSize: '17px', color: '#bfb49c', align: 'center', lineSpacing: 8,
    }).setOrigin(.5);

    this.connect();
    this.bindKeys();
    this.refresh();
  }

  private connect(): void {
    try {
      const socket = new WebSocket(OnlineClient.url());
      socket.addEventListener('open', () => {
        this.phase = 'menu';
        this.client?.startPinging();
        this.refresh();
      });
      this.client = new OnlineClient(socket, {
        onRoomState: (room) => { this.room = room; this.phase = 'in-room'; this.refresh(); },
        onMatchStart: (start) => this.beginMatch(start),
        onOpponentLeft: () => { this.locked = false; this.message = 'OPPONENT LEFT'; this.refresh(); },
        onError: (_code, message) => { this.message = message.toUpperCase(); this.refresh(); },
        onClose: () => {
          if (this.leaving) return;
          this.phase = 'error';
          this.message = 'CONNECTION LOST';
          this.refresh();
        },
      });
    } catch {
      this.phase = 'error';
      this.message = 'COULD NOT REACH THE SERVER';
      this.refresh();
    }
  }

  private beginMatch(start: { seed: number; stage: string; p1Character: string; p2Character: string; inputDelay: number }): void {
    if (!this.client || !this.room) return;

    gameState.data.mode = 'online';
    gameState.data.seed = start.seed;
    gameState.data.stage = start.stage as StageId;
    gameState.data.p1Character = start.p1Character;
    gameState.data.p2Character = start.p2Character;
    gameState.resetMatch();

    onlineMatch.current = {
      client: this.client,
      seat: this.room.seat,
      session: new LockstepSession({
        localPlayer: this.room.seat,
        // The server's suggestion, widened if this client is measuring a worse
        // round trip than the delay would cover.
        inputDelay: Math.max(start.inputDelay, this.client.suggestedInputDelay()),
        transport: this.client,
      }),
    };

    this.leaving = true;
    this.client.stopPinging();
    AudioManager.play('menu');
    this.scene.start('BattleScene');
  }

  /**
   * Listens to the DOM rather than to Phaser's keyboard plugin.
   *
   * Phaser's event stream was observed replaying its queue in this scene — a
   * single press of one key arrived as several events, including ones already
   * handled. That is invisible in a menu where a repeat just re-selects the same
   * entry, but it makes typing a room code impossible. The DOM delivers exactly
   * one keydown per press.
   *
   * No `preventDefault` here: calling it would make Phaser discard the event, and
   * that is precisely the bug recorded in FIX_NOTES.md. Scroll prevention is
   * already handled by Phaser's own capture list.
   */
  private bindKeys(): void {
    window.addEventListener('keydown', this.onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', this.onKey);
      // Only tear the socket down if we are not handing it to the battle.
      if (!onlineMatch.current) endOnlineMatch();
    });
  }

  private onKey = (event: KeyboardEvent): void => {
    if (this.time.now < this.inputLockedUntil || this.leaving) return;
    // Held keys auto-repeat; a room code should not gain characters because the
    // player rested a finger on a key.
    if (event.repeat) return;
    const code = event.code;

    if (code === 'Escape') return this.back();

    /**
     * While typing a code, letters are text and nothing else.
     *
     * The code alphabet contains G and M, which are the global "back" and "mute"
     * shortcuts — so a room code like CGHUEN used to throw the player out of the
     * lobby halfway through typing it. Escape stays available because it is not a
     * character anyone can need.
     */
    if (this.phase === 'entering-code') return this.onCodeKey(code);

    if (code === 'KeyG') return this.back();
    if (code === 'KeyM') { AudioManager.toggleMute(); return; }

    switch (this.phase) {
      case 'menu': return this.onMenuKey(code);
      case 'in-room': return this.onRoomKey(code);
      default: return;
    }
  };

  private onMenuKey(code: string): void {
    if (code === 'KeyF' || code === 'Enter') {
      this.message = '';
      this.client?.createRoom();
      AudioManager.play('menu');
    } else if (code === 'KeyJ') {
      this.phase = 'entering-code';
      this.typedCode = '';
      this.message = '';
      AudioManager.play('menu');
    }
    this.refresh();
  }

  private onCodeKey(code: string): void {
    if (code === 'Backspace') {
      this.typedCode = this.typedCode.slice(0, -1);
    } else if (code === 'Enter' || code === 'KeyF') {
      if (this.typedCode.length > 0) {
        this.client?.joinRoom(this.typedCode);
        AudioManager.play('menu');
      }
    } else {
      // Physical key codes, so an active IME cannot turn a letter into
      // composition text and leave this screen looking frozen.
      const typed = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : '';
      if (typed.length === 1 && ROOM_CODE_ALPHABET.includes(typed) && this.typedCode.length < 6) {
        this.typedCode += typed;
        AudioManager.play('menu');
      }
    }
    this.refresh();
  }

  private onRoomKey(code: string): void {
    if (this.locked) {
      if (code === 'KeyF' || code === 'Enter') {
        this.locked = false;
        this.client?.setReady(false);
        AudioManager.play('menu');
      }
      this.refresh();
      return;
    }

    if (code === 'ArrowLeft' || code === 'KeyA') {
      this.cursor = (this.cursor + FIGHTERS.length - 1) % FIGHTERS.length;
      AudioManager.play('menu');
    } else if (code === 'ArrowRight' || code === 'KeyD') {
      this.cursor = (this.cursor + 1) % FIGHTERS.length;
      AudioManager.play('menu');
    } else if (code === 'KeyF' || code === 'Enter') {
      this.client?.selectCharacter(FIGHTERS[this.cursor]!.id);
      this.client?.setReady(true);
      this.locked = true;
      AudioManager.play('menu');
    }
    this.refresh();
  }

  private back(): void {
    this.leaving = true;
    endOnlineMatch();
    this.scene.start('ModeSelectScene');
  }

  private refresh(): void {
    const fighter = FIGHTERS[this.cursor]!;

    switch (this.phase) {
      case 'connecting':
        this.body.setText('CONNECTING...');
        this.hint.setText('ESC : BACK');
        this.portrait.setVisible(false);
        break;

      case 'menu':
        this.body.setText('F : CREATE A ROOM\nJ : JOIN WITH A CODE');
        this.hint.setText('ESC : BACK');
        this.portrait.setVisible(false);
        break;

      case 'entering-code':
        this.body.setText(`ROOM CODE\n${this.typedCode.padEnd(6, '_').split('').join(' ')}`);
        this.hint.setText('TYPE THE CODE     ENTER : JOIN     BACKSPACE : DELETE     ESC : BACK');
        this.portrait.setVisible(false);
        break;

      case 'in-room': {
        const room = this.room!;
        const opponent = room.slots[room.seat === 0 ? 1 : 0];
        const you = room.slots[room.seat];
        this.body.setText(
          `ROOM  ${room.code}\n` +
          `YOU: ${this.locked ? nameOf(you?.characterId) : fighter.name}${this.locked ? '  (READY)' : ''}\n` +
          `OPPONENT: ${opponent ? `${nameOf(opponent.characterId)}${opponent.ready ? '  (READY)' : ''}` : 'WAITING...'}`,
        );
        this.portrait.setVisible(true).setTexture(SpriteExtractor.textureKey(fighter.id, 'idle'));
        normalisePortrait(this.portrait);
        this.hint.setText(
          this.locked
            ? 'F : CANCEL READY     ESC : LEAVE'
            : 'A D / ← → : CHOOSE     F : READY     ESC : LEAVE',
        );
        break;
      }

      case 'error':
        this.body.setText(this.message || 'SOMETHING WENT WRONG');
        this.hint.setText('ESC : BACK');
        this.portrait.setVisible(false);
        break;
    }

    const rtt = this.client?.roundTripMs;
    this.status.setText(
      [this.message, rtt !== null && rtt !== undefined ? `PING ${Math.round(rtt)}MS` : '']
        .filter(Boolean)
        .join('     '),
    );
  }
}

function nameOf(characterId: string | null | undefined): string {
  if (!characterId) return 'CHOOSING...';
  return FIGHTERS.find((fighter) => fighter.id === characterId)?.name ?? characterId;
}

function normalisePortrait(image: Phaser.GameObjects.Image): void {
  const source = image.texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  image.setScale(Math.min(200 / Math.max(1, source.height), 260 / Math.max(1, source.width)));
}
