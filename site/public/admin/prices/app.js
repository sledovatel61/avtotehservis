/*
 * Счётчик изменений в разделе «Цены и услуги» и сборка полей для «Сохранить всё».
 *
 * Отдельным файлом, а не <script> внутри страницы: политика безопасности сайта
 * запрещает встроенные скрипты (script-src 'self'). Ослаблять её ради счётчика
 * нельзя — это защита от XSS на всех страницах.
 *
 * Скрипт необязательный: без него работают кнопки «Сохранить» в каждой категории.
 * «Сохранить всё» без него скрыта — молча потерять правки хуже, чем попросить
 * сохранить по категориям.
 */
(() => {
  const inputs = Array.from(document.querySelectorAll('[data-pr-input]'));
  if (!inputs.length) return;

  const countEls = document.querySelectorAll('[data-pr-count]');
  const wordEls = document.querySelectorAll('[data-pr-count-word]');
  const saveAllBtn = document.querySelector('[data-pr-save-all]');
  const allFields = document.querySelector('[data-pr-all-fields]');

  const plural = (n, a, b, c) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return a;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return b;
    return c;
  };

  /** Строка изменена, если поле заполнено и значение отличается от текущей цены. */
  const isDirty = (el) => {
    const now = (el.dataset.now || '').trim();
    const value = el.value.trim();
    return value !== '' && value !== now;
  };

  /** Категория строки — из ближайшего блока с data-cat (группа, шины, Voyah). */
  const catOf = (el) => {
    const block = el.closest('[data-cat]');
    return block ? block.dataset.cat || '' : '';
  };

  function recount() {
    let total = 0;
    for (const el of inputs) {
      const dirty = isDirty(el);
      el.classList.toggle('is-dirty', dirty);
      if (dirty) total++;
    }

    for (const el of countEls) el.textContent = String(total);
    for (const el of wordEls) el.textContent = plural(total, 'изменение', 'изменения', 'изменений');
    if (saveAllBtn) saveAllBtn.hidden = total === 0;

    /* «изменено: N» в заголовке категории */
    for (const block of document.querySelectorAll('[data-cat]')) {
      let n = 0;
      for (const el of block.querySelectorAll('[data-pr-input]')) if (isDirty(el)) n++;
      const badge = block.querySelector('[data-chg]');
      if (badge) {
        badge.textContent = n ? 'изменено: ' + n : '';
        badge.hidden = n === 0;
      }
    }

    /* В форму «Сохранить всё» уходят только изменённые поля и только те категории,
       где эти поля есть: иначе сервер обошёл бы весь прайс. */
    if (allFields) {
      allFields.textContent = '';
      const touched = new Set();
      for (const el of inputs) {
        if (!isDirty(el) || !el.name) continue;
        const copy = document.createElement('input');
        copy.type = 'hidden';
        copy.name = el.name;
        copy.value = el.value.trim();
        allFields.appendChild(copy);
        const cat = catOf(el);
        if (cat) touched.add(cat);
      }
      for (const cat of touched) {
        const copy = document.createElement('input');
        copy.type = 'hidden';
        copy.name = 'catAll';
        copy.value = cat;
        allFields.appendChild(copy);
      }
    }
  }

  for (const el of inputs) {
    el.addEventListener('input', recount);
    el.addEventListener('change', recount);
  }
  recount();
})();
