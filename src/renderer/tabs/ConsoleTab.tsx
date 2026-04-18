import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function ConsoleTab() {
  return (
    <Card data-testid="tab-console-placeholder">
      <CardHeader>
        <CardTitle>Console</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Interactive driver for send/inject/activate/escape actions. Arrives in M4.
      </CardContent>
    </Card>
  );
}
