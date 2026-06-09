// [LAW:decomposition] One titled, bordered region. The shell's panels are cut by facet; this is the
// shared frame each facet sits in, so region chrome lives in one place, not copied per facet.
export function FacetFrame({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded border" data-testid={testId}>
      <div className="border-b bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide">
        {title}
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
