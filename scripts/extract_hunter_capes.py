#!/usr/bin/env python3
"""Добавляет в базу «охотничьи» боевые плащи (Avalon/Demon/Heretic/Keeper/Morgana/Smuggler/Undead, T4–T8).

Раньше в data/gear.json были только обычные и фракционные плащи (CAPEITEM_FW_*); целая категория дорогих плащей
(T8 Авалонский торгуется по ~600–800 тыс.) в расчётах не появлялась. Скрипт берёт из дампа items.xml рецепт крафта
(<craftingrequirements>), из formatted/items.json — русские названия, и дописывает:
  data/gear.json              — предметы (slot «плащ (охотник)»)
  data/recipes.json           — рецепты
  data/extra-item-names.json  — названия материалов вне каталога (герб, жетон/энергия семейства)
Идемпотентен: уже добавленное не дублируется.

Запуск: python3 scripts/extract_hunter_capes.py [каталог_с_дампами]   (нужны items.xml и items.json)
После него запусти scripts/extract_travel_weights.py — веса новых материалов.
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/'
FAMILIES = ['AVALON', 'DEMON', 'HERETIC', 'KEEPER', 'MORGANA', 'SMUGGLER', 'UNDEAD']
TIERS = [4, 5, 6, 7, 8]
SLOT = 'плащ (охотник)'


def dump(name, dump_dir):
    if dump_dir:
        return os.path.join(dump_dir, os.path.basename(name))
    path = '/tmp/ao-dump-' + os.path.basename(name)
    if not os.path.exists(path):
        print('скачиваю', name)
        urllib.request.urlretrieve(BASE_URL + name, path)
    return path


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def main():
    dump_dir = sys.argv[1] if len(sys.argv) > 1 else None
    wanted = {f'T{t}_CAPEITEM_{fam}': (t, fam) for fam in FAMILIES for t in TIERS}

    # русские названия всех нужных предметов и материалов
    ru_names = {}
    for it in load_json(dump('formatted/items.json', dump_dir)):
        ru = (it.get('LocalizedNames') or {}).get('RU-RU')
        if ru:
            ru_names[it['UniqueName']] = ru

    recipes_found = {}
    for _, el in ET.iterparse(dump('items.xml', dump_dir), events=('end',)):
        uid = el.get('uniquename')
        if uid in wanted:
            cr = el.find('craftingrequirements')
            if cr is not None:
                recipes_found[uid] = {
                    'resources': [{'resource': r.get('uniquename'), 'count': int(r.get('count'))} for r in cr.findall('craftresource')],
                    'silver': int(float(cr.get('silver') or 0)),
                }
        # el.clear() здесь нельзя: дочерние <craftresource> закрываются раньше родителя и потеряли бы атрибуты

    gear_path = os.path.join(ROOT, 'data', 'gear.json')
    recipes_path = os.path.join(ROOT, 'data', 'recipes.json')
    extra_path = os.path.join(ROOT, 'data', 'extra-item-names.json')
    gear, recipes, extra = load_json(gear_path), load_json(recipes_path), load_json(extra_path)
    have = {g['id'] for g in gear}
    added = 0
    for uid, (tier, fam) in wanted.items():
        if uid in have or uid not in recipes_found or uid not in ru_names:
            continue
        gear.append({'id': uid, 'name': f'T{tier} {ru_names[uid]}', 'category': 'cape', 'tier': tier, 'slot': SLOT})
        recipes[uid] = recipes_found[uid]
        for r in recipes_found[uid]['resources']:
            rid = r['resource']
            if rid not in have and rid not in extra and rid in ru_names and not rid.endswith('_CAPE'):
                extra[rid] = ru_names[rid]
        added += 1

    # отступы как в существующих файлах, чтобы в git-диффе были только добавленные записи
    for path, data, indent in ((gear_path, gear, 2), (recipes_path, recipes, 1), (extra_path, extra, 1)):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=indent)
    missing = [u for u in wanted if u not in recipes_found]
    print(f'добавлено плащей: {added}; всего в gear.json: {len(gear)}; рецептов: {len(recipes)}')
    if missing:
        print('без рецепта в items.xml:', missing)


if __name__ == '__main__':
    main()
