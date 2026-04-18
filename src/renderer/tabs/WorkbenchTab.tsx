import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function WorkbenchTab() {
  return (
    <Card data-testid="tab-workbench-placeholder">
      <CardHeader>
        <CardTitle>Workbench</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Authoring surface for profiles, triggers, status bar components, RPCs, and more. Arrives in M5+.
      </CardContent>
    </Card>
  );
}
