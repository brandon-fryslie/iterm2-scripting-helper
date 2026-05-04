import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MonitorTab } from '@/tabs/MonitorTab';
import { WorkbenchTab } from '@/tabs/WorkbenchTab';
import { ConsoleTab } from '@/tabs/ConsoleTab';
import { SettingsTab } from '@/tabs/SettingsTab';

const TABS = [
  { value: 'monitor', label: 'Monitor', Component: MonitorTab },
  { value: 'workbench', label: 'Workbench', Component: WorkbenchTab },
  { value: 'console', label: 'Console', Component: ConsoleTab },
  { value: 'settings', label: 'Settings', Component: SettingsTab },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const STORAGE_KEY = 'active-tab';
const VALID_TABS = new Set<string>(TABS.map((t) => t.value));

function loadTab(): TabValue {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && VALID_TABS.has(stored)) return stored as TabValue;
  return 'monitor';
}

export function AppShell() {
  const [tab, setTab] = useState<TabValue>(loadTab);

  return (
    <div className="flex min-h-screen flex-col">
      <Tabs value={tab} onValueChange={(v) => { setTab(v as TabValue); localStorage.setItem(STORAGE_KEY, v); }} className="flex flex-1 flex-col">
        <header className="border-b px-4 py-2">
          <TabsList>
            {TABS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value} data-testid={`tab-trigger-${value}`}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </header>
        <main className="flex-1 overflow-auto p-6">
          {TABS.map(({ value, Component }) => (
            <TabsContent key={value} value={value} className="m-0">
              <Component />
            </TabsContent>
          ))}
        </main>
      </Tabs>
    </div>
  );
}
