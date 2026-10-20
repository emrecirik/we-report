import { escPosFromBitmaps, MonoBitmap, toMonoBitmap, zplFromBitmaps } from './printer';

/** 10 × 2 dots: the first row has dots 0 and 9 black, the second is white. */
const BITMAP: MonoBitmap = { width: 10, height: 2, dots: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };

describe('printer output', () => {
  it('reads dark pixels as black, light and transparent ones as paper', () => {
    const rgba = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255, 200, 206, 214, 255, 0, 0, 0, 0]);
    expect(Array.from(toMonoBitmap(rgba, 4, 1).dots)).toEqual([1, 0, 1, 0]);
  });

  it('writes a ZPL label with the page as a graphic field', () => {
    expect(zplFromBitmaps([BITMAP])).toBe('^XA^PW10^LL2^FO0,0^GFA,4,4,2,80400000^FS^XZ\n');
    expect(zplFromBitmaps([BITMAP, BITMAP]).match(/\^XA/g)!.length).toBe(2);
  });

  it('writes ESC/POS raster bands and a cut', () => {
    const bytes = Array.from(escPosFromBitmaps([BITMAP]));
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes.slice(2, 10)).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
    expect(bytes.slice(10, 14)).toEqual([0x80, 0x40, 0, 0]);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0]);
    // A tall page goes in bands of 256 rows.
    const tall: MonoBitmap = { width: 8, height: 600, dots: new Uint8Array(8 * 600) };
    expect(Array.from(escPosFromBitmaps([tall], { cut: false })).filter((b, i, a) => b === 0x1d && a[i + 1] === 0x76).length).toBe(3);
  });
});
