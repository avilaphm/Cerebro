'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

const PLATFORMS = [
  { key: 'linkedin_client_id', label: 'LinkedIn Client ID', platform: 'linkedin' },
  { key: 'linkedin_client_secret', label: 'LinkedIn Client Secret', platform: 'linkedin' },
  { key: 'twitter_api_key', label: 'X API Key', platform: 'twitter' },
  { key: 'twitter_api_secret', label: 'X API Secret', platform: 'twitter' },
  { key: 'twitter_access_token', label: 'X Access Token', platform: 'twitter' },
  { key: 'twitter_access_secret', label: 'X Access Token Secret', platform: 'twitter' },
];

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('api_keys').select('platform, key_value');
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((row: { platform: string; key_value: string }) => {
          map[row.platform] = row.key_value;
        });
        setValues(map);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    for (const p of PLATFORMS) {
      const val = values[p.key];
      if (val === undefined) continue;
      await supabase.from('api_keys').upsert(
        { platform: p.key, key_name: p.label, key_value: val, updated_at: new Date().toISOString() },
        { onConflict: 'platform' },
      );
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="p-8 max-w-xl">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Social
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-2">
        API keys
      </h1>
      <p className="text-sm font-light text-black/50 mb-10">
        Store your platform credentials here. These will be used in a future update to post directly from the dashboard.
      </p>

      <div className="space-y-4 mb-8">
        {['linkedin', 'twitter'].map((group) => (
          <div key={group}>
            <p className="text-xs font-medium tracking-wide uppercase text-black/40 mb-3">
              {group === 'linkedin' ? 'LinkedIn' : 'X (Twitter)'}
            </p>
            <div className="space-y-3">
              {PLATFORMS.filter((p) => p.platform === group).map((p) => (
                <div key={p.key}>
                  <label className="block text-xs text-black/50 mb-1">{p.label}</label>
                  <input
                    type="password"
                    value={values[p.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    placeholder="Paste key here"
                    className="w-full border border-black/20 rounded-xl px-4 py-2.5 text-sm text-black placeholder:text-black/25 focus:outline-none focus:ring-1 focus:ring-black bg-white font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-black text-white text-sm px-6 py-3 rounded-xl hover:opacity-80 transition-opacity disabled:opacity-40"
      >
        {saving ? 'Saving…' : saved ? 'Saved.' : 'Save keys'}
      </button>
    </div>
  );
}
