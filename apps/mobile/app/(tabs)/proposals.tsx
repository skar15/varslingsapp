import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@varsling/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { api, unwrap } from '@/api';
import { useLocale, useT } from '@/i18n';
import { useProposals } from '@/queries';
import { Button, Card, Field, Loading, Screen, styles, T } from '@/ui';

/** Inbox for owner and delegates; members see their own proposals and their results. */
export default function Proposals() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const q = useProposals();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!q.data) return <Loading />;
  const decide = async (id: string, approve: boolean) => {
    const path = approve ? '/v1/proposals/{id}/approve' : '/v1/proposals/{id}/reject';
    await unwrap(api.POST(path, { params: { path: { id } }, body: { note: notes[id] || undefined } })).catch(() => undefined);
    await qc.invalidateQueries();
  };
  return (
    <Screen>
      {q.data.items.length === 0 && <T muted>{t('proposals.empty')}</T>}
      {q.data.items.map((p) => (
        <Card key={p.id}>
          <T bold>{t(`proposals.kind.${p.kind}`)} · {t(`proposals.status.${p.status}`)}</T>
          <T muted size={14}>{p.proposer.name} · {formatDateTime(p.created_at, locale)}</T>
          {p.message && <T>{p.message}</T>}
          {p.note && <T muted>{t('msg.proposalNote', { note: p.note })}</T>}
          {p.can_decide && (
            <View style={{ gap: 8 }}>
              <Field label={t('proposals.note')} value={notes[p.id] ?? ''} onChangeText={(v) => setNotes({ ...notes, [p.id]: v })} />
              <View style={styles.row}>
                <Button kind="primary" title={t('proposals.approve')} onPress={() => void decide(p.id, true)} />
                <Button title={t('proposals.reject')} onPress={() => void decide(p.id, false)} />
              </View>
            </View>
          )}
        </Card>
      ))}
    </Screen>
  );
}
