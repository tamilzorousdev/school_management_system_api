import sharp from 'sharp';
import {
  isDrawnSignaturePurpose,
  isSignaturePurpose,
  SignatureNotFoundError,
  signatureFromDrawing,
  signatureFromPhoto,
} from './signature-image';

const paperPhoto = (ink: string) =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
      <defs>
        <linearGradient id="light" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f4efe4"/>
          <stop offset="1" stop-color="#9c978c"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#light)"/>
      ${ink}
    </svg>`),
  )
    .jpeg({ quality: 80 })
    .toBuffer();

const SIGNATURE = `<path d="M300 520 C 360 380, 420 380, 440 500 S 520 640, 580 470 S 700 360, 760 520 L 900 450"
  fill="none" stroke="#1e3a8a" stroke-width="7" stroke-linecap="round"/>`;

describe('signatureFromPhoto', () => {
  it('turns a photo of a pen signature on paper into a tight transparent PNG in the pen colour', async () => {
    const result = await signatureFromPhoto(await paperPhoto(SIGNATURE));
    const meta = await sharp(result.content).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect(result.width).toBeLessThan(900);
    expect(result.height).toBeLessThan(400);

    const { data, info } = await sharp(result.content).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    expect(pixel(0, 0)[3]).toBe(0);
    expect(pixel(info.width - 1, info.height - 1)[3]).toBe(0);

    let inked = 0;
    let blueish = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3]! < 200) continue;
      inked += 1;
      if (data[index + 2]! > data[index]!) blueish += 1;
    }
    expect(inked).toBeGreaterThan(500);
    expect(blueish / inked).toBeGreaterThan(0.9);
  });

  it('refuses a photo with no signature', async () => {
    await expect(signatureFromPhoto(await paperPhoto(''))).rejects.toBeInstanceOf(SignatureNotFoundError);
  });
});

const padExport = (ink: string) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400">${ink}</svg>`))
    .png()
    .toBuffer();

describe('signatureFromDrawing', () => {
  it('keeps thin pad strokes and crops a transparent pad export to the signature', async () => {
    const result = await signatureFromDrawing(
      await padExport(
        '<path d="M200 260 C 260 120, 330 120, 350 240 S 450 330, 520 200 L 760 230" fill="none" stroke="#000" stroke-width="3"/>',
      ),
    );
    expect(result.width).toBeLessThan(620);
    const { data } = await sharp(result.content).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    let inked = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]! > 200) inked += 1;
    expect(inked).toBeGreaterThan(300);
  });

  it('refuses an empty pad', async () => {
    await expect(signatureFromDrawing(await padExport(''))).rejects.toBeInstanceOf(SignatureNotFoundError);
  });
});

describe('isSignaturePurpose', () => {
  it('matches every signature upload and nothing else', () => {
    expect(['signature', 'teacher_signature', 'parent_signature', 'school_signature'].every(isSignaturePurpose)).toBe(
      true,
    );
    expect(['school_seal', 'student_photo', 'signatures_list', undefined].some(isSignaturePurpose)).toBe(false);
    expect(isDrawnSignaturePurpose('signature_pad')).toBe(true);
    expect(isDrawnSignaturePurpose('signature')).toBe(false);
  });
});
