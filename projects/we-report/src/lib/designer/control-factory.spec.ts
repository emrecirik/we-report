import { createControl, TOOLBOX_ITEMS } from './control-factory';

describe('control factory', () => {
  it('makes a signature line: a centred caption under a line', () => {
    expect(TOOLBOX_ITEMS.some((t) => t.variant === 'signature')).toBeTrue();
    const c = createControl('text', 'sig', 10, 20, 'Ad Soyad · İmza', 'signature');
    expect(c).toEqual(jasmine.objectContaining({ type: 'text', x: 10, y: 20, text: 'Ad Soyad · İmza' }));
    const style = (c as { styleOverrides?: { textAlign?: string; border?: { sides: Record<string, boolean> } } }).styleOverrides;
    expect(style?.textAlign).toBe('center');
    expect(style?.border?.sides).toEqual({ top: true, right: false, bottom: false, left: false });
  });
});
