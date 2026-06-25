import { observer } from 'mobx-react-lite';
import { Check, ChevronRight, CircleDot, XCircle } from 'lucide-react';
import { useStore } from '@/stores/context';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { extractPromptMarks, type PromptMark } from './screenMarks';

// [LAW:decomposition] The semantic-overlay surface for the Screen mirror: it turns the raw pixel mirror
// into a navigable list of OSC-133 prompt regions — "the Elements panel for the terminal" — beside the
// viewport. It owns none of the extraction; it maps over the marks the pure seam produces, in screen
// order, so adding a mark kind is a value handled by the exhaustive switch below, not a new branch here.
export const PromptStructureRail = observer(function PromptStructureRail() {
  const { monitor } = useStore();
  const marks = extractPromptMarks(
    monitor.prompts.prompts,
    monitor.screen.baseLine,
    monitor.screen.lines.length,
  );

  // [LAW:no-defensive-null-guards] Absence is the empty marks list (a session emitting no marks) or the
  // overlay being switched off — both render nothing, leaving the plain mirror, via the same return.
  if (!monitor.screenOverlayEnabled || marks.length === 0) return null;

  const failures = marks.filter((m) => m.kind === 'command-failed').length;

  return (
    <div
      className="flex h-full w-56 shrink-0 flex-col border-l bg-card/40"
      data-testid="prompt-overlay-rail"
    >
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
        <span className="font-medium">Prompt structure</span>
        <Badge variant="secondary">{marks.length}</Badge>
        {failures > 0 && (
          <Badge variant="destructive" data-testid="prompt-overlay-failures">
            {failures} failed
          </Badge>
        )}
      </div>
      <ol className="flex-1 overflow-auto py-1 text-xs">
        {marks.map((mark, i) => (
          <PromptMarkRow key={`${mark.bufferRow}-${i}`} mark={mark} />
        ))}
      </ol>
    </div>
  );
});

// [LAW:dataflow-not-control-flow] One row per mark, its appearance selected by the mark's kind via an
// exhaustive switch — a failed command is flagged with its exit code, a clean/pending boundary is a
// neutral divider. A new mark kind is a compile error here until handled, never a silent passthrough.
function PromptMarkRow({ mark }: { mark: PromptMark }) {
  switch (mark.kind) {
    case 'command-failed':
      return (
        <li
          className="flex items-center gap-2 border-l-2 border-l-destructive px-3 py-1"
          data-testid="prompt-mark-failed"
          data-exit={mark.exitStatus}
          title={mark.command ?? undefined}
        >
          <XCircle className="size-3 shrink-0 text-destructive" />
          <span className="flex-1 truncate font-mono text-muted-foreground">
            {mark.command ?? '—'}
          </span>
          <Badge variant="destructive">exit {mark.exitStatus}</Badge>
        </li>
      );
    case 'prompt-boundary':
      return (
        <li
          className={cn(
            'flex items-center gap-2 border-l-2 px-3 py-1',
            mark.status === 'ok' ? 'border-l-primary/60' : 'border-l-border',
          )}
          data-testid="prompt-mark-boundary"
          data-status={mark.status}
          title={mark.command ?? undefined}
        >
          {mark.status === 'ok' ? (
            <Check className="size-3 shrink-0 text-primary" />
          ) : mark.command ? (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <CircleDot className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 truncate font-mono text-muted-foreground">
            {mark.command ?? 'prompt'}
          </span>
        </li>
      );
  }
}
