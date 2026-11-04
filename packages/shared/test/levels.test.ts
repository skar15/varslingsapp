import { describe, expect, it } from 'vitest';
import levelMap from '../../../config/level_map.json';
import { mapSourceLevel, maxLevel, meetsSensitivity, normaliseSourceLevel, type LevelMapRow } from '../src/levels';

const rows = levelMap.rows as LevelMapRow[];

describe('level mapping (D2, D3)', () => {
  it('maps official yellow to YELLOW and orange/red to RED', () => {
    expect(mapSourceLevel(rows, 'met', 'yellow')).toBe('yellow');
    expect(mapSourceLevel(rows, 'met', 'orange')).toBe('red');
    expect(mapSourceLevel(rows, 'met', 'red')).toBe('red');
  });
  it('reads awareness_level strings', () => {
    expect(mapSourceLevel(rows, 'met', '2; yellow; Moderate')).toBe('yellow');
    expect(mapSourceLevel(rows, 'nve-flood', '3; orange; Severe')).toBe('red');
    expect(mapSourceLevel(rows, 'nve-flood', '4')).toBe('red');
  });
  it('green from an issuer is not a warning', () => {
    expect(mapSourceLevel(rows, 'met', 'green')).toBeNull();
  });
  it('unknown colour is undefined', () => {
    expect(mapSourceLevel(rows, 'met', 'purple')).toBeUndefined();
    expect(normaliseSourceLevel('')).toBeNull();
  });
  it('max level', () => {
    expect(maxLevel(['yellow', null, 'red', 'green'])).toBe('red');
    expect(maxLevel([])).toBeNull();
  });
});

describe('sensitivity thresholds', () => {
  it('HIGH notifies at green, yellow, red', () => {
    expect(meetsSensitivity('green', 'high')).toBe(true);
    expect(meetsSensitivity('yellow', 'high')).toBe(true);
  });
  it('MEDIUM notifies at yellow and red', () => {
    expect(meetsSensitivity('green', 'medium')).toBe(false);
    expect(meetsSensitivity('yellow', 'medium')).toBe(true);
  });
  it('LOW notifies at red only (A3)', () => {
    expect(meetsSensitivity('yellow', 'low')).toBe(false);
    expect(meetsSensitivity('red', 'low')).toBe(true);
  });
});
