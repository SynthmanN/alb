#!/usr/bin/env python3
"""Помечает в data/recipes.json материалы, которые НЕ возвращаются при крафте (RRR на них не действует).

В items.xml у <craftresource> есть атрибут maxreturnamount: 0 — материал не возвращается (артефакты, гербы, жетоны,
базовый плащ с preservequality). Возврат (RRR) распространяется только на обычные материалы рецепта.
Скрипт добавляет "noReturn": true таким материалам; идемпотентен, формат файла сохраняется (отступ 1).

Запуск: python3 scripts/extract_return_flags.py [путь/к/items.xml]
"""
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.xml'


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ao-dump-items.xml'
    if not os.path.exists(path):
        print('скачиваю items.xml')
        urllib.request.urlretrieve(URL, path)
    recipes_path = os.path.join(ROOT, 'data', 'recipes.json')
    with open(recipes_path, encoding='utf-8') as f:
        recipes = json.load(f)

    no_return = {}  # id предмета -> множество материалов без возврата (по первому рецепту, как в recipes.json)
    for _, el in ET.iterparse(path, events=('end',)):
        uid = el.get('uniquename')
        if uid in recipes and uid not in no_return:
            cr = el.find('craftingrequirements')
            if cr is not None:
                no_return[uid] = {r.get('uniquename') for r in cr.findall('craftresource') if r.get('maxreturnamount') == '0'}
        # el.clear() нельзя: дочерние <craftresource> закрываются раньше родителя и потеряли бы атрибуты

    flagged = 0
    for uid, recipe in recipes.items():
        for r in recipe['resources']:
            if r['resource'] in no_return.get(uid, set()):
                if not r.get('noReturn'):
                    r['noReturn'] = True
                    flagged += 1
            else:
                r.pop('noReturn', None)
    with open(recipes_path, 'w', encoding='utf-8') as f:
        json.dump(recipes, f, ensure_ascii=False, indent=1)
    print(f'помечено материалов без возврата: {flagged}')
    kinds = {}
    for recipe in recipes.values():
        for r in recipe['resources']:
            if r.get('noReturn'):
                kinds[r['resource'].split('_', 1)[1]] = kinds.get(r['resource'].split('_', 1)[1], 0) + 1
    print('примеры:', dict(list(sorted(kinds.items(), key=lambda x: -x[1]))[:8]))


if __name__ == '__main__':
    main()
