import type * as Phaser from 'phaser';
import type { FighterConfig } from '../fighters/FighterConfig';

export type PoseName =
  | 'idle' | 'walkForward' | 'walkBack' | 'jump' | 'crouch'
  | 'light' | 'heavy' | 'block' | 'hit' | 'special' | 'ultimate'
  | 'victory' | 'ko';

const POSES: PoseName[] = [
  'idle','walkForward','walkBack','jump','crouch','light','heavy','block','hit','special','ultimate','victory','ko',
];

type Rect = { x: number; y: number; w: number; h: number };

// Coordinates are normalized against the supplied 1122x1402 character-card layout.
const REF_W = 1122;
const REF_H = 1402;
const CARD_Y_OFFSETS: Record<string, number> = { '01':0, '02':-10, '03':5, '04':19, '05':15, '06':12, '07':18, '08':8 };
const RECTS: Record<PoseName, Rect> = {
  idle:        { x: 20,  y: 500, w: 207, h: 168 },
  walkForward: { x: 236, y: 500, w: 207, h: 168 },
  walkBack:    { x: 452, y: 500, w: 207, h: 168 },
  jump:        { x: 668, y: 500, w: 207, h: 168 },
  crouch:      { x: 884, y: 500, w: 207, h: 168 },
  light:       { x: 20,  y: 728, w: 207, h: 144 },
  heavy:       { x: 236, y: 728, w: 207, h: 144 },
  block:       { x: 452, y: 728, w: 207, h: 144 },
  hit:         { x: 668, y: 728, w: 207, h: 144 },
  special:     { x: 884, y: 728, w: 207, h: 144 },
  ultimate:    { x: 20,  y: 932, w: 530, h: 180 },
  victory:     { x: 560, y: 932, w: 268, h: 180 },
  ko:          { x: 838, y: 932, w: 253, h: 180 },
};

export class SpriteExtractor {
  constructor(private readonly scene: Phaser.Scene) {}

  extractAll(fighters: FighterConfig[]): void {
    fighters.forEach((fighter) => {
      const cardKey = fighter.cardTexture;
      if (!this.scene.textures.exists(cardKey)) {
        console.warn(`[SpriteExtractor] Missing ${cardKey}; generating fallback card and poses.`);
        this.createFallbackCard(fighter);
        POSES.forEach((pose) => this.createFallback(fighter, pose));
        return;
      }
      try {
        const source = this.scene.textures.get(cardKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        POSES.forEach((pose) => this.extractPose(fighter, pose, source));
      } catch (error) {
        console.warn(`[SpriteExtractor] Failed ${fighter.id}; fallback used.`, error);
        POSES.forEach((pose) => this.createFallback(fighter, pose));
      }
    });
  }

  static textureKey(fighterId: string, pose: PoseName): string {
    return `pose-${fighterId}-${pose}`;
  }

  private extractPose(fighter: FighterConfig, pose: PoseName, source: HTMLImageElement | HTMLCanvasElement): void {
    const key = SpriteExtractor.textureKey(fighter.id, pose);
    if (this.scene.textures.exists(key)) return;

    const scaleX = source.width / REF_W;
    const scaleY = source.height / REF_H;
    const ref = RECTS[pose];
    const insetX = 8;
    const yOffset = CARD_Y_OFFSETS[fighter.number] ?? 0;
    const sx = Math.round((ref.x + insetX) * scaleX);
    const sy = Math.round((ref.y + yOffset) * scaleY);
    const sw = Math.max(8, Math.round((ref.w - insetX * 2) * scaleX));
    const sh = Math.max(8, Math.round(ref.h * scaleY));

    const scratch = document.createElement('canvas');
    scratch.width = sw;
    scratch.height = sh;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas2D unavailable');
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

    const pixels = ctx.getImageData(0, 0, sw, sh);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const max = Math.max(r, g, b);
      if (r < 25 && g < 25 && b < 25) {
        data[i + 3] = 0;
      } else if (max < 42) {
        data[i + 3] = Math.round(((max - 25) / 17) * data[i + 3]!);
      }
    }
    this.removePanelBorderAndLabels(pixels);
    ctx.putImageData(pixels, 0, 0);

    const bounds = this.alphaBounds(pixels);
    const pad = 3;
    const x = Math.max(0, bounds.x - pad);
    const y = Math.max(0, bounds.y - pad);
    const right = Math.min(sw, bounds.x + bounds.w + pad);
    const bottom = Math.min(sh, bounds.y + bounds.h + pad);
    const width = Math.max(8, right - x);
    const height = Math.max(8, bottom - y);

    const texture = this.scene.textures.createCanvas(key, width, height);
    if (!texture) throw new Error(`Unable to create texture ${key}`);
    const output = texture.getContext();
    output.clearRect(0, 0, width, height);
    output.drawImage(scratch, x, y, width, height, 0, 0, width, height);
    texture.refresh();
  }


