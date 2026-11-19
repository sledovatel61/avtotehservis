/* Короткая форма контактов: имя, телефон, сообщение, согласие → POST на приёмник заявок
   (kind=message, талон K-…). Адрес берётся из shared/leads-endpoint.ts: свой сервер
   /api/leads в демо-режиме или прослойка Cloudflare Worker при PUBLIC_LEADS_ENDPOINT. */
import { $, track, attachMask } from './lib.ts';
import { leadsUrl, leadsFetch, retryAfterSeconds, relayMode } from '../shared/leads-endpoint.ts';

const form = $('#cform');
if (form) {
  const CONSENT_VERSION = form.getAttribute('data-consent-version') ?? '';
  const cName = $<HTMLInputElement>('#c-name');
  const cPhone = $<HTMLInputElement>('#c-phone');
  const cMsg = $<HTMLTextAreaElement>('#c-msg');
  const cConsent = $<HTMLInputElement>('#c-consent');
  const cSend = $<HTMLButtonElement>('#c-send');
  const hp = $<HTMLInputElement>('#c-hp');
  const box = $('#cform-box');
  const sending = $('#cform-sending');
  const okBox = $('#cform-ok');
  const errBox = $('#cform-err');
  const startedAt = Date.now();
  let idem = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));

  if (cPhone) attachMask(cPhone);

  function setErr(input: HTMLElement | null, msg: string): void {
    const f = input?.closest('.field');
    const span = f ? $('.err', f) : null;
    if (span) span.textContent = msg;
    if (msg) input?.setAttribute('aria-invalid', 'true');
    else input?.removeAttribute('aria-invalid');
  }

  const demoBox = $('#cform-demo');
  /* Задание 80-2 §5: в статике (Pages) <body data-demo="1"> — витрина, сообщение никуда
     не отправляем. Прослойка (relayMode) важнее: там обращение настоящее. В dev атрибута
     нет — поведение прежнее. */
  const isDemo = (): boolean => document.body.dataset.demo === '1' && !relayMode;
  function show(which: 'form' | 'sending' | 'ok' | 'err' | 'demo'): void {
    if (box) box.style.display = which === 'form' ? '' : 'none';
    for (const [el, w] of [[sending, 'sending'], [okBox, 'ok'], [errBox, 'err'], [demoBox, 'demo']] as [HTMLElement | null, string][]) {
      el?.classList.toggle('is-on', w === which);
    }
  }

  function payload(): Record<string, unknown> {
    return {
      name: (cName?.value ?? '').trim(),
      phone: (cPhone?.value ?? '').replace(/\D/g, '').replace(/^8/, '7'),
      contact_method: 'call',
      message: (cMsg?.value ?? '').trim(),
      consent: !!cConsent?.checked,
      consent_version: CONSENT_VERSION,
      page: 'contacts',
      idempotency_key: idem,
      honeypot: hp?.value ?? '',
      form_started_at: startedAt,
    };
  }

  /* ---------- экран ошибки и блокировка повтора (429) ---------- */
  const errHead = $<HTMLElement>('#cform-err b');
  const errHint = $('#cform-err .hint');
  const errRetry = $<HTMLButtonElement>('#c-err-retry');
  const ERR_HEAD = errHead?.textContent ?? '';
  const ERR_HINT = errHint?.textContent ?? '';
  const RETRY_LABEL = errRetry?.textContent ?? 'Вернуться к форме';
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  function resetErrBox(): void {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    if (errHead) errHead.textContent = ERR_HEAD;
    if (errHint) errHint.textContent = ERR_HINT;
    if (errRetry) { errRetry.disabled = false; errRetry.textContent = RETRY_LABEL; }
  }

  /* кнопка «Вернуться к форме» заблокирована, пока не истёк Retry-After */
  function blockRetry(seconds: number): void {
    if (!errRetry) return;
    if (retryTimer) clearInterval(retryTimer);
    let left = Math.max(1, Math.round(seconds));
    const tick = (): void => {
      if (left <= 0) {
        errRetry.disabled = false;
        errRetry.textContent = RETRY_LABEL;
        if (retryTimer) clearInterval(retryTimer);
        retryTimer = null;
        return;
      }
      errRetry.disabled = true;
      errRetry.textContent = `Повторить через ${left} с`;
      left -= 1;
    };
    tick();
    retryTimer = setInterval(tick, 1000);
  }

  function showError(head: string | null, hint: string | null): void {
    if (errHead) errHead.textContent = head ?? ERR_HEAD;
    if (errHint) errHint.textContent = hint ?? ERR_HINT;
    show('err');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let bad: HTMLElement | null = null;
    setErr(cName, ''); setErr(cPhone, ''); setErr(cMsg, ''); setErr(cConsent, '');
    if ((cName?.value ?? '').trim().length < 2) { setErr(cName, 'Укажите имя'); bad = bad ?? cName; }
    if (((cPhone?.value ?? '').replace(/\D/g, '')).length !== 11) { setErr(cPhone, 'Телефон: +7 (999) 999-99-99'); bad = bad ?? cPhone; }
    if ((cMsg?.value ?? '').trim().length < 10) { setErr(cMsg, 'Опишите вопрос — минимум 10 символов'); bad = bad ?? cMsg; }
    if (!cConsent?.checked) { setErr(cConsent, 'Без согласия на обработку данных отправить нельзя'); bad = bad ?? cConsent; }
    if (bad) { try { bad.focus(); } catch { /* ignore */ } track('cform_invalid'); return; }
    void send();
  });

  /* Кнопка «Отправить» в разметке — type="button" (так свёрстано), сама она форму
     не отправляет: без этого обработчика работал только Enter в поле. */
  cSend?.addEventListener('click', () => {
    const f = form as HTMLFormElement;
    if (typeof f.requestSubmit === 'function') f.requestSubmit();
    else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  async function send(): Promise<void> {
    if (retryTimer) return; // ещё идёт блокировка после 429
    track('cform_submit');
    resetErrBox();
    if (isDemo()) { show('demo'); track('cform_demo'); return; }
    show('sending');
    if (cSend) cSend.disabled = true;
    try {
      const r = await leadsFetch(leadsUrl('leads'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const j = await r.json().catch(() => null) as Record<string, unknown> | null;
      /* Контракт 80-1: 201 от сервера прослойки и 200 от Telegram-бота — один экран успеха. */
      if ((r.status === 201 || r.status === 200) && j && typeof j.ticket === 'string') {
        const no = $('#c-ok-no');
        if (no) no.textContent = `№ ${j.ticket}`;
        show('ok');
        track('cform_success', { ticket: j.ticket });
        idem = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
        if (cName) cName.value = '';
        if (cPhone) cPhone.value = '';
        if (cMsg) cMsg.value = '';
        if (cConsent) cConsent.checked = false;
        return;
      }
      if (r.status === 429) {
        const wait = retryAfterSeconds(r.headers.get('retry-after')) ?? 60;
        showError('Слишком много заявок', 'Слишком много заявок с вашего адреса. Повторите позже или позвоните нам.');
        blockRetry(wait);
        track('cform_error', { status: 429, retry_after: wait });
        return;
      }
      if (r.status === 400 && j?.error) {
        const err = j.error as { code?: string; message?: string; fields?: Record<string, string> };
        if (err.code === 'consent_version') {
          show('form');
          setErr(cConsent, err.message ? String(err.message) : 'Форма устарела — обновите страницу и отметьте согласие заново');
          track('cform_error', { code: 'consent_version' });
          return;
        }
        const byKey: Record<string, HTMLElement | null> = { name: cName, phone: cPhone, message: cMsg, consent: cConsent };
        let first: HTMLElement | null = null;
        for (const [k, msg] of Object.entries(err.fields ?? {})) {
          const el = byKey[k];
          if (!el) continue;
          setErr(el, String(msg));
          if (!first) first = el;
        }
        if (first) {
          show('form');
          try { first.focus(); } catch { /* ignore */ }
        } else {
          showError(err.message ? String(err.message) : null, null);
        }
        track('cform_error', { code: err.code ?? 'validation' });
        return;
      }
      showError(null, null);
      track('cform_error', { status: r.status });
    } catch {
      showError(null, navigator.onLine ? null : 'Похоже, нет соединения. Проверьте интернет и повторите отправку.');
      track('cform_error', { status: 'network' });
    } finally {
      if (cSend) cSend.disabled = false;
    }
  }

  $('#c-err-retry')?.addEventListener('click', () => { resetErrBox(); show('form'); });
  /* демо-экран: возврат к форме (поля не стираем — человек может вернуться и посмотреть) */
  $('#c-demo-again')?.addEventListener('click', () => { show('form'); try { cName?.focus(); } catch { /* ignore */ } });
}
