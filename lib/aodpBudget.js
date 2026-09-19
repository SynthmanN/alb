// Общий регулятор бюджета запросов к AODP. Через него идут ВСЕ походы в AODP — и живые (калькулятор, сканы), и фоновый
// краулер «кувшина»: суммарно не больше ratePerMinute запросов в минуту, сколько бы людей ни сидело на сайте.
// Официальный лимит AODP — 180 запросов/мин и 300 за 5 минут (в среднем 60/мин), поэтому по умолчанию берём 45: запас остаётся
// и на всплески живых запросов, и на другие страницы. Токены копятся по часам (без таймеров-«вечных»): стартовый запас — полный бак.
// Живые запросы (priority 1) обгоняют фоновые (priority 0): краулер не должен тормозить человека у калькулятора.
class AodpBudget {
  constructor({ ratePerMinute = 45, burst = ratePerMinute, now = Date.now, setTimer = setTimeout } = {}) {
    if (!(ratePerMinute > 0)) throw new Error('ratePerMinute должен быть положительным числом');
    this.ratePerMinute = ratePerMinute;
    this.burst = burst;
    this.tokens = burst;
    this._now = now;
    this._setTimer = setTimer;
    this._last = now();
    this._queue = [];
    this._seq = 0;
    this._timer = null;
    this.granted = 0; // сколько токенов выдано за всё время (для мониторинга)
  }

  _refill() {
    const t = this._now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this._last) * this.ratePerMinute) / 60000);
    this._last = t;
  }

  // Ждёт своей очереди на один запрос. Чем выше priority, тем раньше; при равном приоритете — по порядку прихода.
  acquire(priority = 0) {
    return new Promise((resolve) => {
      this._queue.push({ priority, seq: this._seq++, resolve });
      this._drain();
    });
  }

  _drain() {
    if (this._timer) return;
    this._refill();
    while (this._queue.length > 0 && this.tokens >= 1) {
      let best = 0;
      for (let i = 1; i < this._queue.length; i++) {
        const a = this._queue[i];
        const b = this._queue[best];
        if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const [entry] = this._queue.splice(best, 1);
      this.tokens -= 1;
      this.granted += 1;
      entry.resolve();
    }
    if (this._queue.length > 0) {
      const waitMs = Math.max(Math.ceil(((1 - this.tokens) * 60000) / this.ratePerMinute), 1);
      this._timer = this._setTimer(() => { this._timer = null; this._drain(); }, waitMs);
      if (this._timer && this._timer.unref) this._timer.unref();
    }
  }

  stats() {
    this._refill();
    return { tokens: this.tokens, queued: this._queue.length, granted: this.granted, ratePerMinute: this.ratePerMinute };
  }
}

module.exports = { AodpBudget };
