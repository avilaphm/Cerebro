'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface MetricDraft {
  measured_at: string;
  weight_kg: string;
  waist_cm: string;
  body_fat_pct: string;
  muscle_mass_kg: string;
  notes: string;
}

interface LatestMetric {
  id: string;
  measured_at: string;
  weight_kg: number | null;
  waist_cm: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
}

interface ProfileDraft {
  name: string;
  last_name: string;
  phone: string;
  gender: string;
  date_of_birth: string;
}

function toNullableNumber(value: string) {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMetric(value: number | null, suffix: string) {
  return value != null ? `${value}${suffix}` : '--';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
  clientId: string;
  userEmail: string;
}

export default function SettingsTab({ clientId, userEmail }: Props) {
  const supabase = useMemo(() => createClient(), []);

  // Profile
  const [profile, setProfile] = useState<ProfileDraft>({
    name: '', last_name: '', phone: '', gender: '', date_of_birth: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Password
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Body metrics
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [metricDraft, setMetricDraft] = useState<MetricDraft>({
    measured_at: todayValue(),
    weight_kg: '', waist_cm: '', body_fat_pct: '', muscle_mass_kg: '', notes: '',
  });
  const [latestMetric, setLatestMetric] = useState<LatestMetric | null>(null);
  const [metricSaving, setMetricSaving] = useState(false);
  const [metricMsg, setMetricMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Email notifications
  const [wrapUpEmail, setWrapUpEmail] = useState(true);
  const [wrapUpSaving, setWrapUpSaving] = useState(false);
  const [wrapUpMsg, setWrapUpMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const profileMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pwMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metricMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapUpMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (profileMsgTimer.current) clearTimeout(profileMsgTimer.current);
    if (pwMsgTimer.current) clearTimeout(pwMsgTimer.current);
    if (metricMsgTimer.current) clearTimeout(metricMsgTimer.current);
    if (wrapUpMsgTimer.current) clearTimeout(wrapUpMsgTimer.current);
  }, []);

  useEffect(() => {
    void (async () => {
      const [clientRes, metricRes] = await Promise.all([
        supabase.from('pt_clients')
          .select('name, last_name, phone, gender, date_of_birth, receive_weekly_wrap_up_email')
          .eq('id', clientId).single(),
        supabase.from('pt_client_metrics')
          .select('id, measured_at, weight_kg, waist_cm, body_fat_pct, muscle_mass_kg')
          .eq('client_id', clientId)
          .order('measured_at', { ascending: false })
          .limit(1),
      ]);
      if (clientRes.data) {
        const d = clientRes.data as { name: string | null; last_name: string | null; phone: string | null; gender: string | null; date_of_birth: string | null; receive_weekly_wrap_up_email: boolean | null };
        setProfile({
          name: d.name ?? '',
          last_name: d.last_name ?? '',
          phone: d.phone ?? '',
          gender: d.gender ?? '',
          date_of_birth: d.date_of_birth ?? '',
        });
        setWrapUpEmail(d.receive_weekly_wrap_up_email ?? true);
      }
      const metrics = (metricRes.data ?? []) as LatestMetric[];
      setLatestMetric(metrics[0] ?? null);
    })();
  }, [clientId, supabase]);

  const flashMsg = (
    setter: (v: { ok: boolean; text: string } | null) => void,
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    msg: { ok: boolean; text: string },
  ) => {
    setter(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setter(null), 4000);
  };

  const saveProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    const { error } = await supabase
      .from('pt_clients')
      .update({
        name: profile.name.trim() || null,
        last_name: profile.last_name.trim() || null,
        phone: profile.phone.trim() || null,
        gender: profile.gender || null,
        date_of_birth: profile.date_of_birth || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    setProfileSaving(false);
    flashMsg(setProfileMsg, profileMsgTimer, error
      ? { ok: false, text: error.message }
      : { ok: true, text: 'Profile updated.' });
  };

  const changePassword = async () => {
    if (pwSaving) return;
    if (!pwCurrent.trim()) { flashMsg(setPwMsg, pwMsgTimer, { ok: false, text: 'Enter your current password.' }); return; }
    if (pwNew.length < 8) { flashMsg(setPwMsg, pwMsgTimer, { ok: false, text: 'New password must be at least 8 characters.' }); return; }
    if (pwNew !== pwConfirm) { flashMsg(setPwMsg, pwMsgTimer, { ok: false, text: 'Passwords do not match.' }); return; }

    setPwSaving(true);
    // Re-verify current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: pwCurrent,
    });
    if (signInError) {
      setPwSaving(false);
      flashMsg(setPwMsg, pwMsgTimer, { ok: false, text: 'Current password is incorrect.' });
      return;
    }
    // Update password
    const { error: updateError } = await supabase.auth.updateUser({ password: pwNew });
    setPwSaving(false);
    if (updateError) {
      flashMsg(setPwMsg, pwMsgTimer, { ok: false, text: updateError.message });
    } else {
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      flashMsg(setPwMsg, pwMsgTimer, { ok: true, text: 'Password updated. A confirmation has been sent to your email.' });
    }
  };

  const sendResetEmail = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
      redirectTo: `${window.location.origin}/client`,
    });
    flashMsg(setPwMsg, pwMsgTimer, error
      ? { ok: false, text: error.message }
      : { ok: true, text: `Reset link sent to ${userEmail}.` });
  };

  const saveMetric = async () => {
    if (metricSaving) return;
    const hasValue = [metricDraft.weight_kg, metricDraft.waist_cm, metricDraft.body_fat_pct, metricDraft.muscle_mass_kg, metricDraft.notes].some((v) => v.trim());
    if (!hasValue) { flashMsg(setMetricMsg, metricMsgTimer, { ok: false, text: 'Add at least one value.' }); return; }

    setMetricSaving(true);
    const { data, error } = await supabase
      .from('pt_client_metrics')
      .insert({
        client_id: clientId,
        measured_at: metricDraft.measured_at,
        weight_kg: toNullableNumber(metricDraft.weight_kg),
        waist_cm: toNullableNumber(metricDraft.waist_cm),
        body_fat_pct: toNullableNumber(metricDraft.body_fat_pct),
        muscle_mass_kg: toNullableNumber(metricDraft.muscle_mass_kg),
        source: 'client',
        notes: metricDraft.notes.trim() || null,
      })
      .select('id, measured_at, weight_kg, waist_cm, body_fat_pct, muscle_mass_kg')
      .single();

    if (error || !data) {
      setMetricSaving(false);
      flashMsg(setMetricMsg, metricMsgTimer, { ok: false, text: error?.message ?? 'Could not save.' });
      return;
    }

    const saved = data as LatestMetric;
    setLatestMetric(saved);
    setMetricDraft({ measured_at: todayValue(), weight_kg: '', waist_cm: '', body_fat_pct: '', muscle_mass_kg: '', notes: '' });

    const details = [
      saved.weight_kg != null ? `Weight ${saved.weight_kg}kg` : null,
      saved.waist_cm != null ? `Waist ${saved.waist_cm}cm` : null,
      saved.body_fat_pct != null ? `Body fat ${saved.body_fat_pct}%` : null,
      saved.muscle_mass_kg != null ? `Muscle ${saved.muscle_mass_kg}kg` : null,
    ].filter(Boolean).join(' / ');

    void supabase.from('pt_coaching_tasks').insert({
      client_id: clientId,
      source_type: 'metric_update',
      source_id: saved.id,
      title: 'Review body metrics',
      details: details || 'Metric update submitted.',
    });

    setMetricSaving(false);
    flashMsg(setMetricMsg, metricMsgTimer, { ok: true, text: 'Metrics saved.' });
  };

  const saveWrapUpPref = async (next: boolean) => {
    if (wrapUpSaving) return;
    const prev = wrapUpEmail;
    setWrapUpEmail(next);
    setWrapUpSaving(true);
    const { error } = await supabase
      .from('pt_clients')
      .update({ receive_weekly_wrap_up_email: next, updated_at: new Date().toISOString() })
      .eq('id', clientId);
    setWrapUpSaving(false);
    if (error) {
      setWrapUpEmail(prev);
      flashMsg(setWrapUpMsg, wrapUpMsgTimer, { ok: false, text: error.message });
    } else {
      flashMsg(setWrapUpMsg, wrapUpMsgTimer, { ok: true, text: next ? 'Weekly wrap-up emails are on.' : 'Weekly wrap-up emails are off.' });
    }
  };

  const inputCls = 'w-full border border-black/10 bg-white px-3 py-3 text-sm outline-none focus:border-black/35 transition-colors';
  const labelCls = 'block text-[0.62rem] uppercase tracking-[0.13em] text-black/40 mb-1';

  return (
    <div className="mx-auto max-w-xl space-y-4">

      {/* Profile */}
      <section className="border border-black/10 bg-white p-5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Profile</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>First name</label>
            <input className={inputCls} value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} placeholder="First name" />
          </div>
          <div>
            <label className={labelCls}>Last name</label>
            <input className={inputCls} value={profile.last_name} onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))} placeholder="Last name" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Mobile</label>
            <input className={inputCls} type="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} placeholder="+61 4xx xxx xxx" />
          </div>
          <div>
            <label className={labelCls}>Gender</label>
            <select className={inputCls} value={profile.gender} onChange={(e) => setProfile((p) => ({ ...p, gender: e.target.value }))}>
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non_binary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Date of birth</label>
            <input className={inputCls} type="date" value={profile.date_of_birth} onChange={(e) => setProfile((p) => ({ ...p, date_of_birth: e.target.value }))} />
          </div>
        </div>
        {profileMsg && (
          <p className={`mt-3 text-xs ${profileMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{profileMsg.text}</p>
        )}
        <button type="button" onClick={() => void saveProfile()} disabled={profileSaving}
          className="mt-4 w-full border border-black bg-black py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40 transition-colors">
          {profileSaving ? 'Saving...' : 'Save profile'}
        </button>
      </section>

      {/* Change Password */}
      <section className="border border-black/10 bg-white p-5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Change Password</p>
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls}>Current password</label>
            <input className={inputCls} type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" />
          </div>
          <div>
            <label className={labelCls}>New password</label>
            <input className={inputCls} type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          </div>
          <div>
            <label className={labelCls}>Confirm new password</label>
            <input className={inputCls} type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
          </div>
        </div>
        {pwMsg && (
          <p className={`mt-3 text-xs ${pwMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{pwMsg.text}</p>
        )}
        <div className="mt-4 space-y-2">
          <button type="button" onClick={() => void changePassword()} disabled={pwSaving}
            className="w-full border border-black bg-black py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40 transition-colors">
            {pwSaving ? 'Updating...' : 'Update password'}
          </button>
          <button type="button" onClick={() => void sendResetEmail()}
            className="w-full border border-black/10 py-3 text-sm text-black/50 hover:text-black transition-colors">
            Send password reset email
          </button>
        </div>
      </section>

      {/* Body Metrics (collapsible) */}
      <section className="border border-black/10 bg-white">
        <button
          type="button"
          onClick={() => setMetricsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Body Metrics</p>
          {metricsOpen
            ? <ChevronUp className="h-4 w-4 text-black/30" />
            : <ChevronDown className="h-4 w-4 text-black/30" />}
        </button>

        {metricsOpen && (
          <div className="border-t border-black/8 px-5 pb-5">
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input type="date" value={metricDraft.measured_at}
                onChange={(e) => setMetricDraft((d) => ({ ...d, measured_at: e.target.value }))}
                className={`col-span-2 ${inputCls}`} />
              <input value={metricDraft.weight_kg} inputMode="decimal" placeholder="Weight kg"
                onChange={(e) => setMetricDraft((d) => ({ ...d, weight_kg: e.target.value }))}
                className={inputCls} />
              <input value={metricDraft.waist_cm} inputMode="decimal" placeholder="Waist cm"
                onChange={(e) => setMetricDraft((d) => ({ ...d, waist_cm: e.target.value }))}
                className={inputCls} />
              <input value={metricDraft.body_fat_pct} inputMode="decimal" placeholder="Body fat %"
                onChange={(e) => setMetricDraft((d) => ({ ...d, body_fat_pct: e.target.value }))}
                className={inputCls} />
              <input value={metricDraft.muscle_mass_kg} inputMode="decimal" placeholder="Muscle kg"
                onChange={(e) => setMetricDraft((d) => ({ ...d, muscle_mass_kg: e.target.value }))}
                className={inputCls} />
              <textarea value={metricDraft.notes} rows={2} placeholder="Notes or context"
                onChange={(e) => setMetricDraft((d) => ({ ...d, notes: e.target.value }))}
                className={`col-span-2 resize-none ${inputCls}`} />
            </div>
            {metricMsg && (
              <p className={`mt-2 text-xs ${metricMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{metricMsg.text}</p>
            )}
            <button type="button" onClick={() => void saveMetric()} disabled={metricSaving}
              className="mt-3 w-full border border-black bg-black py-3 text-sm text-white hover:bg-white hover:text-black disabled:opacity-40 transition-colors">
              {metricSaving ? 'Saving...' : 'Save metrics'}
            </button>
            {latestMetric && (
              <div className="mt-3 border-t border-black/8 pt-3">
                <p className="text-xs text-black/35">Latest: {formatDate(latestMetric.measured_at)}</p>
                <p className="mt-1 text-xs text-black/55">
                  {formatMetric(latestMetric.weight_kg, 'kg')} · {formatMetric(latestMetric.waist_cm, 'cm')} · {formatMetric(latestMetric.body_fat_pct, '%')}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Email notifications */}
      <section className="border border-black/10 bg-white p-5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-black/35">Email notifications</p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Weekly wrap-up</p>
            <p className="mt-0.5 text-xs text-black/45">Your training &amp; nutrition recap, every Sunday morning.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wrapUpEmail}
            disabled={wrapUpSaving}
            onClick={() => void saveWrapUpPref(!wrapUpEmail)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${wrapUpEmail ? 'bg-black' : 'bg-black/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${wrapUpEmail ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </div>
        {wrapUpMsg && (
          <p className={`mt-3 text-xs ${wrapUpMsg.ok ? 'text-green-600' : 'text-red-500'}`}>{wrapUpMsg.text}</p>
        )}
      </section>

    </div>
  );
}
