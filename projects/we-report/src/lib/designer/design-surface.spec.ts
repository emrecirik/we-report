import { gapsAround } from './design-surface.component';

describe('gapsAround', () => {
  it('measures to the nearest item facing each side, ignoring items out of line', () => {
    const p = { x: 50, y: 20, width: 20, height: 10 };
    const others = [
      { x: 10, y: 22, width: 30, height: 5 }, // left, 10 mm away
      { x: 0, y: 22, width: 5, height: 5 }, // further left: not the nearest
      { x: 80, y: 0, width: 10, height: 5 }, // up-right, faces no side
      { x: 55, y: 35, width: 10, height: 5 }, // below, 5 mm away
    ];
    const gaps = gapsAround(p, others, 'b');
    expect(gaps.map((g) => [g.orientation, g.length])).toEqual([
      ['h', 10],
      ['v', 5],
    ]);
    expect(gaps[0].x).toBe(40);
    expect(gaps[1].y).toBe(30);
  });
});
