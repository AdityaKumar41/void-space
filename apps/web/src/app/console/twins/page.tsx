'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiFetch } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

interface Device {
  id: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  twins: readonly { id: string; label: string; state: Record<string, unknown> }[];
}
export default function TwinsPage() {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['iot-devices'],
    queryFn: () => apiFetch<{ devices: Device[] }>('/iot/devices'),
  });
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const telemetry = useQuery({
    queryKey: ['iot-telemetry', selectedDevice],
    queryFn: () =>
      apiFetch<{
        telemetry: { id: string; payload: Record<string, unknown>; receivedAt: string }[];
      }>(`/iot/devices/${selectedDevice}/telemetry`),
    enabled: selectedDevice !== null,
  });
  if (query.isLoading) return <LoadingBlock label="LOADING DIGITAL TWINS" />;
  if (query.error) return <ErrorNote message={(query.error as Error).message} />;
  async function register() {
    setBusy(true);
    try {
      const response = await apiFetch<{ deviceSecret: string }>('/iot/devices', {
        method: 'POST',
        body: { label },
      });
      setSecret(response.deviceSecret);
      setLabel('');
      await cache.invalidateQueries({ queryKey: ['iot-devices'] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">IOT · DIGITAL TWIN</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Connected equipment</h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          Register equipment, store its one-time device secret securely, and use its latest signed
          telemetry as a spatial and simulation twin state.
        </p>
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold text-ink">Register device</h2>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Equipment label"
            className="min-w-0 flex-1 rounded-control border border-hairline bg-surface px-3 text-sm text-ink"
          />
          <Button disabled={busy || label.length < 3} onClick={register}>
            {busy ? 'Registering…' : 'Register'}
          </Button>
        </div>
        {secret ? (
          <div className="rounded-control border border-brand/30 bg-brand/5 p-3 text-sm text-ink">
            <p>Copy this secret now. It is never shown again.</p>
            <code className="mt-2 block break-all text-xs text-brand">{secret}</code>
          </div>
        ) : null}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.devices.map((device) => (
          <Card key={device.id} className="space-y-3 p-5">
            <div>
              <p className="font-mono text-[11px] text-brand">{device.status.toUpperCase()}</p>
              <h2 className="text-xl font-semibold text-ink">{device.label}</h2>
              <p className="mt-1 text-sm text-ink-dim">
                {device.lastSeenAt
                  ? `Last signal ${new Date(device.lastSeenAt).toLocaleString()}`
                  : 'No telemetry received yet'}
              </p>
            </div>
            {device.twins.map((twin) => (
              <pre
                key={twin.id}
                className="overflow-auto rounded-control bg-base p-3 text-xs text-ink-dim"
              >
                {twin.label}
                {'\n'}
                {JSON.stringify(twin.state, null, 2)}
              </pre>
            ))}
            <Button variant="ghost" onClick={() => setSelectedDevice(device.id)}>
              View telemetry
            </Button>
          </Card>
        ))}
        {query.data?.devices.length === 0 ? (
          <Card className="p-5 text-ink-dim">No equipment is registered in this workspace.</Card>
        ) : null}
      </div>
      {selectedDevice ? (
        <Card className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-ink">Telemetry history</h2>
            <Button variant="ghost" onClick={() => setSelectedDevice(null)}>
              Close
            </Button>
          </div>
          {telemetry.isLoading ? (
            <p className="text-sm text-ink-dim">Loading readings…</p>
          ) : telemetry.data?.telemetry.length ? (
            <div className="space-y-2">
              {telemetry.data.telemetry.map((entry) => (
                <pre
                  key={entry.id}
                  className="overflow-auto rounded-control bg-base p-3 text-xs text-ink-dim"
                >
                  {new Date(entry.receivedAt).toLocaleString()}
                  {'\n'}
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-dim">No telemetry has been received for this device.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
