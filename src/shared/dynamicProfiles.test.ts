import { describe, it, expect } from 'vitest';
import {
  analyzeDynamicProfile,
  parentCandidates,
  resolveParent,
  folderBlockingFiles,
  type DynamicProfileAnalysis,
} from './dynamicProfiles';

function entriesOf(analysis: DynamicProfileAnalysis) {
  if (analysis.kind !== 'profiles') throw new Error(`expected profiles, got ${analysis.kind}`);
  return analysis.entries;
}

describe('analyzeDynamicProfile', () => {
  it('classifies an empty or whitespace body as empty, not a JSON parse failure', () => {
    expect(analyzeDynamicProfile('').kind).toBe('empty');
    expect(analyzeDynamicProfile('  \n\t').kind).toBe('empty');
  });

  it('classifies XML and binary plists as plist rather than lying about a JSON error', () => {
    expect(analyzeDynamicProfile('<?xml version="1.0"?><plist/>').kind).toBe('plist');
    expect(analyzeDynamicProfile('bplist00...').kind).toBe('plist');
  });

  it('reports invalid JSON with the parser message', () => {
    const a = analyzeDynamicProfile('{ "Profiles": [ }');
    expect(a.kind).toBe('json-error');
    if (a.kind === 'json-error') expect(a.message.length).toBeGreaterThan(0);
  });

  it('reports valid JSON of the wrong shape distinctly from a parse failure', () => {
    expect(analyzeDynamicProfile('[1,2]')).toEqual({
      kind: 'shape-error',
      message: 'top level must be an object',
    });
    expect(analyzeDynamicProfile('{"Porfiles": []}')).toEqual({
      kind: 'shape-error',
      message: 'missing top-level "Profiles" key',
    });
    expect(analyzeDynamicProfile('{"Profiles": {}}')).toEqual({
      kind: 'shape-error',
      message: '"Profiles" must be an array',
    });
  });

  it('flags missing required Guid and Name per entry', () => {
    const entries = entriesOf(
      analyzeDynamicProfile('{"Profiles": [{"Name": "A"}, {"Guid": "g1"}, {}]}'),
    );
    expect(entries[0].issues).toEqual(['missing required "Guid"']);
    expect(entries[1].issues).toEqual(['missing required "Name"']);
    expect(entries[2].issues).toEqual(['missing required "Guid"', 'missing required "Name"']);
  });

  it('flags every entry sharing a duplicated Guid within one file', () => {
    const entries = entriesOf(
      analyzeDynamicProfile(
        '{"Profiles": [{"Guid":"g1","Name":"A"},{"Guid":"g1","Name":"B"},{"Guid":"g2","Name":"C"}]}',
      ),
    );
    expect(entries[0].issues).toEqual(['duplicate "Guid" within this file']);
    expect(entries[1].issues).toEqual(['duplicate "Guid" within this file']);
    expect(entries[2].issues).toEqual([]);
  });

  it('rejects non-object entries loudly instead of skipping them', () => {
    const entries = entriesOf(analyzeDynamicProfile('{"Profiles": ["nope", 3]}'));
    expect(entries[0]).toEqual({
      index: 0,
      guid: null,
      name: null,
      parent: null,
      issues: ['entry is not an object'],
    });
    expect(entries[1].issues).toEqual(['entry is not an object']);
  });

  it('extracts a parent ref by name', () => {
    const entries = entriesOf(
      analyzeDynamicProfile(
        '{"Profiles": [{"Guid":"g1","Name":"A","Dynamic Profile Parent Name":"Default"}]}',
      ),
    );
    expect(entries[0].parent).toEqual({ by: 'name', value: 'Default' });
  });

  it('gives "Dynamic Profile Parent GUID" precedence over the name key, per iTerm2 3.4.9+', () => {
    const entries = entriesOf(
      analyzeDynamicProfile(
        '{"Profiles": [{"Guid":"g1","Name":"A","Dynamic Profile Parent Name":"X","Dynamic Profile Parent GUID":"pg"}]}',
      ),
    );
    expect(entries[0].parent).toEqual({ by: 'guid', value: 'pg' });
  });

  it('treats non-string or empty parent keys as no parent', () => {
    const entries = entriesOf(
      analyzeDynamicProfile(
        '{"Profiles": [{"Guid":"g1","Name":"A","Dynamic Profile Parent Name":""}]}',
      ),
    );
    expect(entries[0].parent).toBeNull();
  });
});

describe('parent resolution', () => {
  const files = [
    { basename: 'a.json', analysis: analyzeDynamicProfile('{"Profiles":[{"Guid":"fg","Name":"FileProfile"}]}') },
    { basename: 'broken.json', analysis: analyzeDynamicProfile('{nope') },
  ];
  const candidates = parentCandidates([{ guid: 'ig', name: 'Default' }], files);

  it('builds the candidate universe from iTerm2 profiles plus parseable folder files', () => {
    expect(candidates).toEqual([
      { guid: 'ig', name: 'Default', source: 'iTerm2' },
      { guid: 'fg', name: 'FileProfile', source: 'a.json' },
    ]);
  });

  it('resolves by guid against guids and by name against names — never cross-matched', () => {
    expect(resolveParent({ by: 'guid', value: 'fg' }, candidates)).toMatchObject({
      state: 'resolved',
      target: { source: 'a.json' },
    });
    expect(resolveParent({ by: 'name', value: 'Default' }, candidates)).toMatchObject({
      state: 'resolved',
      target: { source: 'iTerm2' },
    });
    expect(resolveParent({ by: 'guid', value: 'Default' }, candidates).state).toBe(
      'fallback-default',
    );
  });

  it('names the unresolved consequence: iTerm2 falls back to the default profile', () => {
    expect(resolveParent({ by: 'name', value: 'Ghost' }, candidates)).toEqual({
      state: 'fallback-default',
      ref: { by: 'name', value: 'Ghost' },
    });
  });

  it('returns none for a profile with no parent keys', () => {
    expect(resolveParent(null, candidates)).toEqual({ state: 'none' });
  });
});

describe('folderBlockingFiles', () => {
  it('lists files that make iTerm2 skip the whole folder: invalid JSON and empty files', () => {
    const files = [
      { basename: 'ok.json', analysis: analyzeDynamicProfile('{"Profiles":[]}') },
      { basename: 'broken.json', analysis: analyzeDynamicProfile('{nope') },
      { basename: 'empty.json', analysis: analyzeDynamicProfile('') },
      { basename: 'shape.json', analysis: analyzeDynamicProfile('{"x":1}') },
      { basename: 'p.plist', analysis: analyzeDynamicProfile('<?xml version="1.0"?>') },
    ];
    expect(folderBlockingFiles(files)).toEqual(['broken.json', 'empty.json']);
  });
});