  private removePanelBorderAndLabels(imageData: ImageData): void {
    const { width, height, data } = imageData;
    const edge = 3;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x < edge || x >= width - edge || y < edge || y >= height - edge) {
          data[(y * width + x) * 4 + 3] = 0;
        }
      }
    }

    // Panel headings are small disconnected components near the top. Keep large
    // components (the cat itself) even when ears reach the top edge.
    const visited = new Uint8Array(width * height);
    const topLimit = Math.min(52, Math.floor(height * .36));
    const maxArtifactArea = Math.max(1200, Math.floor(width * height * .045));
    const stack: number[] = [];
    const component: number[] = [];

    for (let y = edge; y < height - edge; y += 1) {
      for (let x = edge; x < width - edge; x += 1) {
        const seed = y * width + x;
        if (visited[seed] || data[seed * 4 + 3]! <= 18) continue;
        stack.length = 0;
        component.length = 0;
        stack.push(seed);
        visited[seed] = 1;
        let minX = x; let maxX = x; let minY = y; let maxY = y;

        while (stack.length > 0) {
          const index = stack.pop()!;
          component.push(index);
          const cx = index % width;
          const cy = Math.floor(index / width);
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
          const neighbors = [index - 1, index + 1, index - width, index + width];
          for (const next of neighbors) {
            if (next < 0 || next >= width * height || visited[next]) continue;
            const nx = next % width;
            const ny = Math.floor(next / width);
            if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
            if (data[next * 4 + 3]! <= 18) continue;
            visited[next] = 1;
            stack.push(next);
          }
        }

        const componentWidth = maxX - minX + 1;
        const componentHeight = maxY - minY + 1;
        const topArtifact = maxY < topLimit && component.length < maxArtifactArea && componentHeight < 42;
        const borderArtifact = (componentWidth > width * .72 && componentHeight < 14) || (componentHeight > height * .72 && componentWidth < 14);
        if (topArtifact || borderArtifact) component.forEach((index) => { data[index * 4 + 3] = 0; });
      }
    }
  }

  private createFallbackCard(fighter: FighterConfig): void {
    if (this.scene.textures.exists(fighter.cardTexture)) return;
    const texture = this.scene.textures.createCanvas(fighter.cardTexture, 560, 700);
    if (!texture) return;
    const ctx = texture.getContext();
    const primary = `#${fighter.palette.primary.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 560, 700);
    ctx.strokeStyle = '#E9B928'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 536, 676);
    ctx.fillStyle = '#E9B928'; ctx.font = 'bold 30px sans-serif'; ctx.fillText(`角色 ${fighter.number}`, 32, 58);
    ctx.fillStyle = '#F3E9D0'; ctx.font = 'bold 42px sans-serif'; ctx.fillText(fighter.name, 32, 110);
    ctx.fillStyle = primary;
    ctx.beginPath(); ctx.moveTo(120, 300); ctx.lineTo(155, 205); ctx.lineTo(215, 285); ctx.fill();
    ctx.beginPath(); ctx.moveTo(345, 285); ctx.lineTo(405, 205); ctx.lineTo(440, 300); ctx.fill();
    ctx.beginPath(); ctx.ellipse(280, 395, 170, 185, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050505';
    ctx.beginPath(); ctx.arc(225, 355, 18, 0, Math.PI * 2); ctx.arc(335, 355, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#F3E9D0'; ctx.font = 'bold 26px sans-serif';
    ctx.fillText(fighter.archetype, 32, 615);
    ctx.font = '20px sans-serif';
    ctx.fillText(`SPECIAL: ${fighter.special.name}`, 32, 652);
    ctx.fillText(`ULT: ${fighter.ultimate.name}`, 32, 680);
    texture.refresh();
  }

  private alphaBounds(imageData: ImageData): Rect {
    const { width, height, data } = imageData;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * 4 + 3]!;
        if (alpha > 18) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) return { x: 0, y: 0, w: width, h: height };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  private createFallback(fighter: FighterConfig, pose: PoseName): void {
    const key = SpriteExtractor.textureKey(fighter.id, pose);
    if (this.scene.textures.exists(key)) return;
    const texture = this.scene.textures.createCanvas(key, 220, 270);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, 220, 270);
    const color = `#${fighter.palette.primary.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(45, 70); ctx.lineTo(65, 20); ctx.lineTo(95, 66); ctx.fill();
    ctx.beginPath(); ctx.moveTo(125, 66); ctx.lineTo(158, 20); ctx.lineTo(178, 72); ctx.fill();
    ctx.beginPath(); ctx.ellipse(110, 145, 84, 105, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050505';
    ctx.beginPath(); ctx.arc(82, 115, 10, 0, Math.PI * 2); ctx.arc(138, 115, 10, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(pose.toUpperCase(), 110, 245);
    texture.refresh();
  }
}
