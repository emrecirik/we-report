import { gapsAround, guessBindings } from './design-surface.component';

describe('guessBindings', () => {
  it('groups by repeating texts and sums the largest number field', () => {
    const rows = [
      { orderNo: 1001, city: 'Ankara', customer: 'A', month: 1, amount: 120.5 },
      { orderNo: 1002, city: 'Ankara', customer: 'B', month: 2, amount: 80 },
      { orderNo: 1003, city: 'İzmir', customer: 'C', month: 1, amount: 300 },
      { orderNo: 1004, city: 'İzmir', customer: 'D', month: 3, amount: 45 },
    ];
    expect(guessBindings(rows)).toEqual({ groups: ['city'], amount: 'amount' }); // never the order number
    expect(guessBindings([])).toEqual({ groups: [], amount: undefined });
  });
});

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
