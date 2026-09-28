// Профили крафта: сохранённые наборы позиций (предмет, зачарование, качество, количество, выбранный рецепт) — чтобы случайная
// перезагрузка страницы не заставляла заново собирать стек из крафт-листа. Чистые функции — без DOM и хранилища.
const pad = (n) => String(n).padStart(2, '0');
export const formatStamp = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ROI = профит / вложения по включённым позициям (в процентах); нет вложений или расчёта — null
export const roiOf = (totals) => (totals && totals.cost > 0 && Number.isFinite(totals.profit) ? (totals.profit / totals.cost) * 100 : null);

// Название по умолчанию: сколько ROI даёт профиль и когда сохранён (дату и время сохранения видно всегда, даже после переименования — в подсказке)
export const defaultProfileName = (roi, ms) => `ROI ${roi === null || roi === undefined ? '—' : `${roi.toFixed(1)}%`} · ${formatStamp(ms)}`;

// Позиции без служебного: uid (новый выдаётся при загрузке) и приблизительных цифр из скана; количество, рецепт и выключенность остаются
export const snapshotItems = (items) => items.map(({ uid, cost, profit, ...rest }) => ({ ...rest, on: rest.on !== false }));

export function makeProfile({ items, faction, roi, now, id }) {
  return { id, name: defaultProfileName(roi, now), savedAt: now, roi: roi ?? null, items: snapshotItems(items), faction: faction || null };
}
export const addProfile = (profiles, p) => [p, ...profiles];
export const removeProfile = (profiles, id) => profiles.filter((p) => p.id !== id);
// пустое имя не сохраняется — остаётся прежнее
export const renameProfile = (profiles, id, name) => { const n = String(name || '').trim(); return n ? profiles.map((p) => (p.id === id ? { ...p, name: n } : p)) : profiles; };
export const findProfile = (profiles, id) => profiles.find((p) => p.id === id) || null;

// Выбор профиля в списке двухшаговый (защита от случайной загрузки): загрузить профиль можно, только пока в списке стоит «— выберите профиль —».
// Чтобы сменить один профиль на другой, сначала выбирают «— выберите профиль —», потом нужный. Возврат на «выберите» разрешён всегда.
export const canPickProfile = (current, next) => !next || !current;

// Синхронизация с сервером. Сервер — источник правды. Один раз (migrated=false) профили, которые до переезда жили только в браузере,
// дозаливаются на сервер; после этого удалённое на сервере не воскресает из локальной копии. Возвращает итоговый список и то, что надо отправить.
export function mergeProfiles(remote, local, migrated) {
  if (migrated) return { profiles: remote, toPush: [] };
  const have = new Set(remote.map((p) => p.id));
  const toPush = local.filter((p) => !have.has(p.id));
  return { profiles: [...remote, ...toPush].sort((a, b) => b.savedAt - a.savedAt), toPush };
}
