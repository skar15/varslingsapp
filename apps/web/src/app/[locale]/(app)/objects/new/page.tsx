'use client';
import { ObjectForm } from '@/components/ObjectForm';
import { useT } from '@/lib/i18n';
import { useMe, useReference } from '@/lib/queries';

export default function NewObject() {
  const t = useT();
  const ref = useReference();
  const me = useMe();
  if (!ref.data || !me.data) return <main><p>{t('common.loading')}</p></main>;
  return (
    <main>
      <h1>{t('object.new')}</h1>
      <ObjectForm reference={ref.data} asProposal={me.data.user.effective_role === 'member'} />
    </main>
  );
}
