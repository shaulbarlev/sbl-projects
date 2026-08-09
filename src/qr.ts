import qrcode from 'qrcode-generator';

/**
 * Render a QR code as SVG.
 *
 * Error correction M and a 4-module quiet zone: the payload is a short URL, so
 * there is plenty of version headroom, and the quiet zone is what actually
 * decides whether a scan works against a busy printed background.
 */
export function qrSvg(text: string, opts: { size?: number; quietZone?: number } = {}): string {
  const size = opts.size ?? 512;
  const quiet = opts.quietZone ?? 4;

  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + quiet * 2;

  const paths: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        paths.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${paths.join('')}" fill="#000"/>` +
    `</svg>`;
}
