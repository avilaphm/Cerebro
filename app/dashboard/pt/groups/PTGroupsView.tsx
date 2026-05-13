'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import type { PTGroup, PTClient } from '@/utils/pt/types';

interface PTGroupMember {
  group_id: string;
  client_id: string;
}

interface Props {
  groups: PTGroup[];
  members: PTGroupMember[];
  clients: Pick<PTClient, 'id' | 'name' | 'email' | 'status'>[];
}

const PRESET_COLORS = [
  '#000000', '#374151', '#7C3AED', '#2563EB', '#059669',
  '#D97706', '#DC2626', '#DB2777', '#0891B2', '#65A30D',
];

export default function PTGroupsView({ groups: initialGroups, members: initialMembers, clients }: Props) {
  const supabase = createClient();
  const [groups, setGroups] = useState(initialGroups);
  const [members, setMembers] = useState(initialMembers);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#000000');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const createGroup = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('pt_groups')
      .insert({ name: newName.trim(), color: newColor })
      .select()
      .single();
    if (!error && data) {
      setGroups((g) => [...g, data as PTGroup].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewColor('#000000');
      setShowCreate(false);
    }
    setSaving(false);
  };

  const deleteGroup = async (id: string) => {
    await supabase.from('pt_groups').delete().eq('id', id);
    setGroups((g) => g.filter((x) => x.id !== id));
    setMembers((m) => m.filter((x) => x.group_id !== id));
    if (selectedGroup === id) setSelectedGroup(null);
  };

  const toggleMember = async (groupId: string, clientId: string) => {
    const isMember = members.some((m) => m.group_id === groupId && m.client_id === clientId);
    if (isMember) {
      await supabase.from('pt_group_members').delete()
        .eq('group_id', groupId).eq('client_id', clientId);
      setMembers((m) => m.filter((x) => !(x.group_id === groupId && x.client_id === clientId)));
    } else {
      await supabase.from('pt_group_members').insert({ group_id: groupId, client_id: clientId });
      setMembers((m) => [...m, { group_id: groupId, client_id: clientId }]);
    }
    setStatus('');
  };

  const groupMembers = (groupId: string) =>
    members.filter((m) => m.group_id === groupId).map((m) => m.client_id);

  const activeGroup = groups.find((g) => g.id === selectedGroup) ?? null;
  const groupClientIds = activeGroup ? groupMembers(activeGroup.id) : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-1">PT</p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em]">Groups</h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="w-full border border-black bg-black px-5 py-3 text-sm text-white transition-colors hover:bg-white hover:text-black sm:w-auto sm:py-2.5"
        >
          + New group
        </button>
      </div>

      {showCreate && (
        <div className="mb-8 max-w-sm space-y-4 border border-black/15 p-4 sm:p-5">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">New group</p>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createGroup(); }}
              placeholder="e.g. Online clients"
              className="w-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-black/40"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-2">Colour</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${newColor === c ? 'border-black scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void createGroup()} disabled={saving || !newName.trim()}
              className="border border-black bg-black text-white px-4 py-2 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => { setShowCreate(false); setNewName(''); }}
              className="border border-black/15 px-4 py-2 text-sm hover:bg-black/5 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr] lg:gap-8">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-3">
            {groups.length} group{groups.length !== 1 ? 's' : ''}
          </p>
          {groups.length === 0 && (
            <p className="text-sm text-black/30">No groups yet.</p>
          )}
          <div className="space-y-1">
            {groups.map((g) => {
              const count = groupMembers(g.id).length;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroup(selectedGroup === g.id ? null : g.id)}
                  className={`w-full text-left px-4 py-3 border transition-colors flex items-center justify-between ${
                    selectedGroup === g.id ? 'border-black bg-black text-white' : 'border-black/10 hover:border-black/25'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                    <span className="text-sm font-medium">{g.name}</span>
                  </div>
                  <span className={`text-xs ${selectedGroup === g.id ? 'text-white/60' : 'text-black/35'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activeGroup && (
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: activeGroup.color }} />
                <p className="font-medium">{activeGroup.name}</p>
                <span className="text-xs text-black/35">{groupClientIds.length} member{groupClientIds.length !== 1 ? 's' : ''}</span>
              </div>
              <button
                onClick={() => void deleteGroup(activeGroup.id)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                Delete group
              </button>
            </div>

            {status && <p className="text-xs text-black/40 mb-3">{status}</p>}

            <div className="space-y-1">
              {clients.map((c) => {
                const isMember = groupClientIds.includes(c.id);
                return (
                  <div key={c.id} className="flex flex-col gap-3 border border-black/8 px-3 py-3 transition-colors hover:border-black/20 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                    <div className="min-w-0">
                      <Link href={`/dashboard/pt/clients/${c.id}`} className="text-sm font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-black/35">{c.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleMember(activeGroup.id, c.id)}
                      className={`text-xs px-3 py-1.5 border transition-colors ${
                        isMember
                          ? 'border-black bg-black text-white hover:bg-white hover:text-black'
                          : 'border-black/15 text-black/50 hover:border-black/35'
                      }`}
                    >
                      {isMember ? 'Remove' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!activeGroup && groups.length > 0 && (
          <div className="flex items-center justify-center text-sm text-black/30 border border-black/8 border-dashed">
            Select a group to manage members
          </div>
        )}
      </div>
    </div>
  );
}
