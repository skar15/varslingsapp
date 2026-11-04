import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useT } from '@/i18n';
import { permissionStatus, requestAndRegister } from '@/notifications';
import { Button, Card, Screen, T } from '@/ui';

/**
 * Explanation before the system permission dialog. On iOS a refused dialog cannot be shown
 * again, so the user decides here first.
 */
export default function Permission() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    void permissionStatus().then((s) => s !== 'undetermined' && router.replace('/'));
  }, [router]);
  return (
    <Screen>
      <Card>
        <T bold size={20}>{t('permission.explainer.title')}</T>
        <T>{t('permission.explainer.body')}</T>
        <Button kind="primary" title={t('permission.explainer.continue')} testID="allow-notifications" onPress={async () => {
          await requestAndRegister().catch(() => false);
          router.replace('/');
        }} />
        <Button title={t('common.close')} onPress={() => router.replace('/')} />
      </Card>
    </Screen>
  );
}
