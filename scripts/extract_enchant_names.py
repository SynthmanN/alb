#!/usr/bin/env python3
"""Добавляет в data/extra-item-names.json русские названия материалов зачарования (руны, души, реликвии T4–T8).

Названия берутся из formatted/items.json дампа ao-data/ao-bin-dumps; формат файла сохраняется (отступ 1).
Запуск: python3 scripts/extract_enchant_names.py [каталог_с_дампами]   (нужен items.json)
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.json'


def main():
    dump_dir = sys.argv[1] if len(sys.argv) > 1 else None
    path = os.path.join(dump_dir, 'items.json') if dump_dir else '/tmp/ao-dump-items.json'
    if not os.path.exists(path):
        print('скачиваю formatted/items.json')
        urllib.request.urlretrieve(URL, path)
    with open(path, encoding='utf-8') as f:
        ru = {i['UniqueName']: i['LocalizedNames']['RU-RU'] for i in json.load(f) if (i.get('LocalizedNames') or {}).get('RU-RU')}
    extra_path = os.path.join(ROOT, 'data', 'extra-item-names.json')
    with open(extra_path, encoding='utf-8') as f:
        extra = json.load(f)
    added = 0
    for tier in range(4, 9):
        for kind in ('RUNE', 'SOUL', 'RELIC'):
            uid = f'T{tier}_{kind}'
            if uid not in extra and uid in ru:
                extra[uid] = ru[uid]
                added += 1
    with open(extra_path, 'w', encoding='utf-8') as f:
        json.dump(extra, f, ensure_ascii=False, indent=1)
    print(f'добавлено названий: {added}')


if __name__ == '__main__':
    main()
