import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isHexColor, type FieldValue, type ProfileFieldSpec } from '@shared/profileSchema';

// One input for one profile field. Pure: it knows the spec and the current value, and reports a
// new FieldValue — it never reaches into a store. The control rendered is a total dispatch over
// the FieldValue union, so a new field kind cannot compile until it is handled here.
export function ProfileFieldControl({
  spec,
  value,
  onChange,
}: {
  spec: ProfileFieldSpec;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
}) {
  switch (value.kind) {
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value.hex}
            onChange={(e) => onChange({ ...value, hex: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded border"
            data-testid={`profile-field-${spec.key}`}
          />
          <Input
            value={value.hex}
            onChange={(e) => onChange({ ...value, hex: e.target.value })}
            aria-invalid={!isHexColor(value.hex)}
            className={`max-w-[110px] font-mono text-xs ${isHexColor(value.hex) ? '' : 'border-destructive text-destructive'}`}
            data-testid={`profile-field-${spec.key}-hex`}
          />
        </div>
      );
    case 'toggle':
      return (
        <input
          type="checkbox"
          checked={value.on}
          onChange={(e) => onChange({ ...value, on: e.target.checked })}
          className="h-4 w-4"
          data-testid={`profile-field-${spec.key}`}
        />
      );
    case 'number':
      if (spec.options) {
        return (
          <Select value={value.raw} onValueChange={(v) => onChange({ ...value, raw: v })}>
            <SelectTrigger data-testid={`profile-field-${spec.key}`} className="max-w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spec.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      return (
        <Input
          type="number"
          value={value.raw}
          onChange={(e) => onChange({ ...value, raw: e.target.value })}
          className="max-w-[140px]"
          data-testid={`profile-field-${spec.key}`}
        />
      );
    case 'text':
      if (spec.options) {
        return (
          <Select value={value.value} onValueChange={(v) => onChange({ ...value, value: v })}>
            <SelectTrigger data-testid={`profile-field-${spec.key}`} className="max-w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spec.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      return (
        <Input
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          data-testid={`profile-field-${spec.key}`}
        />
      );
  }
}
