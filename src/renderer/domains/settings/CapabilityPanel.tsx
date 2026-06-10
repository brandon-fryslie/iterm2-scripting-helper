import { observer } from 'mobx-react-lite';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useStore } from '@/stores/context';
import { CAPABILITIES, protocolAtLeast } from './capabilities';

export const CapabilityPanel = observer(function CapabilityPanel() {
  const { connection } = useStore();
  const protocolVersion = connection.snapshot?.protocolVersion ?? '';

  return (
    <Card data-testid="settings-capability-panel">
      <CardHeader>
        <CardTitle>Capability Report</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!protocolVersion && (
          <p className="text-muted-foreground" data-testid="capability-empty">
            Connect first to populate the capability matrix.
          </p>
        )}
        {protocolVersion && (
          <table
            className="w-full text-left text-xs"
            data-testid="capability-table"
          >
            <thead className="text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium">Capability</th>
                <th className="pb-1 font-medium">Min protocol</th>
                <th className="pb-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => {
                const supported = protocolAtLeast(protocolVersion, cap.minProtocolVersion);
                return (
                  <tr
                    key={cap.id}
                    className="border-t"
                    data-testid={`capability-row-${cap.id}`}
                    data-supported={supported ? 'true' : 'false'}
                  >
                    <td className="py-1">
                      <div className="font-mono">{cap.label}</div>
                      <div className="text-muted-foreground">
                        {cap.description}
                      </div>
                    </td>
                    <td className="py-1 align-top">
                      <code>{cap.minProtocolVersion}</code>
                    </td>
                    <td className="py-1 align-top">
                      <Badge variant={supported ? 'default' : 'outline'}>
                        {supported ? 'yes' : 'no'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
});
