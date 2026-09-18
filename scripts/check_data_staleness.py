#!/usr/bin/env python3
"""Проверяет, не изменились ли игровые дампы (ao-data/ao-bin-dumps) с момента последней экстракции.

Данные проекта (data/gear.json, recipes.json, masteries.json) — заморожены на момент извлечения из items.xml
и achievements.xml. Скрипт сверяет SHA последних коммитов апстрима, затронувших эти файлы, с сохранённым
состоянием data/.extraction-state.json. Ничего не обновляет автоматически: это сигнал «пора пересобрать
данные и проверить», а не автодействие (слепой автодеплой новых данных — риск).

  python3 scripts/check_data_staleness.py            проверка; код выхода 0 — актуально, 1 — апстрим изменился,
                                                     2 — нет сохранённого состояния, 3 — ошибка сети/GitHub
  python3 scripts/check_data_staleness.py --update   записать текущее состояние апстрима как «данные актуальны»
"""
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

REPO = 'ao-data/ao-bin-dumps'
WATCHED = ['items.xml', 'achievements.xml']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(ROOT, 'data', '.extraction-state.json')


def latest_commit(path):
    """Последний коммит апстрима, затронувший файл path."""
    url = f'https://api.github.com/repos/{REPO}/commits?path={path}&per_page=1'
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'albion-market-table'})
    with urllib.request.urlopen(req, timeout=30) as res:
        commits = json.load(res)
    if not commits:
        raise RuntimeError(f'нет коммитов для {path}')
    c = commits[0]
    return {
        'sha': c['sha'],
        'date': c['commit']['committer']['date'],
        'message': c['commit']['message'].split('\n')[0],
    }


def current_upstream():
    return {name: latest_commit(name) for name in WATCHED}


def main():
    try:
        upstream = current_upstream()
    except (urllib.error.URLError, RuntimeError, OSError) as err:
        print(f'Не удалось получить данные с GitHub: {err}')
        return 3

    if '--update' in sys.argv:
        state = dict(upstream)
        state['recordedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        with open(STATE_PATH, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('state обновлён:', STATE_PATH)
        for name, c in upstream.items():
            print(f"  {name}: {c['sha'][:10]} ({c['date']})")
        return 0

    if not os.path.exists(STATE_PATH):
        print('Нет сохранённого state (data/.extraction-state.json) — запусти с --update после первой проверки.')
        return 2
    with open(STATE_PATH, encoding='utf-8') as f:
        saved = json.load(f)

    changed = [n for n in WATCHED if saved.get(n, {}).get('sha') != upstream[n]['sha']]
    if not changed:
        print('Данные актуальны — апстрим не менялся с последней экстракции.')
        return 0

    print('ВНИМАНИЕ: апстрим игровых дампов изменился с момента последней экстракции.')
    for name in changed:
        old = saved.get(name, {})
        new = upstream[name]
        print(f"  {name}: было {str(old.get('sha', '—'))[:10]} ({old.get('date', '—')}) → стало {new['sha'][:10]} ({new['date']}): {new['message']}")
    print('Что проверить: новые предметы/рецепты (data/gear.json, recipes.json — экстракция из items.xml)')
    print('и дерево мастерок (python3 scripts/extract_masteries.py). После пересборки и проверки — запусти с --update.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
