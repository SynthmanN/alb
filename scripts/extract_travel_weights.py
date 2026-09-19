#!/usr/bin/env python3
"""Извлекает вес и коэффициент стоимости телепорта (fasttravelfactor) предметов из items.xml в data/travel-weights.json.

Стоимость телепорта в Albion: 150 × вес × количество × коэффициент × дистанция (округление вверх до целого на стек).
И вес (weight), и коэффициент (fasttravelfactor; у большинства предметов его нет = 1, у ресурсов = 2) лежат прямо в items.xml —
не в статьях и не в AODP. Собираем только предметы, нужные проекту: каталог (data/items.js), материалы рецептов и
руны/души/реликвии зачарования.

Запуск: python3 scripts/extract_travel_weights.py [путь/к/items.xml]
Без аргумента скачивает items.xml с raw.githubusercontent.com (кэш в /tmp).
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.xml'


def items_xml(path):
    if path:
        return path
    cache = '/tmp/ao-dump-items.xml'
    if not os.path.exists(cache):
        print('скачиваю items.xml')
        urllib.request.urlretrieve(URL, cache)
    return cache


def needed_ids():
    """Все id, для которых проекту нужен вес: каталог, материалы рецептов, материалы зачарования."""
    out = subprocess.run(
        ['node', '-e', "const {ITEMS}=require('./data/items');console.log(JSON.stringify(ITEMS.map(i=>i.id)))"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    ids = set(json.loads(out))
    recipes = json.load(open(os.path.join(ROOT, 'data', 'recipes.json'), encoding='utf-8'))
    for recipe in recipes.values():
        for r in recipe['resources']:
            ids.add(r['resource'])
    for tier in range(4, 9):
        for kind in ('RUNE', 'SOUL', 'RELIC'):
            ids.add(f'T{tier}_{kind}')
    return ids


def main():
    path = items_xml(sys.argv[1] if len(sys.argv) > 1 else None)
    wanted = needed_ids()
    found = {}
    for _, el in ET.iterparse(path, events=('end',)):
        uid = el.get('uniquename')
        if uid in wanted and el.get('weight') is not None and uid not in found:
            found[uid] = {
                'fastTravelFactor': float(el.get('fasttravelfactor') or 1),
                'weight': float(el.get('weight')),
            }
        el.clear()
    missing = sorted(wanted - set(found))
    with open(os.path.join(ROOT, 'data', 'travel-weights.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(found.items())), f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'Готово: data/travel-weights.json — вес+коэффициент найден для {len(found)} из {len(wanted)}')
    if missing:
        print('без веса (не найдены в items.xml):', missing[:20], '…' if len(missing) > 20 else '')


if __name__ == '__main__':
    main()
