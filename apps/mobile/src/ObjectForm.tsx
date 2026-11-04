import { useQueryClient } from '@tanstack/react-query';
import { refName, SENSITIVITIES, statusesForType, suggestedSituations, type LocationInput, type ObjectGeometry, type ReferenceData, type Sensitivity } from '@varsling/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError, unwrap } from './api';
import { useLocale, useT } from './i18n';
import { LocationPicker } from './LocationPicker';
import { Button, Card, Chip, Field, styles, T } from './ui';

export interface ExistingObject {
  id: string;
  nickname: string | null;
  type_key: string | null;
  status_key: string;
  place_label: string | null;
  geometry: { type: 'Point' | 'Polygon'; coordinates: unknown } | null;
  situations: { situation_key: string; sensitivity: Sensitivity }[];
}

/** Steps: type (optional), nickname, location, status, situation types and sensitivity. */
export function ObjectForm({ reference, existing, asProposal }: { reference: ReferenceData; existing?: ExistingObject; asProposal: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const sets = { situations: reference.situation_types, types: reference.object_types, statuses: reference.object_statuses };
  const [typeKey, setTypeKey] = useState<string | null>(existing?.type_key ?? null);
  const [nickname, setNickname] = useState(existing?.nickname ?? '');
  const [location, setLocation] = useState<LocationInput>(() => {
    const g = existing?.geometry as ObjectGeometry | null | undefined;
    if (!g) return { kind: 'none' };
    return g.type === 'Point' ? { kind: 'point', geometry: g, place_label: existing!.place_label } : { kind: 'area', geometry: g, place_label: existing!.place_label };
  });
  const [statusKey, setStatusKey] = useState('normal');
  const [hours, setHours] = useState('24');
  const [custom, setCustom] = useState<Record<string, Sensitivity> | null>(
    existing?.situations.length ? Object.fromEntries(existing.situations.map((s) => [s.situation_key, s.sensitivity])) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const selected = custom ?? Object.fromEntries(suggestedSituations(sets, typeKey, existing?.status_key ?? statusKey).map((k) => [k, 'high' as Sensitivity]));

  async function save() {
    setError(null);
    const type = reference.object_types.find((x) => x.key === typeKey);
    if (type && type.defaults.length === 0 && Object.keys(selected).length === 0) return setError(t('object.situations.mustChoose'));
    const situations = custom ? Object.entries(custom).map(([situation_key, sensitivity]) => ({ situation_key, sensitivity })) : undefined;
    try {
      if (!existing) {
        const payload = {
          nickname: nickname || null, type_key: typeKey, location, situations,
          ...(statusKey !== 'normal' ? { status_key: statusKey, status_until: new Date(Date.now() + Number(hours) * 3_600_000).toISOString() } : {}),
        };
        if (asProposal) await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_create', payload } }));
        else await unwrap(api.POST('/v1/objects', { body: payload }));
      } else {
        const patch = { nickname: nickname || null, type_key: typeKey, location };
        if (asProposal) {
          await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_update', target_id: existing.id, payload: patch } }));
          if (situations) await unwrap(api.POST('/v1/proposals', { body: { kind: 'object_situations', target_id: existing.id, payload: { situations } } }));
        } else {
          await unwrap(api.PATCH('/v1/objects/{id}', { params: { path: { id: existing.id } }, body: patch }));
          await unwrap(api.PUT('/v1/objects/{id}/situations', { params: { path: { id: existing.id } }, body: { situations: situations ?? [] } }));
        }
      }
      await qc.invalidateQueries();
      router.back();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'plan_limit_objects' ? t('object.limitReached') : t('common.error'));
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Card>
        <T bold>1. {t('object.step.type')}</T>
        <View style={styles.row}>
          <Chip label={t('object.type.none')} selected={!typeKey} onPress={() => { setTypeKey(null); setCustom(null); }} />
          {reference.object_types.map((x) => <Chip key={x.key} label={refName(x.i18n, locale)} selected={typeKey === x.key} onPress={() => { setTypeKey(x.key); setCustom(null); }} />)}
        </View>
      </Card>
      <Card>
        <T bold>2. {t('object.step.name')}</T>
        <Field label={`${t('object.nickname')} (${t('common.optional')})`} value={nickname} onChangeText={setNickname} maxLength={80} />
      </Card>
      <Card>
        <T bold>3. {t('object.step.location')}</T>
        <LocationPicker value={location} onChange={setLocation} maxAreaKm2={reference.config.max_area_km2} />
      </Card>
      {!existing && (
        <Card>
          <T bold>4. {t('object.step.status')}</T>
          <View style={styles.row}>
            {statusesForType(sets, typeKey).map((s) => <Chip key={s.key} label={refName(reference.object_statuses.find((x) => x.key === s.key)?.i18n, locale)} selected={statusKey === s.key} onPress={() => setStatusKey(s.key)} />)}
          </View>
          {statusKey !== 'normal' && <Field label={`${t('object.statusEnd')} (${t('object.hours', { n: '' }).trim()})`} value={hours} onChangeText={setHours} keyboardType="number-pad" />}
        </Card>
      )}
      <Card>
        <T bold>{existing ? 4 : 5}. {t('object.step.situations')}</T>
        <T muted size={14}>{t('object.situations.help')}</T>
        {reference.situation_types.filter((s) => s.available).map((s) => (
          <View key={s.key} style={{ gap: 6 }}>
            <Chip label={refName(s.i18n, locale)} selected={s.key in selected} onPress={() => {
              const next = { ...selected };
              if (s.key in next) delete next[s.key];
              else next[s.key] = 'high';
              setCustom(next);
            }} />
            {s.key in selected && (
              <View style={[styles.row, { paddingLeft: 12 }]}>
                {SENSITIVITIES.map((v) => <Chip key={v} label={t(`sensitivity.${v}`)} selected={selected[s.key] === v} onPress={() => setCustom({ ...selected, [s.key]: v })} />)}
              </View>
            )}
          </View>
        ))}
      </Card>
      {error && <T color="#b42318">{error}</T>}
      <Button kind="primary" title={asProposal ? t('proposals.compose') : t('common.save')} onPress={() => void save()} testID="save-object" />
    </View>
  );
}
