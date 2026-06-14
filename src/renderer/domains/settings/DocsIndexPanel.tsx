import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildDocIndex, searchDocs } from '@shared/docs';
import type { DocEntry, DocLink, DocSource } from '@shared/docs';

// Built once: the index is pure and version-stable for a given build, so there is nothing to
// recompute per render or per keystroke.
const INDEX = buildDocIndex();

const SOURCE_LABEL: Record<DocSource, string> = {
  osc: 'OSC',
  proto: 'Proto',
  sdef: 'sdef',
  python: 'Python',
};

// A searchable cross-reference of the Python API, protobuf schema, sdef, and OSC catalog. The panel
// owns only the query string; selecting a row hands its deep-link out to the single navigator and
// is otherwise stateless — no notion of "which destination is open" lives here. [LAW:single-enforcer]
export function DocsIndexPanel({
  onSelect,
}: {
  onSelect: (link: DocLink) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo<DocEntry[]>(() => searchDocs(INDEX, query), [query]);

  return (
    <Card data-testid="docs-index">
      <CardHeader className="pb-2">
        <CardTitle>Docs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Python API, protobuf, sdef, OSC…"
          data-testid="docs-search-input"
        />
        <ul className="max-h-72 space-y-1 overflow-auto" data-testid="docs-results">
          {results.map((entry) => (
            <li key={entry.id}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 py-2 text-left"
                onClick={() => onSelect(entry.link)}
                data-testid={`docs-result-${entry.id}`}
              >
                <Badge variant="outline" className="shrink-0">
                  {SOURCE_LABEL[entry.source]}
                </Badge>
                <span className="flex flex-col">
                  <span className="font-medium">{entry.title}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {entry.subtitle}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
