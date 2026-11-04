'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { errorKey } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useMe, useUsers } from '@/lib/queries';
import { toE164 } from '@/lib/supabase';

export default function UsersPage() {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe();
  const users = useUsers();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<'email' | 'sms'>('sms');
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!users.data || !me.data) return <main><p>{t('common.loading')}</p></main>;
  const isOwner = me.data.user.effective_role === 'owner';
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (channel === 'sms') {
        const phone = toE164(target);
        if (!phone) return setError(t('auth.onlyNorwegianNumbers'));
        await unwrap(api.POST('/v1/users/invitations', { body: { channel: 'sms', phone_e164: phone, name: name || undefined } }));
      } else {
        await unwrap(api.POST('/v1/users/invitations', { body: { channel: 'email', email: target, name: name || undefined } }));
      }
      setOpen(false);
      setTarget('');
      setName('');
      await refresh();
    } catch (err) {
      setError(t(errorKey(err)));
    }
  }

  return (
    <main className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{t('users.title')}</h1>
        {isOwner && (
          <button className="btn btn-primary" disabled={!users.data.can_invite} aria-disabled={!users.data.can_invite} title={users.data.can_invite ? t('users.invite') : t('users.limit', { max: users.data.max_users })}
            onClick={() => setOpen(!open)} aria-label={t('users.invite')} data-testid="invite-plus">+</button>
        )}
      </div>
      {isOwner && !users.data.can_invite && <p className="muted">{t('users.limit', { max: users.data.max_users })}</p>}
      {open && (
        <form className="card stack" onSubmit={invite}>
          <div className="row">
            <span>{t('users.inviteBy')}</span>
            <label className="check"><input type="radio" checked={channel === 'sms'} onChange={() => setChannel('sms')} /> {t('users.invitePhone')}</label>
            <label className="check"><input type="radio" checked={channel === 'email'} onChange={() => setChannel('email')} /> {t('users.inviteEmail')}</label>
          </div>
          <input value={target} onChange={(e) => setTarget(e.target.value)} required type={channel === 'email' ? 'email' : 'tel'} placeholder={channel === 'email' ? t('auth.email') : t('auth.phone')} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t('settings.name')} (${t('common.optional')})`} />
          <button className="btn btn-primary" type="submit">{t('users.invite')}</button>
        </form>
      )}
      <table>
        <tbody>
          {users.data.items.map((u) => (
            <tr key={u.id}>
              <td>{u.name} {u.id === me.data.user.id && <span className="muted">{t('users.you')}</span>}</td>
              <td><span className="badge">{t(`role.${u.effective_role}`)}</span></td>
              <td>
                {isOwner && u.role === 'member' && (
                  <label className="check">
                    <input type="checkbox" checked={u.can_manage_objects} onChange={async (e) => {
                      await unwrap(api.PATCH('/v1/users/{id}/rights', { params: { path: { id: u.id } }, body: { can_manage_objects: e.target.checked } }));
                      await refresh();
                    }} /> {t('users.delegate')}
                  </label>
                )}
              </td>
              <td>
                {isOwner && u.role === 'member' && (
                  <button className="btn btn-danger" onClick={async () => {
                    if (!window.confirm(t('users.remove.confirm', { name: u.name }))) return;
                    await unwrap(api.DELETE('/v1/users/{id}', { params: { path: { id: u.id } } }));
                    await refresh();
                  }}>{t('common.delete')}</button>
                )}
              </td>
            </tr>
          ))}
          {users.data.invitations.map((i) => (
            <tr key={i.id}>
              <td>{i.name ?? i.target}</td>
              <td><span className="badge">{t('users.pending')}</span></td>
              <td />
              <td><button className="btn" onClick={async () => { await unwrap(api.DELETE('/v1/users/invitations/{id}', { params: { path: { id: i.id } } })); await refresh(); }}>{t('common.cancel')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!isOwner && (
        <p className="muted">{t('object.proposalSent').split('.')[0]}. <a href="?">{t('proposals.compose')}</a></p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
