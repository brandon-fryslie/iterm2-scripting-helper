// [LAW:single-enforcer] The one localStorage boundary for the renderer's persisted authoring state.
// Every store that mirrors in-memory state to disk (Console snippets/forms, the probe draft, the
// template draft) routes through this seam instead of minting its own getItem/setItem — so "where the
// persistence home is" and "how a versioned blob is encoded" are decided in exactly one place.
//
// [LAW:one-source-of-truth] The in-memory store is always the runtime authority; a cell is the derived
// mirror, synchronized by a boundary reaction in the owning store. A cell never holds state of its own.

// [LAW:no-silent-failure] Whether a persistence home exists is a typed environment condition, not an
// exception to swallow: outside a renderer (node unit env, SSR) there is no window/localStorage, and
// that absence is the one legitimate no-op. A genuine localStorage fault in a real renderer (quota,
// disabled storage) is NOT caught here — it surfaces rather than masquerading as a successful persist.
// (Electron renderers always expose localStorage, so the absent case is exactly the test/SSR env.)
export function hasPersistence(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

// [LAW:types-are-the-program] The on-disk shape is a version tag wrapping the domain value. The version
// is the shape contract: it is bumped whenever a cell's `T` changes, so a blob written by older code is
// recognized as a different shape and dropped loudly rather than coerced into the current type.
interface Envelope {
  version: number;
  data: unknown;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof (value as { version: unknown }).version === 'number' &&
    'data' in value
  );
}

// [LAW:effects-at-boundaries] A cell is the pure description of one persisted value's identity (its key,
// its version, how to validate it, what to fall back to). `load`/`save` are the only two effects, and a
// store fires `save` from a reaction rather than from inside its setters.
export interface VersionedCell<T> {
  load(): T;
  save(value: T): void;
}

// [LAW:types-are-the-program] `decode` is the single typed gate that turns the envelope's `unknown` data
// into a `T`. It returns `null` for any payload that is structurally wrong (corrupt, hand-edited), which
// — like a parse failure or a version mismatch — degrades loudly to the fallback. The version guarantees
// the SHAPE within a build; `decode` guards the boundary against corruption the version cannot see.
export function versionedCell<T>(spec: {
  key: string;
  version: number;
  fallback: () => T;
  decode: (data: unknown) => T | null;
}): VersionedCell<T> {
  const { key, version, fallback, decode } = spec;

  function load(): T {
    if (!hasPersistence()) return fallback();
    const raw = window.localStorage.getItem(key);
    // Absent is first-run, not corruption: the calm default, no warning.
    if (raw === null) return fallback();

    // [LAW:no-silent-failure] Every way the stored value can be wrong degrades the SAME way — a loud
    // warning plus the fallback — so a stale or hand-mangled blob can never silently deserialize into
    // garbage the rest of the app then trusts.
    const drop = (why: string): T => {
      console.warn(`[persistence] ${key}: ${why}; dropping persisted value and using the default.`);
      return fallback();
    };

    // The try wraps ONLY the parse of stored data — the one place corrupt input legitimately throws and
    // the ticket wants drop+warn. A getItem that throws (storage disabled mid-session) is a real fault
    // left to surface above, not classified here.
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return drop('persisted value is not valid JSON');
    }
    if (!isEnvelope(envelope)) return drop('persisted value is not a versioned envelope');
    if (envelope.version !== version) {
      return drop(`persisted at schema version ${envelope.version}, code expects ${version}`);
    }
    const decoded = decode(envelope.data);
    if (decoded === null) return drop(`persisted payload failed validation at version ${version}`);
    return decoded;
  }

  function save(value: T): void {
    if (!hasPersistence()) return;
    const envelope: Envelope = { version, data: value };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  }

  return { load, save };
}
