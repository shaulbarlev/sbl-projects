import jsQR from 'jsqr';

/**
 * Decode a QR SVG produced by `qrSvg`.
 *
 * The SVG path is parsed back into a bitmap here rather than reusing the
 * generator's module grid, and the decode is done by jsQR — a separate
 * implementation. That is what makes this an actual test of "does the printed
 * code scan" instead of a test that the generator agrees with itself.
 */
export function decodeQrSvg(svg: string): string | null {
  const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!viewBox) return null;
  const total = Number(viewBox[1]);

  const path = svg.match(/<path d="([^"]+)"/);
  if (!path) return null;

  const modules = [...path[1].matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as const,
  );

  const scale = 8;
  const dim = total * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);

  for (const [col, row] of modules) {
    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const px = ((row * scale + y) * dim + (col * scale + x)) * 4;
        data[px] = data[px + 1] = data[px + 2] = 0;
      }
    }
  }

  return jsQR(data, dim, dim)?.data ?? null;
}
