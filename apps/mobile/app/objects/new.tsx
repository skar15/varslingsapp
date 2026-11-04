import { useMe, useReference } from '@/queries';
import { ObjectForm } from '@/ObjectForm';
import { Loading, Screen } from '@/ui';

export default function NewObject() {
  const ref = useReference();
  const me = useMe();
  if (!ref.data || !me.data) return <Loading />;
  return <Screen><ObjectForm reference={ref.data} asProposal={me.data.user.effective_role === 'member'} /></Screen>;
}
