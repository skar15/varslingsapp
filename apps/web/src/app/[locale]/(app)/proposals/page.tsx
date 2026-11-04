'use client';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@varsling/shared';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useLocale, useT } from '@/lib/i18n';
import { useMe, useProposals, useUsers } from '@/lib/queries';

export default function ProposalsPage() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const me = useMe();
  const proposals = useProposals();
  const users = useUsers();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [removeId, setRemoveId] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!proposals.data || !me.data) return <main><p>{t('common.loading')}</p></main>;
  const role = me.data.user.effective_role;
  const refresh = () => qc.invalidateQueries({ queryKey: ['proposals'] });
  const decide = async (id: string, action: 'approve' | 'reject') => {
    setError(null);
    try {
      const path = action === 'approve' ? '/v1/proposals/{id}/approve' : '/v1/proposals/{id}/reject';
      await unwrap(api.POST(path, { params: { path: { id } }, body: { note: notes[id] || undefined } }));
      await refresh();
      await qc.invalidateQueries({ queryKey: ['objects'] });
    } catch (err) {
      setError(t(errorKey(err)));
    }
  };

  return (
    <main className="stack">
      <h1>{t('proposals.title')}</h1>
      {role !== 'owner' && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>{t('proposals.compose')}</h2>
          {role === 'member' && <a className="btn" href={`/${locale}/objects/new`}>{t('proposals.kind.object_create')}</a>}
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            if (!removeId) return;
            await unwrap(api.POST('/v1/proposals', { body: { kind: 'user_remove', target_id: removeId, payload: {} } }));
            setRemoveId('');
            await refresh();
          }}>
            <select value={removeId} onChange={(e) => setRemoveId(e.target.value)} style={{ width: 'auto' }} aria-label={t('proposals.kind.user_remove')}>
              <option value="">{t('proposals.kind.user_remove')}</option>
              {users.data?.items.filter((u) => u.role !== 'owner' && u.id !== me.data.user.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn" type="submit" disabled={!removeId}>{t('proposals.compose')}</button>
          </form>
        </section>
      )}
      {proposals.data.items.length === 0 && <p className="muted">{t('proposals.empty')}</p>}
      {proposals.data.items.map((p) => (
        <div key={p.id} className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{t(`proposals.kind.${p.kind}`)}</strong>
            <span className="badge">{t(`proposals.status.${p.status}`)}</span>
          </div>
          <span className="muted">{p.proposer.name} · {formatDateTime(p.created_at, locale)}</span>
          {p.message && <p style={{ margin: 0 }}>{p.message}</p>}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: 0 }}>{JSON.stringify(p.payload, (k, v) => (k === 'geometry' ? '…' : v), 2)}</pre>
          {p.note && <p className="muted">{t('msg.proposalNote', { note: p.note })}</p>}
          {p.can_decide && (
            <div className="row">
              <input placeholder={t('proposals.note')} value={notes[p.id] ?? ''} onChange={(e) => setNotes({ ...notes, [p.id]: e.target.value })} style={{ maxWidth: 320 }} />
              <button className="btn btn-primary" onClick={() => decide(p.id, 'approve')}>{t('proposals.approve')}</button>
              <button className="btn" onClick={() => decide(p.id, 'reject')}>{t('proposals.reject')}</button>
            </div>
          )}
        </div>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
