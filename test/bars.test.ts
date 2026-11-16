import { describe, expect, it } from 'vitest';
import { bar, BAR_CELLS, weightTier } from '../src/extension/bars.js';

describe('barras de peso de la vista «Carpetas»', () => {
  it('10 celdas de 8 pasos', () => {
    expect(bar(1)).toBe('█'.repeat(BAR_CELLS));
    expect(bar(0.5)).toBe('█████');
    expect(bar(0.83)).toBe('████████▎');
    expect(bar(0.068)).toBe('▋');
    expect(bar(0.05)).toBe('▌');
    expect(bar(0.011)).toBe('▏');
  });

  it('lo que no pesa no lleva barra; lo minúsculo, la mínima', () => {
    expect(bar(0)).toBe('');
    expect(bar(Number.NaN)).toBe('');
    expect(bar(0.0001)).toBe('▏');
    expect(bar(3)).toBe('█'.repeat(BAR_CELLS));
  });

  it('más peso, barra más larga (nunca al revés)', () => {
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const len = [...bar(i / 1000)].reduce((s, c) => s + (c === '█' ? 8 : '▏▎▍▌▋▊▉'.indexOf(c) + 1), 0);
      expect(len).toBeGreaterThanOrEqual(prev);
      prev = len;
    }
  });

  it('tramos de color', () => {
    expect([0.6, 0.5, 0.3, 0.2, 0.15, 0.1, 0.09].map(weightTier)).toEqual(['heavy', 'heavy', 'large', 'large', 'notable', 'notable', null]);
  });
});
