/* Форма отзыва на /otzyvy (круг 87).
 *
 * Отправка — только в прослойку: `${LEADS_BASE}/reviews`. Адрес берётся из
 * shared/leads-endpoint.ts (не хардкодим). Без PUBLIC_LEADS_ENDPOINT форма
 * показывает плашку «Отправка отзывов сейчас недоступна» и ничего не шлёт:
 * своего маршрута /api/reviews у Astro-сервера нет.
 *
 * Отзыв всегда уходит на модерацию — автопубликации нет.
 *
 * Круг 88: разбор ошибок воркера. `POST /reviews` отвечает ПЛОСКО —
 * `{error:'validation', fields:{text:'too_short'}}`, `{error:'consent_version'}`,
 * `{error:'origin'}`, `{error:'too_large'}`, `{error:'rate_limit', retryAfter}`,
 * `{error:'delivery_failed'}`, — а заявки отвечают ВЛОЖЕННО, как у `/leads`:
 * `{error:{code, message, fields}}`. Понимаем оба формата: коды полей
 * переводим в русские тексты, неизвестный код или поле — общее сообщение.
 */
import { LEADS_BASE, leadsFetch, retryAfterSeconds } from '../shared/leads-endpoint.ts';

export const REVIEW_FORM_LIMITS = Object.freeze({
  author: { min: 2, max: 40 },
  text: { min: 20, max: 1500 },
});

const LINK_RE = /(https?:\/\/|www\.)/i;

/** Коды полей воркера → тексты под полем. Ключи — как в `relay/src/validate.ts`
 *  (`consentVersion`), плюс `consent` на случай будущей смены ключа. */
const FIELD_TEXTS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  author: Object.freeze({
    required: 'Укажите имя',
    too_short: 'Имя — от 2 до 40 символов',
    too_long: 'Имя — до 40 символов',
    link_not_allowed: 'Ссылки в имени не нужны — уберите адрес',
  }),
  text: Object.freeze({
    required: 'Напишите текст отзыва',
    too_short: 'Текст — от 20 знаков: что делали и как приняли',
    too_long: 'Текст — до 1500 знаков',
    repeated_lines: 'Похоже на повтор одного и того же — напишите своими словами',
    link_not_allowed: 'Ссылки в отзыве не нужны — уберите http, www, t.me',
  }),
  rating: Object.freeze({
    required: 'Поставьте оценку от 1 до 5',
    out_of_range: 'Поставьте оценку от 1 до 5',
  }),
  consent: Object.freeze({ required: 'Поставьте галочку согласия' }),
  consentVersion: Object.freeze({ required: 'Поставьте галочку согласия' }),
});

/** Код ошибки уровня запроса, разобранный из ответа (плоского или вложенного). */
interface ApiFailure {
  code: string;
  message: string;
  fields: Record<string, string>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** `{…:'code'}` или `{…:['code']}` → `{…:'code'}`; прочее игнорируем. */
function normalizeFields(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const obj = asObject(value);
  if (!obj) return out;
  for (const [key, raw] of Object.entries(obj)) {
    if (typeof raw === 'string' && raw) out[key] = raw;
    else if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0]) out[key] = raw[0];
  }
  return out;
}

/**
 * Плоский `{error:'code', message?, fields?}` и вложенный
 * `{error:{code?,message?,fields?}}` → один вид. Всё остальное — `null`.
 */
export function parseApiFailure(payload: unknown): ApiFailure | null {
  const obj = asObject(payload);
  if (!obj) return null;
  const message = typeof obj.message === 'string' ? obj.message : '';
  const fields = normalizeFields(obj.fields);
  const error = obj.error;
  if (typeof error === 'string') {
    return { code: error, message, fields };
  }
  const inner = asObject(error);
  if (inner) {
    const code = typeof inner.code === 'string' ? inner.code : '';
    const innerMessage = typeof inner.message === 'string' ? inner.message : message;
    return { code, message: innerMessage, fields: normalizeFields(inner.fields ?? obj.fields) };
  }
  if (message) return { code: '', message, fields };
  return null;
}

