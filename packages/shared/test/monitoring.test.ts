import { describe, expect, it } from 'vitest';
import objectStatuses from '../../../config/object_statuses.json';
import objectTypes from '../../../config/object_types.json';
import situationTypes from '../../../config/situation_types.json';
import { monitoredSet, shouldNotify, statusesForType, suggestedSituations, type ReferenceSets } from '../src/monitoring';

const ref: ReferenceSets = { situations: situationTypes, types: objectTypes, statuses: objectStatuses };

describe('monitored set', () => {
  it('uses type defaults when no explicit rows', () => {
    const set = monitoredSet({ type_key: 'boat', status_key: 'normal', situations: [] }, ref);
    expect([...set.keys()].sort()).toEqual(['ice', 'lightning', 'storm_surge', 'wind']);
    expect(set.get('wind')?.sensitivity).toBe('high');
  });

  it('with no type monitors every available situation type (D4 hides M6 types)', () => {
    const set = monitoredSet({ type_key: null, status_key: 'normal', situations: [] }, ref);
    expect(set.has('wave_height')).toBe(false);
    expect(set.size).toBe(9);
  });

  it('type "other" has no defaults', () => {
    expect(monitoredSet({ type_key: 'other', status_key: 'normal', situations: [] }, ref).size).toBe(0);
  });

  it('A2: status exterior_work adds precipitation on top of explicit wind, with HIGH effective sensitivity', () => {
    const set = monitoredSet(
      { type_key: 'private_home', status_key: 'exterior_work', situations: [{ situation_key: 'wind', sensitivity: 'high' }] },
      ref,
    );
    expect(set.has('precipitation')).toBe(true);
    expect(set.get('precipitation')?.addedByStatus).toBe(true);
    expect(set.get('wind')?.effectiveSensitivity).toBe('high');
  });

  it('a status-added situation overrides a stored LOW sensitivity', () => {
    const set = monitoredSet(
      { type_key: 'private_home', status_key: 'loose_items', situations: [{ situation_key: 'wind', sensitivity: 'low' }] },
      ref,
    );
    expect(set.get('wind')?.effectiveSensitivity).toBe('high');
    expect(shouldNotify(set, 'wind', 'yellow')).toBe(true);
  });

  it('stored_indoors removes situations', () => {
    const set = monitoredSet({ type_key: 'caravan', status_key: 'stored_indoors', situations: [] }, ref);
    expect([...set.keys()]).toEqual(['flood']);
  });

  it('A3: LOW sensitivity ignores yellow and notifies red', () => {
    const set = monitoredSet({ type_key: 'private_home', status_key: 'normal', situations: [{ situation_key: 'wind', sensitivity: 'low' }] }, ref);
    expect(shouldNotify(set, 'wind', 'yellow')).toBe(false);
    expect(shouldNotify(set, 'wind', 'red')).toBe(true);
    expect(shouldNotify(set, 'snow', 'red')).toBe(false);
  });

  it('unmapped events are never notified', () => {
    const set = monitoredSet({ type_key: null, status_key: 'normal', situations: [] }, ref);
    expect(shouldNotify(set, null, 'red')).toBe(false);
  });

  it('statuses for type and suggestions', () => {
    expect(statusesForType(ref, 'boat').map((s) => s.key)).toContain('moored');
    expect(statusesForType(ref, 'private_home').map((s) => s.key)).not.toContain('moored');
    expect(statusesForType(ref, null).map((s) => s.key)).not.toContain('exterior_work');
    expect(suggestedSituations(ref, 'boat', 'normal')).toContain('storm_surge');
  });
});
