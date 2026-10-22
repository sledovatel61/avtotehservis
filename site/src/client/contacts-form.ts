/* Короткая форма контактов: имя, телефон, сообщение, согласие → POST /api/leads (kind=message, талон K-…). */
import { $, track, attachMask } from './lib.ts';

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

  function show(which: 'form' | 'sending' | 'ok' | 'err'): void {
    if (box) box.style.display = which === 'form' ? '' : 'none';
    for (const [el, w] of [[sending, 'sending'], [okBox, 'ok'], [errBox, 'err']] as [HTMLElement | null, string][]) {
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

  const pBtn = $('#c-payload-btn');
  const pPre = $('#c-payload-pre');
  pBtn?.addEventListener('click', () => {
    const open = pBtn.getAttribute('aria-expanded') === 'true';
    pBtn.setAttribute('aria-expanded', String(!open));
    pBtn.closest('.payload')?.classList.toggle('is-open', !open);
    if (!open && pPre) { pPre.textContent = JSON.stringify(payload(), null, 2); track('payload_view', { page: 'contacts' }); }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let bad: HTMLElement | null = null;
    setErr(cName, ''); setErr(cPhone, ''); setErr(cMsg, ''); setErr(cConsent, '');
    if ((cName?.value ?? '').trim().length < 2) { setErr(cName, 'Укажите имя'); bad = bad ?? cName; }
    if (((cPhone?.value ?? '').replace(/\D/g, '')).length !== 11) { setErr(cPhone, 'Телефон: +7 (999) 999-99-99'); bad = bad ?? cPhone; }
    if ((cMsg?.value ?? '').trim().length < 10) { setErr(cMsg, 'Опишите вопрос — минимум 10 символов'); bad = bad ?? cMsg; }
    if (!cConsent?.checked) { setErr(cConsent, 'Без согласия на обработку данных отправить нельзя'); bad = bad ?? cConsent; }
    if (bad) { try { bad.focus(); } catch { /* ignore */ } track('cform_invalid'); return; }

    track('cform_submit');
    show('sending');
    if (cSend) cSend.disabled = true;
    fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    })
      .then((r) => r.json().catch(() => null).then((j) => ({ r, j })))
      .then(({ r, j }) => {
        if (r.status === 201 && j && typeof j.ticket === 'string') {
          const no = $('#c-ok-no');
          if (no) no.textContent = `№ ${j.ticket}`;
          show('ok');
          track('cform_success', { ticket: j.ticket });
          idem = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
          if (cName) cName.value = '';
          if (cPhone) cPhone.value = '';
          if (cMsg) cMsg.value = '';
          if (cConsent) cConsent.checked = false;
        } else {
          show('err');
          track('cform_error', { status: r.status });
        }
      })
      .catch(() => { show('err'); track('cform_error', { status: 'network' }); })
      .finally(() => { if (cSend) cSend.disabled = false; });
  });

  $('#c-err-retry')?.addEventListener('click', () => show('form'));
}
