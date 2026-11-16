import sharp from 'sharp';
import { pdfImage } from './files.service';

jest.setTimeout(30_000);

describe('pdfImage', () => {
  it('puts a transparent signature on white instead of a black box', async () => {
    const signature = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><path d="M10 60 C 60 0, 120 0, 190 50" fill="none" stroke="#1e3a8a" stroke-width="4"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const { data, info } = await sharp(await pdfImage(signature))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    const corner = [...data.subarray(0, 3)];
    expect(corner.every((value) => value > 245)).toBe(true);
    let ink = 0;
    for (let index = 0; index < data.length; index += 3) if (data[index + 2]! > data[index]! + 40) ink += 1;
    expect(ink).toBeGreaterThan(50);
  });

  it('keeps a chosen background colour', async () => {
    const empty = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { data } = await sharp(await pdfImage(empty, '#ff0000'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeLessThan(20);
  });
});
