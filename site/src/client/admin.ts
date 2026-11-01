/* Админка: прогресс загрузки файлов (XHR) и подтверждения опасных действий. */
(function initAdmin(): void {
  // 1) формы с data-upload: отправка через XHR с прогресс-баром
  document.querySelectorAll<HTMLFormElement>('form[data-upload]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (form.dataset.xhrDone === '1') return; // повторная отправка после XHR — обычная
      const hasFiles = Array.from(form.querySelectorAll('input[type="file"]')).some((f) => (f as HTMLInputElement).files?.length);
      if (!hasFiles) return; // без файлов — обычная отправка
      if (!form.checkValidity()) return; // браузерная валидация
      e.preventDefault();
      const bar = form.querySelector<HTMLElement>('[data-progress], .adm-progress');
      const barFill = bar?.querySelector('i') ?? null;
      const submitBtns = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'));
      submitBtns.forEach((b) => { b.disabled = true; });
      if (bar) { bar.classList.remove('u-none'); bar.setAttribute('aria-hidden', 'false'); }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.getAttribute('action') ?? window.location.href);
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable && barFill) barFill.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`;
      });
      xhr.addEventListener('load', () => {
        // сервер отвечает редиректом — переходим по итоговому URL (в нём ?msg=…)
        const target = xhr.responseURL || window.location.href;
        window.location.href = target;
      });
      xhr.addEventListener('error', () => {
        submitBtns.forEach((b) => { b.disabled = false; });
        if (barFill) barFill.style.width = '100%';
        window.alert('Обрыв связи. Загрузка не удалась — попробуйте снова: файлы не потеряются, форма сохранит значения.');
      });
      // какой кнопкой нажали (publish=1/0) — передаём скрытым полем
      const clicked = form.dataset.lastSubmit;
      if (clicked) {
        const fd0 = new FormData(form);
        const [nm, vl] = clicked.split('=');
        fd0.append(nm, vl);
        xhr.send(fd0);
      } else {
        xhr.send(new FormData(form));
      }
    });
    form.querySelectorAll<HTMLButtonElement>('button[type="submit"][name]').forEach((b) => {
      b.addEventListener('click', () => { form.dataset.lastSubmit = `${b.name}=${b.value}`; });
    });
    form.querySelectorAll<HTMLButtonElement>('button[type="submit"]:not([name])').forEach((b) => {
      b.addEventListener('click', () => { delete form.dataset.lastSubmit; });
    });
  });

  // 2) авто-отправка фильтров (вместо inline onchange — CSP)
  document.querySelectorAll<HTMLElement>('.adm-filters').forEach((box) => {
    box.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      if (!t.matches('select,input[type="date"]')) return;
      const form = t.closest('form');
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      }
    });
  });

  // 3) подтверждения
  document.querySelectorAll<HTMLFormElement>('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.getAttribute('data-confirm') ?? 'Продолжить?')) e.preventDefault();
    });
  });
})();
