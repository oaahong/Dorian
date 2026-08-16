import { describe, it, expect } from 'vitest';
import { clearBackdrop } from '../SpriteExtractor';

/**
 * Poses are cut out of the character cards at boot by keying out the black the
 * artwork sits on. The cats are photographs, so their eyes and open mouths are
 * black too — which is why this pass has to reason about where a dark pixel is
 * and not only how dark it is. Everything below is that distinction.
 */

type Pixel = readonly [number, number, number, number];

const BLACK: Pixel = [0, 0, 0, 255];
const FUR: Pixel = [232, 226, 214, 255];
const FRINGE: Pixel = [34, 30, 28, 255];

type Image = { width: number; height: number; data: Uint8ClampedArray };

/** Build an image from a character map, so the fixtures read as pictures. */
function imageOf(rows: string[], legend: Record<string, Pixel>): Image {
  const height = rows.length;
  const width = rows[0]!.length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => {
    expect(row).toHaveLength(width);
    [...row].forEach((cell, x) => {
      const pixel = legend[cell];
      if (!pixel) throw new Error(`No pixel for '${cell}'`);
      data.set(pixel, (y * width + x) * 4);
    });
  });
  return { width, height, data };
}

function alphaGrid({ width, height, data }: Image): number[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => data[(y * width + x) * 4 + 3]!),
  );
}

describe('clearBackdrop', () => {
  it('erases black that reaches the edge of the crop', () => {
    const image = imageOf(
      [
        '....',
        '.##.',
        '.##.',
        '....',
      ],
      { '.': BLACK, '#': FUR },
    );

    clearBackdrop(image);

    expect(alphaGrid(image)).toEqual([
      [0, 0, 0, 0],
      [0, 255, 255, 0],
      [0, 255, 255, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('keeps black the cat encloses — the missing-eyes bug', () => {
    // A face with two pupils. Keying on colour alone left every cat looking out
    // through two holes in its own head.
    const image = imageOf(
      [
        '.......',
        '.#####.',
        '.#o#o#.',
        '.#####.',
        '.......',
      ],
      { '.': BLACK, '#': FUR, o: BLACK },
    );

    clearBackdrop(image);

    expect(alphaGrid(image)).toEqual([
      [0, 0, 0, 0, 0, 0, 0],
      [0, 255, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 255, 0],
      [0, 255, 255, 255, 255, 255, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('erases black the cat only appears to enclose', () => {
    // The same dark patch, with the mouth open to the bottom of the crop: it is
    // backdrop showing through, and it goes.
    const image = imageOf(
      [
        '.......',
        '.#####.',
        '.#o#o#.',
        '.#o###.',
        '..o....',
      ],
      { '.': BLACK, '#': FUR, o: BLACK },
    );

    clearBackdrop(image);

    const alpha = alphaGrid(image);
    expect([alpha[2]![2], alpha[3]![2], alpha[4]![2]]).toEqual([0, 0, 0]);
    // The other eye is still enclosed, so it stays.
    expect(alpha[2]![4]).toBe(255);
  });

  it('fades the anti-aliased fringe instead of cutting it off', () => {
    // Backdrop pixels between the two thresholds keep a proportional alpha, which
    // is what stops the cutout from looking like scissor work.
    const image = imageOf(['.f#f.'], { '.': BLACK, f: FRINGE, '#': FUR });

    clearBackdrop(image);

    const [left, fringe, fur] = alphaGrid(image)[0]!;
    expect(left).toBe(0);
    expect(fringe).toBeGreaterThan(0);
    expect(fringe).toBeLessThan(255);
    expect(fur).toBe(255);
  });

  it('clears an all-backdrop crop without looping forever', () => {
    const image = imageOf(['..', '..'], { '.': BLACK });

    clearBackdrop(image);

    expect(alphaGrid(image)).toEqual([[0, 0], [0, 0]]);
  });
});
