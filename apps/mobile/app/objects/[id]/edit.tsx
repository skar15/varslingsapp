import { useLocalSearchParams } from 'expo-router';
import { useObject, useReference } from '@/queries';
import { ObjectForm } from '@/ObjectForm';
import { Loading, Screen } from '@/ui';

export default function EditObject() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ref = useReference();
  const obj = useObject(id);
  if (!ref.data || !obj.data) return <Loading />;
  return <Screen><ObjectForm reference={ref.data} existing={obj.data} asProposal={!obj.data.can_edit} /></Screen>;
}
