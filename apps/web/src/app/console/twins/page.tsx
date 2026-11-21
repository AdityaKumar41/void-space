'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { RequirePermission } from '../../../components/permission-gate';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

interface Device {
  id: string;
  label: string;
  status: string;
  lastSeenAt: string | null;
  twins: readonly { id: string; label: string; state: Record<string, unknown> }[];
}
export default function TwinsPage() {
  return (
    <RequirePermission permission="iot:manage">
      <ConnectedEquipment />
    </RequirePermission>
  );
}
function ConnectedEquipment() {
  const cache = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ['iot-devices'],
    queryFn: () => apiFetch<{ devices: Device[] }>('/iot/devices'),
    refetchInterval: 10_000,
  });
  const [label, setLabel] = useState('');
  const [credentials, setCredentials] = useState<{ id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twinDevice, setTwinDevice] = useState('');
  const [twinLabel, setTwinLabel] = useState('');
  const [assetId, setAssetId] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const assets = useQuery({
    queryKey: ['twin-approved-assets'],
    queryFn: () => apiFetch<{ assets: { id: string; name: string }[] }>('/lessons/assets'),
  });
  const telemetry = useQuery({
    queryKey: ['iot-telemetry', selectedDevice],
    queryFn: () =>
      apiFetch<{
        telemetry: { id: string; payload: Record<string, unknown>; receivedAt: string }[];
      }>(`/iot/devices/${selectedDevice}/telemetry`),
    enabled: selectedDevice !== null,
    refetchInterval: 5_000,
  });
  if (query.isLoading) return <LoadingBlock label="Loading connected equipment" />;
  if (query.error) return <ErrorNote message={(query.error as Error).message} />;
  async function register() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ device: { id: string }; deviceSecret: string }>(
        '/iot/devices',
        { method: 'POST', body: { label } },
      );
      setCredentials({ id: response.device.id, secret: response.deviceSecret });
      setTwinDevice(response.device.id);
      setLabel('');
      await cache.invalidateQueries({ queryKey: ['iot-devices'] });
      toast.success('Device registered', 'Save the device ID and secret shown below.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createTwin() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/iot/twins', {
        method: 'POST',
        body: { deviceId: twinDevice, label: twinLabel, ...(assetId ? { assetId } : {}) },
      });
      setTwinLabel('');
      setAssetId('');
      await cache.invalidateQueries({ queryKey: ['iot-devices'] });
      toast.success('Digital twin created', 'New device readings will update its state.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copyCredentials() {
    try {
      if (!credentials) return;
      await navigator.clipboard.writeText(
        JSON.stringify({ deviceId: credentials.id, deviceSecret: credentials.secret }, null, 2),
      );
      toast.success('Device credentials copied');
    } catch {
      toast.failure('Clipboard unavailable', 'Select and copy the device ID and secret below.');
    }
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Digital twins</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Connected equipment</h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          Register equipment, save its device credentials and create a twin. Authenticated device
          readings update the twin state automatically.
        </p>
      </header>
      {error ? <ErrorNote message={error} /> : null}
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">Register device</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <label className="min-w-0 flex-1 text-sm text-ink">
            Equipment label
            <input
              required
              minLength={3}
              maxLength={160}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <Button type="submit" disabled={busy || label.trim().length < 3}>
            {busy ? 'Saving…' : 'Register'}
          </Button>
        </form>
        {credentials ? (
          <div className="space-y-2 rounded-control border border-brand/30 bg-brand/5 p-3 text-sm text-ink">
            <p>Save these credentials now. The secret is never shown again.</p>
            <p className="break-all">
              Device ID: <code>{credentials.id}</code>
            </p>
            <p className="break-all">
              Device secret: <code>{credentials.secret}</code>
            </p>
            <Button size="sm" onClick={() => void copyCredentials()}>
              Copy device credentials
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCredentials(null)}>
              Hide credentials
            </Button>
          </div>
        ) : null}
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-ink">Create a digital twin</h2>
        <p className="text-sm text-ink-dim">
          A twin stores the latest readings for a device. Attach an approved model when one is
          available.
        </p>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createTwin();
          }}
        >
          <label className="min-w-0 text-sm text-ink">
            Device
            <select
              required
              value={twinDevice}
              onChange={(e) => setTwinDevice(e.target.value)}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">Choose registered equipment</option>
              {query.data?.devices
                .filter((d) => d.status === 'active')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm text-ink">
            Twin label
            <input
              required
              minLength={3}
              maxLength={160}
              value={twinLabel}
              onChange={(e) => setTwinLabel(e.target.value)}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="min-w-0 text-sm text-ink">
            Approved model (optional)
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="">No model attached</option>
              {assets.data?.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !twinDevice || twinLabel.trim().length < 3}>
              Create twin
            </Button>
          </div>
        </form>
        {assets.error ? (
          <ErrorNote
            message={`Model choices unavailable: ${(assets.error as Error).message}. You can still create a twin without a model.`}
          />
        ) : null}
      </Card>
      <details className="rounded-card border border-hairline p-5">
        <summary className="cursor-pointer font-semibold text-ink">
          Connect equipment and send readings
        </summary>
        <p className="mt-3 text-sm text-ink-dim">
          Send a POST request to /api/v1/iot/telemetry with a JSON body such as{' '}
          {JSON.stringify({ payload: { temperature: 24 } })}. Supply x-device-id and x-device-secret
          headers, plus a workspace API access token with iot:manage permission as Authorization:
          Bearer &lt;token&gt;. Developer settings lets workspace administrators create API keys and
          exchange them for access tokens.
        </p>
        <p className="mt-2 text-sm text-ink-dim">
          Readings and twins refresh automatically while this page is open.
        </p>
      </details>
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.devices.map((device) => (
          <Card key={device.id} className="min-w-0 space-y-3 p-5">
            <div>
              <p className="font-mono text-[11px] text-brand">{device.status.toUpperCase()}</p>
              <h2 className="break-words text-xl font-semibold text-ink">{device.label}</h2>
              <p className="mt-1 break-all font-mono text-xs text-ink-faint">{device.id}</p>
              <p className="mt-1 text-sm text-ink-dim">
                {device.lastSeenAt
                  ? `Last signal ${new Date(device.lastSeenAt).toLocaleString()}`
                  : 'No telemetry received yet'}
              </p>
            </div>
            {device.twins.map((twin) => (
              <div key={twin.id}>
                <h3 className="text-sm font-semibold text-ink">{twin.label}</h3>
                <pre className="mt-1 max-h-64 overflow-auto rounded-control bg-base p-3 text-xs text-ink-dim">
                  {JSON.stringify(twin.state, null, 2)}
                </pre>
              </div>
            ))}
            {!device.twins.length ? (
              <p className="text-sm text-ink-dim">
                Create a twin above to track this device’s latest state.
              </p>
            ) : null}
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
        <Card className="min-w-0 space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-ink">
              Telemetry history · {query.data?.devices.find((d) => d.id === selectedDevice)?.label}
            </h2>
            <Button variant="ghost" onClick={() => setSelectedDevice(null)}>
              Close
            </Button>
          </div>
          {telemetry.isLoading ? (
            <LoadingBlock label="Loading readings" />
          ) : telemetry.error ? (
            <ErrorNote message={(telemetry.error as Error).message} />
          ) : telemetry.data?.telemetry.length ? (
            <div className="space-y-2">
              {telemetry.data.telemetry.map((entry) => (
                <pre
                  key={entry.id}
                  className="max-h-64 overflow-auto rounded-control bg-base p-3 text-xs text-ink-dim"
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