/**
 * Секунды до следующей попытки: сначала `retry-after`, если его нет — `retryAfter`
 * из тела (прокси иногда срезает заголовок). Разумный диапазон 1–3600, иначе null.
 */
export function parseRetrySeconds(header: string | null, payload: unknown): number | null {
  const sane = (n: number): number | null =>
    Number.isFinite(n) && n >= 1 && n <= 3600 ? Math.round(n) : null;
  const fromHeader = retryAfterSeconds(header);
  if (fromHeader !== null) {
    const ok = sane(fromHeader);
    if (ok !== null) return ok;
  }
  const obj = asObject(payload);
  const flat = obj ? Number(obj.retryAfter) : Number.NaN;
  const nested = asObject(obj?.error) ? Number((obj?.error as Record<string, unknown>).retryAfter) : Number.NaN;
  return sane(flat) ?? sane(nested);
}

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

  /** Тексты, которым нужны контакты страницы: почта (data-email) и телефон (data-phone). */
  function originRejectedText(): string {
    const email = (root.getAttribute('data-email') ?? '').trim();
    if (email && phone) return `Отправка с этого адреса недоступна. Напишите нам на ${email} или позвоните: ${phone}.`;
    if (phone) return `Отправка с этого адреса недоступна. Позвоните нам: ${phone}.`;
    if (email) return `Отправка с этого адреса недоступна. Напишите нам на ${email}.`;
    return 'Отправка с этого адреса недоступна. Попробуйте позже.';
  }

  /** Подсветка полей по кодам воркера; null — ни одного понятного кода. */
  function showFieldErrors(fields: Record<string, string>): HTMLElement | null {
    const byKey: Record<string, HTMLElement | null> = {
      author: nameEl,
      text: textEl,
      rating: stars[0] ?? null,
      consent: consentEl,
      consentVersion: consentEl,
    };
    let first: HTMLElement | null = null;
    for (const [key, code] of Object.entries(fields)) {
      const el = byKey[key];
      if (!el) continue;
      const text = FIELD_TEXTS[key]?.[code];
      if (!text) continue;
      setErr(el, text);
      if (!first) first = el;
    }
    return first;
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

      /* Дальше — только ошибки. Тело может быть любым (прокси, HTML, пусто):
         читаем один раз и работаем с тем, что разобралось. */
      const payload: unknown = await res.json().catch(() => null);
      const failure = parseApiFailure(payload);

      if (res.status === 429) {
        const wait = parseRetrySeconds(res.headers.get('retry-after'), payload);
        fail(wait ? `Слишком часто. Попробуйте через ${wait} с.` : 'Слишком часто. Попробуйте через несколько минут.');
        return;
      }
      if (failure?.code === 'consent_version') {
        fail('Документ согласия обновился. Обновите страницу и подтвердите согласие ещё раз.');
        return;
      }
      if (res.status === 403 || failure?.code === 'origin') {
        fail(originRejectedText());
        return;
      }
      if (res.status === 413 || failure?.code === 'too_large') {
        fail(`Отзыв слишком длинный — сократите до ${REVIEW_FORM_LIMITS.text.max} знаков.`);
        return;
      }
      if (failure?.code === 'delivery_failed') {
        fail(`Не получилось передать отзыв. Попробуйте через минуту${phone ? ` или позвоните: ${phone}` : ''}.`);
        return;
      }

      /* Ошибки полей: код → русский текст. Неизвестное поле или код не
         выдумываем — тогда ниже покажем общее сообщение. */
      const firstBad = failure ? showFieldErrors(failure.fields) : null;
      if (firstBad) {
        setStatus('error', 'Проверьте, пожалуйста, выделенные поля.');
        try { firstBad.focus(); } catch { /* ignore */ }
        return;
      }
      if (failure?.message) {
        fail(failure.message);
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
