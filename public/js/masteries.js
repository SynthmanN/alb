// Страница «Мастерки»: уровни мастерства и специализаций.

// --- Мастерки ---
const masteryEl = {
  search: document.getElementById('mastery-search'),
  list: document.getElementById('mastery-list'),
  status: document.getElementById('mastery-status'),
};
let masteryData = null; // { masteries, specializations, maxLevel, levels }

async function initMasteries() {
  try {
    const res = await fetch('/api/masteries');
    masteryData = await res.json();
    if (masteryData.error) throw new Error(masteryData.error);
    renderMasteries();
    masteryEl.search.addEventListener('input', renderMasteries);
  } catch (err) {
    masteryEl.list.innerHTML = `<span style="color:#ff6b6b">Ошибка: ${err.message}</span>`;
  }
}

async function saveMasteryLevel(kind, id, value) {
  const level = Math.min(Math.max(parseInt(value, 10) || 0, 0), masteryData.maxLevel);
  masteryEl.status.textContent = 'Сохраняю...';
  try {
    const res = await fetch('/api/masteries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [kind]: { [id]: level } }),
    });
    // fetch() не бросает исключение на 4xx/5xx — проверяем статус сами, иначе ошибка сохранения молча сочтётся успехом
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    masteryData.levels = { masteries: data.masteries, specializations: data.specializations };
    masteryEl.status.textContent = 'Сохранено';
  } catch (err) {
    masteryEl.status.textContent = `Ошибка сохранения: ${err.message}`;
    showToast(`Уровень не сохранён: ${err.message}`, 'error');
  }
}

function renderMasteries() {
  const q = masteryEl.search.value.trim().toLowerCase();
  const levels = masteryData.levels;
  const html = masteryData.masteries.map((m) => {
    const specs = masteryData.specializations.filter((s) => s.masteryId === m.id);
    const catMatch = !q || m.name.toLowerCase().includes(q);
    const shownSpecs = specs.filter((s) => catMatch || s.name.toLowerCase().includes(q));
    if (!catMatch && shownSpecs.length === 0) return '';
    const specRows = shownSpecs.map((s) => `
      <label class="mastery-row"><span>${s.name}</span>
        <input type="number" min="0" max="${masteryData.maxLevel}" data-kind="specializations" data-id="${s.id}" value="${levels.specializations[s.id] || 0}" />
      </label>`).join('');
    return `
      <details class="mastery-cat" ${q ? 'open' : ''}>
        <summary>${m.name}
          <input type="number" min="0" max="${masteryData.maxLevel}" data-kind="masteries" data-id="${m.id}" value="${levels.masteries[m.id] || 0}" title="Уровень мастерства категории" />
        </summary>
        <div class="mastery-specs">${specRows}</div>
      </details>`;
  }).join('');
  masteryEl.list.innerHTML = html || '<div class="chart-empty">Ничего не найдено.</div>';
  masteryEl.list.querySelectorAll('input[data-id]').forEach((inp) => {
    inp.addEventListener('click', (e) => e.stopPropagation()); // чтобы ввод в summary не сворачивал категорию
    inp.addEventListener('change', () => saveMasteryLevel(inp.dataset.kind, inp.dataset.id, inp.value));
  });
}

initMasteries();
