'use client';
import { useParams } from 'next/navigation';
import { ObjectForm } from '@/components/ObjectForm';
import { useT } from '@/lib/i18n';
import { useMe, useObject, useReference } from '@/lib/queries';

export default function EditObject() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const ref = useReference();
  const me = useMe();
  const obj = useObject(id);
  if (!ref.data || !me.data || !obj.data) return <main><p>{t('common.loading')}</p></main>;
  return (
    <main>
      <h1>{t('object.edit')}</h1>
      <ObjectForm reference={ref.data} existing={obj.data} asProposal={!obj.data.can_edit} />
    </main>
  );
}
