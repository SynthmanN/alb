#!/usr/bin/env python3
"""Извлекает дерево мастерок (Destiny Board) из игровых дампов в data/masteries.json.

Источник — тот же репозиторий, что и остальные данные проекта (ao-data/ao-bin-dumps), не статьи:
  achievements.xml  — категории (COMBAT_BASE / COMBAT_OFF_BASE) и специализации (COMBAT_SPEC / COMBAT_OFF_SPEC),
                      список предметов каждой специализации в <itemlist><itempattern pattern="T?_MAIN_SWORD"/>
  localization.json — русские названия (@DESTINYBOARD_TITLE_*)
Оставляем только то, что есть в data/gear.json (оружие и броня; плащи в дереве не участвуют).

Запуск: python3 scripts/extract_masteries.py [каталог_с_дампами]
Без аргумента скачивает achievements.xml и localization.json с raw.githubusercontent.com.
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

BASE_URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATEGORY_TEMPLATES = {'COMBAT_BASE', 'COMBAT_OFF_BASE'}
SPEC_TEMPLATES = {'COMBAT_SPEC', 'COMBAT_OFF_SPEC'}


def fetch(name, dump_dir):
    if dump_dir:
        return os.path.join(dump_dir, name)
    path = os.path.join('/tmp', 'ao-dump-' + name)
    if not os.path.exists(path):
        print('скачиваю', name)
        urllib.request.urlretrieve(BASE_URL + name, path)
    return path


def title_tag(el):
    t = el.find('title')
    return t.get('tag') if t is not None else None


def families_of(el):
    """Семейства предметов из <itemlist> (T?_MAIN_SWORD -> MAIN_SWORD); шаблоны с * пропускаем."""
    out = []
    for p in el.findall('./itemlist/itempattern'):
        pat = p.get('pattern') or ''
        if pat.startswith('T?_') and '*' not in pat:
            out.append(pat[3:])
    return out


def main():
    dump_dir = sys.argv[1] if len(sys.argv) > 1 else None
    gear = json.load(open(os.path.join(ROOT, 'data', 'gear.json'), encoding='utf-8'))
    gear_families = {g['id'].split('_', 1)[1] for g in gear if g['category'] in ('weapon', 'armor')}

    root = ET.parse(fetch('achievements.xml', dump_dir)).getroot()
    categories, specs = {}, {}
    for el in root.findall('templateachievement'):
        use, aid = el.get('usetemplate'), el.get('id')
        if use in CATEGORY_TEMPLATES:
            categories[aid] = el
        elif use in SPEC_TEMPLATES:
            specs[aid] = el

    # Русские названия только для тех тегов, что нужны
    needed = {title_tag(e) for e in list(categories.values()) + list(specs.values())}
    loc = json.load(open(fetch('localization.json', dump_dir), encoding='utf-8'))
    names = {}
    for tu in loc['tmx']['body']['tu']:
        tag = tu.get('@tuid')
        if tag in needed:
            tuv = tu['tuv'] if isinstance(tu['tuv'], list) else [tu['tuv']]
            for v in tuv:
                if v.get('@xml:lang') == 'RU-RU':
                    names[tag] = v['seg']

    out_specs, spec_ids_by_mastery = [], {}
    for mid, cat in categories.items():
        children = [a.get('id') for a in cat.findall('./parentachievements/achievement')]
        for sid in children:
            spec = specs.get(sid)
            if spec is None:
                continue
            fams = [f for f in families_of(spec) if f in gear_families]
            if not fams:
                continue
            out_specs.append({'id': sid, 'masteryId': mid, 'name': names.get(title_tag(spec), sid), 'families': fams})
            spec_ids_by_mastery.setdefault(mid, []).append(sid)

    out_masteries = [
        {'id': mid, 'name': names.get(title_tag(categories[mid]), mid)}
        for mid in categories if mid in spec_ids_by_mastery
    ]
    out_masteries.sort(key=lambda m: m['name'])
    out_specs.sort(key=lambda s: (s['masteryId'], s['name']))

    covered = {f for s in out_specs for f in s['families']}
    missing = sorted(gear_families - covered)
    with open(os.path.join(ROOT, 'data', 'masteries.json'), 'w', encoding='utf-8') as f:
        json.dump({'masteries': out_masteries, 'specializations': out_specs}, f, ensure_ascii=False, indent=1)
    print(f'категорий: {len(out_masteries)}, специализаций: {len(out_specs)}')
    print('семейства из gear.json без специализации:', missing)


if __name__ == '__main__':
    main()
