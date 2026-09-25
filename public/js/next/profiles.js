// Профили крафта: сохранение/удаление/переименование и загрузка в калькулятор (стек заполняется теми же позициями и количествами).
// Живут в браузере (localStorage), как и крафт-лист.
import { html, createStore, useStore, useState } from './lib.js';
import { stack, list } from './list.js';
import { calcStore } from './calc-store.js';
import { listDef, stackDef } from './listcalc.js';
import { useStackData } from './stack-ui.js';
import { toast } from './ui.js';
import { addProfile, removeProfile, renameProfile, findProfile, makeProfile, roiOf, formatStamp } from './logic/profiles.js';

export const profilesStore = createStore({ profiles: [], selected: null }, { key: 'albion_next_profiles' });
let seq = 0;
const newId = () => `p${Date.now().toString(36)}${++seq}`;

export function saveProfile(items, faction, roi) {
  const p = makeProfile({ items, faction, roi, now: Date.now(), id: newId() });
  profilesStore.set((s) => ({ profiles: addProfile(s.profiles, p), selected: p.id }));
  return p;
}
export const deleteProfile = (id) => profilesStore.set((s) => ({ profiles: removeProfile(s.profiles, id), selected: s.selected === id ? null : s.selected }));
export const renameProfileById = (id, name) => profilesStore.set((s) => ({ profiles: renameProfile(s.profiles, id, name) }));
// Загрузка: калькулятор сразу переходит в режим стека с позициями и количествами профиля
export function loadProfile(id) {
  const p = findProfile(profilesStore.get().profiles, id);
  if (!p) return false;
  stack.replaceAll(p.items, p.faction);
  calcStore.set({ stackMode: true, stackFocus: null, sub: 'buy' });
  profilesStore.set({ selected: id });
  return true;
}

// Панель профилей над калькулятором: выпадающий список, «Сохранить», «Переименовать», «Удалить». Сохраняет то, что сейчас в калькуляторе:
// стек (режим стека) или активные позиции крафт-листа.
export function ProfileBar() {
  const c = useStore(calcStore);
  const { profiles, selected } = useStore(profilesStore);
  const data = useStackData(c.stackMode ? stackDef : listDef);
  const [renaming, setRenaming] = useState(null);      // null — не переименовываем; строка — вводимое имя
  const [confirmDel, setConfirmDel] = useState(false);
  const sel = findProfile(profiles, selected);
  const source = c.stackMode ? stack.store.get().items : list.store.get().items;
  const active = source.filter((i) => i.on !== false);
  const save = () => {
    if (!active.length) { toast('Нечего сохранять: в стеке нет позиций'); return; }
    const p = saveProfile(source, c.stackMode ? stack.store.get().faction : list.store.get().faction, roiOf(data.totals));
    toast(`Профиль сохранён: ${p.name}`);
  };
  const doRename = () => { if (sel) renameProfileById(sel.id, renaming); setRenaming(null); };
  const del = () => {
    if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3500); return; }
    deleteProfile(sel.id); setConfirmDel(false); toast('Профиль удалён');
  };
  return html`<div class="profilebar card" id="profile-bar" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding:12px 16px;margin-bottom:14px">
    <label class="f" style="min-width:260px;flex:1">Профиль крафта<select id="profile-select" value=${selected || ''} onChange=${(e) => { setRenaming(null); if (e.target.value) loadProfile(e.target.value); else profilesStore.set({ selected: null }); }}>
      <option value="">${profiles.length ? '— выбрать профиль —' : 'Профилей пока нет'}</option>
      ${profiles.map((p) => html`<option key=${p.id} value=${p.id} title=${`Сохранён ${formatStamp(p.savedAt)}`}>${p.name} · ${p.items.length} поз.</option>`)}</select></label>
    ${renaming === null ? null : html`<label class="f" style="min-width:220px">Новое название<input id="profile-name" type="text" value=${renaming} onInput=${(e) => setRenaming(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null); }} /></label>
      <button class="btn sm primary" type="button" id="profile-name-ok" onClick=${doRename}>Готово</button>`}
    <button class="btn sm" type="button" id="profile-save" onClick=${save} disabled=${!active.length} title="Сохранить позиции и количества, что сейчас в калькуляторе (стеке или активные из крафт-листа); название — ROI и дата">Сохранить профиль</button>
    <button class="btn sm" type="button" id="profile-rename" disabled=${!sel} onClick=${() => setRenaming(sel ? sel.name : null)}>Переименовать</button>
    <button class="btn sm" type="button" id="profile-delete" disabled=${!sel} onClick=${del}>${confirmDel ? 'Точно удалить?' : 'Удалить'}</button>
  </div>`;
}
