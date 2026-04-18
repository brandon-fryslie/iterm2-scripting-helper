import { observer } from 'mobx-react-lite';
import { Button } from '@/components/ui/button';
import { useStore } from '@/stores/context';
import { cn } from '@/lib/utils';

const DIRECTIONS: Array<'all' | 'out' | 'in'> = ['all', 'out', 'in'];

export const WirePane = observer(function WirePane() {
  const { monitor } = useStore();
  const entries = monitor.filteredWire;
  const totalSeen = monitor.wire.totalSeen;

  return (
    <div className="flex h-full flex-col" data-testid="wire-pane">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground">{totalSeen} frame(s) seen</span>
        <span className="ml-auto" />
        {DIRECTIONS.map((d) => (
          <Button
            key={d}
            size="sm"
            variant={monitor.wireDirectionFilter === d ? 'default' : 'outline'}
            onClick={() => monitor.setWireDirectionFilter(d)}
            data-testid={`wire-filter-${d}`}
          >
            {d}
          </Button>
        ))}
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No frames yet — Connect first.
          </div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">#</th>
                <th className="px-3 py-1 font-medium">Dir</th>
                <th className="px-3 py-1 font-medium">Kind</th>
                <th className="px-3 py-1 font-medium">Id</th>
                <th className="px-3 py-1 font-medium">Size</th>
                <th className="px-3 py-1 font-medium">At</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(-200).reverse().map((e) => (
                <tr
                  key={e.seq}
                  className="border-t"
                  data-testid={`wire-entry-${e.seq}`}
                >
                  <td className="px-3 py-1 text-muted-foreground">{e.seq}</td>
                  <td
                    className={cn(
                      'px-3 py-1',
                      e.direction === 'out' ? 'text-blue-500' : 'text-green-600',
                    )}
                  >
                    {e.direction === 'out' ? '→' : '←'}
                  </td>
                  <td className="px-3 py-1">{e.kind}</td>
                  <td className="px-3 py-1 text-muted-foreground">{e.id}</td>
                  <td className="px-3 py-1 text-muted-foreground">{e.size} B</td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {new Date(e.at).toISOString().slice(11, 23)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
