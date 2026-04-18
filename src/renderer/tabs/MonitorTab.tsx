import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function MonitorTab() {
  return (
    <Card data-testid="tab-monitor-placeholder">
      <CardHeader>
        <CardTitle>Monitor</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Live observatory: layout tree, variables, notifications, wire log. Arrives in M2.
      </CardContent>
    </Card>
  );
}
