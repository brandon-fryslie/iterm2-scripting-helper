import type { FieldValue } from '@shared/profileSchema';
import { FIELD_BY_KEY } from '@shared/profileSchema';

// A live swatch of the pending profile: a sample terminal painted with the edited colors, font,
// transparency, and badge. Pure — it derives entirely from the edit record, so it tracks edits
// the instant they happen. It reads the handful of keys that have a visual meaning; everything
// else in the profile has no rendering and is intentionally not shown here.

function value(edit: Record<string, FieldValue>, key: string): FieldValue | undefined {
  return edit[key] ?? FIELD_BY_KEY.get(key)?.default;
}

function hex(edit: Record<string, FieldValue>, key: string, fallback: string): string {
  const v = value(edit, key);
  return v && v.kind === 'color' ? v.hex : fallback;
}

function text(edit: Record<string, FieldValue>, key: string, fallback: string): string {
  const v = value(edit, key);
  return v && v.kind === 'text' ? v.value : fallback;
}

function num(edit: Record<string, FieldValue>, key: string, fallback: number): number {
  const v = value(edit, key);
  if (v && v.kind === 'number') {
    const n = Number(v.raw);
    return Number.isNaN(n) ? fallback : n;
  }
  return fallback;
}

// iTerm2 stores fonts as "Family Name <size>" (the trailing token is the point size).
function parseFont(s: string): { family: string; size: number } {
  const parts = s.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  const size = Number(last);
  if (parts.length > 1 && !Number.isNaN(size)) {
    return { family: parts.slice(0, -1).join(' '), size };
  }
  return { family: s || 'Monaco', size: 12 };
}

const ANSI_KEYS = Array.from({ length: 16 }, (_, i) => `Ansi ${i} Color`);

export function ProfilePreview({ edit }: { edit: Record<string, FieldValue> }) {
  const bg = hex(edit, 'Background Color', '#000000');
  const fg = hex(edit, 'Foreground Color', '#ffffff');
  const cursor = hex(edit, 'Cursor Color', fg);
  const badge = text(edit, 'Badge Text', '');
  const font = parseFont(text(edit, 'Normal Font', 'Monaco 12'));
  const transparency = Math.max(0, Math.min(1, num(edit, 'Transparency', 0)));

  return (
    <div className="grid gap-2" data-testid="profile-preview">
      <span className="text-xs text-muted-foreground">Live preview</span>
      <div className="relative overflow-hidden rounded-md border bg-[repeating-conic-gradient(#80808022_0deg_90deg,transparent_90deg_180deg)] bg-[length:16px_16px]">
        <div
          className="relative p-3"
          style={{
            backgroundColor: bg,
            color: fg,
            opacity: 1 - transparency,
            fontFamily: `${font.family}, ui-monospace, monospace`,
            fontSize: `${Math.max(8, Math.min(24, font.size))}px`,
            lineHeight: 1.5,
          }}
        >
          <div>
            <span style={{ color: hex(edit, 'Ansi 2 Color', '#00c200') }}>user@host</span>
            <span>:</span>
            <span style={{ color: hex(edit, 'Ansi 4 Color', '#2744c7') }}>~/code</span>
            <span>$ echo sample</span>
          </div>
          <div>sample</div>
          <div className="flex items-center">
            <span>$&nbsp;</span>
            <span style={{ backgroundColor: cursor, width: '0.6em', height: '1.1em' }} />
          </div>
          <div className="mt-2 flex gap-[2px]">
            {ANSI_KEYS.map((k) => (
              <span
                key={k}
                title={k}
                className="h-3 w-3 rounded-[2px]"
                style={{ backgroundColor: hex(edit, k, '#888888') }}
              />
            ))}
          </div>
          {badge && (
            <div
              className="absolute right-2 top-2 text-right text-[10px] font-semibold uppercase opacity-60"
              style={{ color: hex(edit, 'Badge Color', '#ff2600') }}
            >
              {badge}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
