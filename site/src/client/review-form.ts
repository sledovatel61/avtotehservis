/* Форма отзыва на /otzyvy (круг 87).
 *
 * Отправка — только в прослойку: `${LEADS_BASE}/reviews`. Адрес берётся из
 * shared/leads-endpoint.ts (не хардкодим). Без PUBLIC_LEADS_ENDPOINT форма
 * показывает плашку «Отправка отзывов сейчас недоступна» и ничего не шлёт:
 * своего маршрута /api/reviews у Astro-сервера нет.
 *
 * Отзыв всегда уходит на модерацию — автопубликации нет.
 */
import { LEADS_BASE, leadsFetch, retryAfterSeconds } from '../shared/leads-endpoint.ts';

export const REVIEW_FORM_LIMITS = Object.freeze({
  author: { min: 2, max: 40 },
  text: { min: 20, max: 1500 },
});

const LINK_RE = /(https?:\/\/|www\.)/i;

const form = document.getElementById('rev-form') as HTMLFormElement | null;
if (form) setup(form);

function setup(root: HTMLFormElement): void {
  const endpoint = LEADS_BASE ? `${LEADS_BASE}/reviews` : '';
  const plate = document.getElementById('rev-unavailable');
  const btn = document.getElementById('rev-send') as HTMLButtonElement | null;
  const status = document.getElementById('rev-status');
  const done = document.getElementById('rev-done');
  const phone = root.getAttribute('data-phone') ?? '';

  const nameEl = document.getElementById('rev-name') as HTMLInputElement | null;
  const textEl = document.getElementById('rev-text') as HTMLTextAreaElement | null;
  const consentEl = document.getElementById('rev-consent') as HTMLInputElement | null;
  const hpEl = document.getElementById('rev-hp') as HTMLInputElement | null;
  const counter = document.getElementById('rev-count');
  const stars = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="rating"]'));
  const consentRow = consentEl?.closest('.consent-row') as HTMLElement | null;

  /* Демо-сборка: прослойки нет — форма честно об этом говорит и не отправляет. */
  if (!endpoint) {
    if (plate) plate.hidden = false;
    if (btn) {
      btn.setAttribute('disabled', 'disabled');
      btn.setAttribute('aria-disabled', 'true');
    }
    return;
  }
  if (plate) plate.hidden = true;

  let busy = false;

  function errBox(el: HTMLElement | null): HTMLElement | null {
    /* у чекбокса согласия «поле» — это .consent-row, у остальных — .field */
    const field = el?.closest('.field, .consent-row') as HTMLElement | null;
    return field ? field.querySelector('.err') : null;
  }

  function setErr(el: HTMLElement | null, msg: string): void {
    const box = errBox(el);
    if (box) {
      box.textContent = msg;
      box.classList.toggle('is-on', msg !== '');
    }
    if (msg) el?.setAttribute('aria-invalid', 'true');
    else el?.removeAttribute('aria-invalid');
    if (el === consentEl && consentRow) consentRow.classList.toggle('is-bad', msg !== '');
  }

  function clearErrs(): void {
    for (const el of [nameEl, textEl, consentEl, stars[0] ?? null]) if (el) setErr(el, '');
  }

  function setStatus(kind: 'idle' | 'sending' | 'error' | 'ok', text: string): void {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = kind;
  }

  function setBusy(on: boolean): void {
    busy = on;
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    btn.textContent = on ? 'Отправляем…' : 'Отправить отзыв';
  }

  function chosenRating(): number {
    const picked = stars.find((s) => s.checked);
    return picked ? Number(picked.value) : 0;
  }

  function validate(): HTMLElement | null {
    const author = (nameEl?.value ?? '').trim();
    if (author.length < REVIEW_FORM_LIMITS.author.min || author.length > REVIEW_FORM_LIMITS.author.max) {
      setErr(nameEl, `Имя — от ${REVIEW_FORM_LIMITS.author.min} до ${REVIEW_FORM_LIMITS.author.max} знаков`);
      return nameEl;
    }
    const rating = chosenRating();
    if (!rating) {
      setErr(stars[0] ?? null, 'Поставьте оценку — от 1 до 5 звёзд');
      return stars[0] ?? null;
    }
    const text = (textEl?.value ?? '').trim();
    if (text.length < REVIEW_FORM_LIMITS.text.min) {
      setErr(textEl, `Расскажите чуть подробнее — минимум ${REVIEW_FORM_LIMITS.text.min} знаков`);
      return textEl;
    }
    if (text.length > REVIEW_FORM_LIMITS.text.max) {
      setErr(textEl, `Слишком длинно — максимум ${REVIEW_FORM_LIMITS.text.max} знаков`);
      return textEl;
    }
    if (LINK_RE.test(text)) {
      setErr(textEl, 'Уберите, пожалуйста, ссылку из текста: отзывы со ссылками не публикуем');
      return textEl;
    }
    if (!consentEl?.checked) {
      setErr(consentEl, 'Без согласия на обработку данных отправить нельзя');
      return consentEl;
    }
    return null;
  }

  function resetFields(): void {
    if (nameEl) nameEl.value = '';
    if (textEl) textEl.value = '';
    if (consentEl) consentEl.checked = false;
    for (const s of stars) s.checked = false;
    if (counter) counter.textContent = `0 / ${REVIEW_FORM_LIMITS.text.max}`;
    clearErrs();
  }

  function succeed(message: string): void {
    resetFields();
    if (done) {
      done.hidden = false;
      done.textContent = message;
    }
    /* сообщение уже в #rev-done (role="status") — не дублируем его в #rev-status,
       иначе скринридер прочитает успех дважды */
    setStatus('idle', '');
    btn?.focus();
  }

  function fail(message: string): void {
    setStatus('error', message);
  }

  async function submit(): Promise<void> {
    if (busy || !endpoint) return;
    if (done) done.hidden = true;
    clearErrs();
    setStatus('idle', '');
    const bad = validate();
    if (bad) {
      setStatus('error', 'Проверьте, пожалуйста, выделенные поля.');
      try { bad.focus(); } catch { /* ignore */ }
      return;
    }
    /* Ловушка для ботов: человек её не видит. Показываем успех, но ничего не шлём. */
    if ((hpEl?.value ?? '').trim() !== '') {
      succeed('Спасибо! Отзыв ушёл на проверку — опубликуем в течение дня.');
      return;
    }

    setBusy(true);
    setStatus('sending', 'Отправляем…');
    try {
      const res = await leadsFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: (nameEl?.value ?? '').trim(),
          text: (textEl?.value ?? '').trim(),
          rating: chosenRating(),
          consent: true,
          consentVersion: root.getAttribute('data-consent-version') ?? '',
          honeypot: '',
          page: '/otzyvy',
        }),
      });
      if (res.status === 201 || res.ok) {
        succeed('Спасибо! Отзыв ушёл на проверку — опубликуем в течение дня.');
        return;
      }
      if (res.status === 429) {
        const wait = retryAfterSeconds(res.headers.get('retry-after'));
        fail(wait ? `Слишком часто. Попробуйте через ${wait} с.` : 'Слишком часто. Попробуйте через несколько минут.');
        return;
      }
      if (res.status === 400) {
        const j = await res.json().catch(() => null) as { error?: { message?: string; fields?: Record<string, string> } } | null;
        const fields = j?.error?.fields ?? {};
        const byKey: Record<string, HTMLElement | null> = { author: nameEl, text: textEl, rating: stars[0] ?? null, consent: consentEl };
        let first: HTMLElement | null = null;
        for (const [key, msg] of Object.entries(fields)) {
          const el = byKey[key] ?? null;
          if (!el) continue;
          setErr(el, String(msg));
          if (!first) first = el;
        }
        if (first) {
          setStatus('error', 'Проверьте, пожалуйста, выделенные поля.');
          try { first.focus(); } catch { /* ignore */ }
        } else {
          fail(j?.error?.message ? String(j.error.message) : 'Отзыв не принят — проверьте текст и оценку.');
        }
        return;
      }
      fail(`Не удалось отправить, попробуйте позже${phone ? ` или позвоните: ${phone}` : ''}.`);
    } catch {
      fail(navigator.onLine === false
        ? 'Похоже, нет соединения. Проверьте интернет и повторите отправку.'
        : `Не удалось отправить, попробуйте позже${phone ? ` или позвоните: ${phone}` : ''}.`);
    } finally {
      setBusy(false);
    }
  }

  textEl?.addEventListener('input', () => {
    if (counter) counter.textContent = `${textEl.value.length} / ${REVIEW_FORM_LIMITS.text.max}`;
    setErr(textEl, '');
  });
  nameEl?.addEventListener('input', () => setErr(nameEl, ''));
  consentEl?.addEventListener('change', () => setErr(consentEl, ''));
  /* Оценка по умолчанию пустая: ни одна звезда не отмечена, пока её не выберут.
     aria-checked держим в синхроне с native-состоянием (стрелки работают штатно,
     радиогруппа — одна на все пять звёзд). */
  function syncStars(): void {
    for (const s of stars) s.setAttribute('aria-checked', s.checked ? 'true' : 'false');
  }
  for (const s of stars) {
    s.addEventListener('change', () => {
      syncStars();
      setErr(stars[0] ?? null, '');
    });
  }
  syncStars();

  /* Кнопка — type="submit": один обработчик на форме, двойной отправки нет. */
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
}
