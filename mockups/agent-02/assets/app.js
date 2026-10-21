(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const bindSwipe = (node, move) => {
    if (!node) return;
    let start = null,
      startY = null,
      last = null,
      lastY = null,
      lastSwipe = 0;
    const finish = (endX, endY) => {
      if (start === null) return;
      const dx = endX - start,
        dy = endY - startY;
      start = null;
      startY = null;
      last = null;
      lastY = null;
      if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      lastSwipe = Date.now();
      move(dx < 0 ? 1 : -1);
    };
    node.addEventListener(
      "pointerdown",
      (e) => {
        start = last = e.clientX;
        startY = lastY = e.clientY;
      },
      { passive: true },
    );
    node.addEventListener(
      "pointermove",
      (e) => {
        if (start !== null) {
          last = e.clientX;
          lastY = e.clientY;
        }
      },
      { passive: true },
    );
    node.addEventListener("pointerup", (e) => finish(e.clientX, e.clientY), { passive: true });
    node.addEventListener("pointercancel", () => finish(last ?? start, lastY ?? startY), {
      passive: true,
    });
    node.addEventListener(
      "click",
      (e) => {
        if (e.detail && Date.now() - lastSwipe < 450) {
          e.preventDefault();
          e.stopPropagation();
          lastSwipe = 0;
        }
      },
      true,
    );
  };
  const reduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toast = (text) => {
    let el = $("#toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.append(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2800);
  };
  const safeStore = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : fallback;
      } catch (_) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      } catch (_) {
        return false;
      }
    },
    remove(k) {
      try {
        localStorage.removeItem(k);
      } catch (_) {}
    },
  };
  const escapeHTML = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      c === "&"
        ? "&amp;"
        : c === "<"
          ? "&lt;"
          : c === ">"
            ? "&gt;"
            : c === '"'
              ? "&quot;"
              : "&#39;",
    );
  // Full-screen navigation: Esc, click close and a simple focus loop.
  const menu = $("#mobileMenu"),
    menuOpen = $("#menuToggle"),
    menuClose = $("#menuClose");
  let menuReturn = null;
  function setMenu(open) {
    if (!menu) return;
    if (open) {
      menuReturn = document.activeElement;
      menu.inert = false;
      menu.classList.add("open");
      menu.setAttribute("aria-hidden", "false");
      document.body.classList.add("menu-open");
      menuOpen?.setAttribute("aria-expanded", "true");
      menuClose?.focus();
    } else {
      menu.classList.remove("open");
      menu.setAttribute("aria-hidden", "true");
      menu.inert = true;
      document.body.classList.remove("menu-open");
      menuOpen?.setAttribute("aria-expanded", "false");
      menuReturn?.focus?.();
    }
  }
  menuOpen?.addEventListener("click", () => setMenu(true));
  menuClose?.addEventListener("click", () => setMenu(false));
  menu?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  // Shared modal: policy and image lightbox. All content lives locally in the page.
  const backdrop = $("#modalBackdrop");
  let returnFocus = null;
  function modalOpen({ title, body, lightbox = false }) {
    if (!backdrop) return;
    returnFocus = document.activeElement;
    $("#modalTitle").textContent = title || "Информация";
    const box = $("#modalBody");
    box.innerHTML = body || "";
    backdrop.dataset.lightbox = lightbox ? "true" : "false";
    $$("[data-lightbox-controls]", backdrop).forEach((x) => (x.hidden = !lightbox));
    backdrop.inert = false;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("dialog-open");
    $("#modalClose")?.focus();
  }
  function modalClose() {
    if (!backdrop) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.inert = true;
    document.body.classList.remove("dialog-open");
    backdrop.dataset.lightbox = "false";
    $$("[data-lightbox-controls]", backdrop).forEach((x) => (x.hidden = true));
    $("#modalBody").innerHTML = "";
    returnFocus?.focus?.();
  }
  $$("[data-policy]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      modalOpen({
        title: "Политика обработки данных · демо",
        body: '<div class="demo-banner"><strong>Текст-заглушка.</strong><span>Это не юридический документ и не основание для публикации. До запуска оператор должен утвердить цель, состав данных, срок хранения, меры защиты и порядок отзыва согласия.</span></div><p class="modal-copy">Демо-макет показывает место для политики и согласия. Заявки здесь не отправляются, а заполненные поля не покидают ваш браузер.</p>',
      });
    }),
  );
  $("#modalClose")?.addEventListener("click", modalClose);
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) modalClose();
  });
  document.addEventListener("keydown", (e) => {
    if (
      backdrop?.classList.contains("open") &&
      backdrop.dataset.lightbox === "true" &&
      e.key === "ArrowLeft"
    ) {
      e.preventDefault();
      $("#modalPrev")?.click();
      return;
    }
    if (
      backdrop?.classList.contains("open") &&
      backdrop.dataset.lightbox === "true" &&
      e.key === "ArrowRight"
    ) {
      e.preventDefault();
      $("#modalNext")?.click();
      return;
    }
    if (e.key === "Escape") {
      if (backdrop?.classList.contains("open")) modalClose();
      else if (menu?.classList.contains("open")) setMenu(false);
    }
  });
  let lightboxStartX = 0;
  backdrop?.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".modal-art")) lightboxStartX = e.clientX;
  });
  backdrop?.addEventListener("pointerup", (e) => {
    if (
      !backdrop.classList.contains("open") ||
      backdrop.dataset.lightbox !== "true" ||
      !e.target.closest(".modal-art")
    )
      return;
    const dx = e.clientX - lightboxStartX;
    if (Math.abs(dx) > 50) (dx < 0 ? $("#modalNext") : $("#modalPrev"))?.click();
  });
  backdrop?.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = $$(
      "button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
      backdrop,
    ).filter((x) => x.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0],
      last = focusables.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  menu?.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = $$("a[href],button:not([disabled])", menu).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  });
  // Three-slide hero. Stops on hover, focus and reduced-motion; supports swipe.
  const heroSlides = $$(".hero-slide"),
    dots = $$(".hero-dots button");
  let heroIndex = 0,
    heroTimer = null,
    heroPause = false;
  function showHero(i) {
    if (!heroSlides.length) return;
    heroIndex = (i + heroSlides.length) % heroSlides.length;
    heroSlides.forEach((s, n) => {
      const on = n === heroIndex;
      s.classList.toggle("active", on);
      s.setAttribute("aria-hidden", String(!on));
      s.inert = !on;
      s.querySelector("h1")?.setAttribute("tabindex", on ? "0" : "-1");
    });
    dots.forEach((d, n) => {
      d.setAttribute("aria-current", String(n === heroIndex));
      d.setAttribute("aria-label", `Слайд ${n + 1} из ${heroSlides.length}`);
    });
    const bar = $(".hero-progress span");
    if (bar) {
      bar.classList.remove("running");
      void bar.offsetWidth;
      if (!reduced && !heroPause) bar.classList.add("running");
    }
  }
  function heroStop() {
    clearInterval(heroTimer);
    heroTimer = null;
    $(".hero-progress span")?.classList.remove("running");
  }
  function heroStart() {
    heroStop();
    if (!reduced && !heroPause && heroSlides.length > 1)
      heroTimer = setInterval(() => showHero(heroIndex + 1), 8000);
  }
  $("#heroPrev")?.addEventListener("click", () => {
    showHero(heroIndex - 1);
    heroStart();
  });
  $("#heroNext")?.addEventListener("click", () => {
    showHero(heroIndex + 1);
    heroStart();
  });
  dots.forEach((d, i) =>
    d.addEventListener("click", () => {
      showHero(i);
      heroStart();
    }),
  );
  const hero = $(".hero");
  hero?.addEventListener("mouseenter", () => {
    heroPause = true;
    heroStop();
  });
  hero?.addEventListener("mouseleave", () => {
    heroPause = false;
    heroStart();
  });
  hero?.addEventListener("focusin", () => {
    heroPause = true;
    heroStop();
  });
  hero?.addEventListener("focusout", (e) => {
    if (!hero.contains(e.relatedTarget)) {
      heroPause = false;
      heroStart();
    }
  });
  bindSwipe(hero, (direction) => {
    showHero(heroIndex + direction);
    heroStart();
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? heroStop() : heroStart()));
  if (heroSlides.length) {
    showHero(0);
    heroStart();
  }
  // Reveal only decorative entrances; content remains visible without IntersectionObserver.
  if (!reduced && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((x) => {
          if (x.isIntersecting) {
            x.target.classList.add("in-view");
            observer.unobserve(x.target);
          }
        }),
      { threshold: 0.12 },
    );
    $$(".inline-reveal").forEach((x) => observer.observe(x));
  } else $$(".inline-reveal").forEach((x) => x.classList.add("in-view"));
  const sticky = $("#stickyCta");
  if (sticky) {
    const updateSticky = () =>
      sticky.classList.toggle("visible", window.scrollY > window.innerHeight * 0.58);
    window.addEventListener("scroll", updateSticky, { passive: true });
    updateSticky();
  }
  // Gallery carousel and accessible lightbox.
  const galleryNode = $("#galleryTrack");
  safeStore.get("ats-demo-published-works", []).forEach((item) => {
    if (!galleryNode || !item.data) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "work-card";
    b.dataset.work = "";
    b.setAttribute("aria-label", `Открыть демо-кейс: ${item.title}`);
    b.innerHTML = `<span class="work-image"><img src="${item.data}" alt="Пользовательское изображение из локальной демо-панели"><span class="demo-label">ДЕМО · ЛОКАЛЬНО</span></span><span class="work-caption"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.caption)}</span></span>`;
    galleryNode.append(b);
  });
  const galleryTrack = $("#galleryTrack"),
    works = $$(".work-card[data-work]", galleryTrack || document),
    empty = $("#emptyGallery"),
    galleryStatus = $("#galleryStatus");
  let workOffset = 0,
    modalWorkIndex = 0;
  function galleryStep() {
    return window.matchMedia("(max-width:760px)").matches ? 1 : 3;
  }
  function renderGallery() {
    if (!galleryTrack || !works.length) return;
    const count = galleryStep(),
      last = Math.max(0, works.length - count);
    workOffset = Math.min(workOffset, last);
    const cardWidth = works[0]?.getBoundingClientRect().width || 0,
      gap = parseFloat(getComputedStyle(galleryTrack).gap) || 0;
    if (galleryTrack)
      galleryTrack.style.transform = `translateX(${-workOffset * (cardWidth + gap)}px)`;
    works.forEach((card, i) => {
      const visible = i >= workOffset && i < workOffset + count;
      card.setAttribute("aria-hidden", String(!visible));
      card.tabIndex = visible ? 0 : -1;
    });
    if (galleryStatus)
      galleryStatus.textContent = `Работы ${Math.min(workOffset + 1, works.length)}–${Math.min(workOffset + count, works.length)} из ${works.length}`;
    const prev = $("#galleryPrev"),
      next = $("#galleryNext");
    if (prev) prev.disabled = workOffset === 0;
    if (next) next.disabled = workOffset >= last;
  }
  $("#galleryPrev")?.addEventListener("click", () => {
    workOffset = Math.max(0, workOffset - galleryStep());
    renderGallery();
  });
  $("#galleryNext")?.addEventListener("click", () => {
    workOffset = Math.min(Math.max(0, works.length - galleryStep()), workOffset + galleryStep());
    renderGallery();
  });
  window.addEventListener("resize", renderGallery);
  renderGallery();
  bindSwipe(galleryTrack?.parentElement, (direction) => {
    workOffset = Math.max(
      0,
      Math.min(Math.max(0, works.length - galleryStep()), workOffset + direction * galleryStep()),
    );
    renderGallery();
  });
  $("#galleryEmptyToggle")?.addEventListener("click", (e) => {
    const show = empty?.classList.toggle("show");
    if (galleryTrack) galleryTrack.hidden = Boolean(show);
    ["#galleryPrev", "#galleryNext"].forEach((selector) => {
      const button = $(selector);
      if (button) button.disabled = Boolean(show);
    });
    if (empty) empty.setAttribute("aria-hidden", String(!show));
    e.currentTarget.setAttribute("aria-pressed", String(Boolean(show)));
    e.currentTarget.textContent = show ? "Вернуться к демо-карточкам" : "Показать пустое состояние";
    if (galleryStatus)
      galleryStatus.textContent = show ? "Пока нет опубликованных работ. Это демо-состояние." : "";
  });
  function openWork(card, index = 0) {
    modalWorkIndex = index;
    const image = $("img", card),
      caption = $("strong", card)?.textContent || "Демо-кейс";
    modalOpen({
      title: caption,
      lightbox: true,
      body: `<div class="modal-art"><img src="${image?.getAttribute("src") || ""}" alt="${(image?.alt || "Графическая заглушка").replaceAll('"', "&quot;")}"></div><p class="modal-copy">Демонстрационная графическая заглушка. Не фотография реальной работы; перед публикацией нужны собственные кадры и согласованная подпись.</p>`,
    });
  }
  works.forEach((c, i) => c.addEventListener("click", () => openWork(c, i)));
  $("#modalPrev")?.addEventListener("click", () => {
    modalWorkIndex = (modalWorkIndex - 1 + works.length) % works.length;
    openWork(works[modalWorkIndex], modalWorkIndex);
  });
  $("#modalNext")?.addEventListener("click", () => {
    modalWorkIndex = (modalWorkIndex + 1) % works.length;
    openWork(works[modalWorkIndex], modalWorkIndex);
  });
  // Six-card services carousel on the home page.
  const serviceTrack = $("#serviceTrack"),
    serviceCards = $$(".service-card", serviceTrack || document);
  let serviceOffset = 0;
  function serviceStep() {
    return window.matchMedia("(max-width:760px)").matches
      ? 1
      : window.matchMedia("(max-width:1080px)").matches
        ? 2
        : 3;
  }
  function renderServices() {
    if (!serviceTrack || !serviceCards.length) return;
    const count = serviceStep(),
      last = Math.max(0, serviceCards.length - count);
    serviceOffset = Math.min(serviceOffset, last);
    const width = serviceCards[0].getBoundingClientRect().width,
      gap = parseFloat(getComputedStyle(serviceTrack).gap) || 0;
    serviceTrack.style.transform = `translateX(${-serviceOffset * (width + gap)}px)`;
    serviceCards.forEach((c, i) => {
      const visible = i >= serviceOffset && i < serviceOffset + count;
      c.setAttribute("aria-hidden", String(!visible));
      c.querySelector("a")?.setAttribute("tabindex", visible ? "0" : "-1");
    });
    const status = $("#serviceStatus");
    if (status)
      status.textContent = `Направления ${serviceOffset + 1}–${Math.min(serviceOffset + count, serviceCards.length)} из ${serviceCards.length}`;
    const prev = $("#servicePrev"),
      next = $("#serviceNext");
    if (prev) prev.disabled = serviceOffset === 0;
    if (next) next.disabled = serviceOffset >= last;
  }
  $("#servicePrev")?.addEventListener("click", () => {
    serviceOffset = Math.max(0, serviceOffset - serviceStep());
    renderServices();
  });
  $("#serviceNext")?.addEventListener("click", () => {
    serviceOffset += serviceStep();
    renderServices();
  });
  window.addEventListener("resize", renderServices);
  renderServices();
  bindSwipe(serviceTrack?.parentElement, (direction) => {
    serviceOffset = Math.max(
      0,
      Math.min(
        Math.max(0, serviceCards.length - serviceStep()),
        serviceOffset + direction * serviceStep(),
      ),
    );
    renderServices();
  });
  // Review carousel: transform-based, three cards wide on desktop and one on mobile.
  const reviewTrack = $("#reviewTrack"),
    reviewCards = $$(".review-card", reviewTrack || document);
  let reviewIndex = 0;
  function renderReviews() {
    if (!reviewTrack || !reviewCards.length) return;
    const mobile = window.matchMedia("(max-width:760px)").matches;
    const last = Math.max(0, reviewCards.length - (mobile ? 1 : 3));
    reviewIndex = Math.min(reviewIndex, last);
    const first = reviewCards[0];
    const step = (first?.getBoundingClientRect().width || 0) + 12;
    reviewTrack.style.transform = `translateX(${-reviewIndex * step}px)`;
    const count = mobile ? 1 : 3;
    reviewCards.forEach((c, i) => {
      c.setAttribute("aria-hidden", String(i < reviewIndex || i >= reviewIndex + count));
    });
    const prev = $("#reviewPrev"),
      next = $("#reviewNext");
    if (prev) prev.disabled = reviewIndex === 0;
    if (next) next.disabled = reviewIndex >= last;
  }
  $("#reviewPrev")?.addEventListener("click", () => {
    reviewIndex = Math.max(0, reviewIndex - 1);
    renderReviews();
  });
  $("#reviewNext")?.addEventListener("click", () => {
    reviewIndex++;
    renderReviews();
  });
  window.addEventListener("resize", renderReviews);
  renderReviews();
  bindSwipe(reviewTrack?.parentElement, (direction) => {
    reviewIndex = Math.max(
      0,
      Math.min(
        Math.max(0, reviewCards.length - (window.matchMedia("(max-width:760px)").matches ? 1 : 3)),
        reviewIndex + direction,
      ),
    );
    renderReviews();
  });
  // FAQ toggles.
  $$(".faq-question").forEach((btn) =>
    btn.addEventListener("click", () => {
      const answer = $("#" + btn.getAttribute("aria-controls"));
      const open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      if (answer) answer.hidden = !open;
      const mark = $(".faq-mark", btn);
      if (mark) mark.textContent = open ? "−" : "+";
    }),
  );
  // News category filter and three-card pagination.
  const newsCards = $$(".news-card"),
    filterBtns = $$(".filter-chip[data-filter]"),
    pages = $$(".pagination button[data-page]");
  let newsFilter = "all",
    newsPage = 1;
  function renderNews() {
    if (!newsCards.length) return;
    const filtered = newsCards.filter(
      (c) => newsFilter === "all" || c.dataset.category === newsFilter,
    );
    const pageSize = 3,
      total = Math.max(1, Math.ceil(filtered.length / pageSize));
    newsPage = Math.min(newsPage, total);
    newsCards.forEach((c) => (c.hidden = true));
    filtered
      .slice((newsPage - 1) * pageSize, newsPage * pageSize)
      .forEach((c) => (c.hidden = false));
    pages.forEach((p) => {
      const n = Number(p.dataset.page);
      p.hidden = n > total;
      p.setAttribute("aria-current", String(n === newsPage));
    });
    const status = $("#newsStatus");
    if (status)
      status.textContent = `Показаны демо-материалы ${filtered.length ? (newsPage - 1) * pageSize + 1 : 0}–${Math.min(newsPage * pageSize, filtered.length)} из ${filtered.length}`;
  }
  filterBtns.forEach((b) =>
    b.addEventListener("click", () => {
      newsFilter = b.dataset.filter;
      newsPage = 1;
      filterBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderNews();
    }),
  );
  pages.forEach((b) =>
    b.addEventListener("click", () => {
      newsPage = Number(b.dataset.page);
      renderNews();
    }),
  );
  renderNews();
  // Shared contact form: local demonstration only.
  function phoneFormat(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    if (d.length === 10) d = "7" + d;
    if (d.length === 11 && d[0] === "7") d = d.slice(1);
    d = d.slice(0, 10);
    let s = "+7";
    if (d.length) s += " (" + d.slice(0, 3);
    if (d.length >= 3) s += ")";
    if (d.length > 3) s += " " + d.slice(3, 6);
    if (d.length > 6) s += "-" + d.slice(6, 8);
    if (d.length > 8) s += "-" + d.slice(8, 10);
    return s;
  }
  $$("input[type=tel]").forEach((el) => {
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      el.value = phoneFormat(el.value);
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch (_) {}
    });
  });
  function markField(el, msg) {
    const field = el?.closest(".field");
    if (!field) return;
    const err = $(".field-error", field);
    el.setAttribute("aria-invalid", String(Boolean(msg)));
    if (err) err.textContent = msg || "";
  }
  $$("[data-contact-form]").forEach((form) =>
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("[name=name]", form),
        phone = $("[name=phone]", form),
        message = $("[name=message]", form),
        consent = $("[name=consent]", form),
        status = $(".form-status", form);
      let ok = true;
      if (!name?.value.trim()) {
        markField(name, "Введите имя.");
        ok = false;
      } else markField(name, "");
      const digits = (phone?.value || "").replace(/\D/g, "");
      if (digits.length !== 11) {
        markField(phone, "Введите номер из 10 цифр.");
        ok = false;
      } else markField(phone, "");
      if (message && !message.value.trim()) {
        markField(message, "Напишите короткое сообщение.");
        ok = false;
      } else if (message) markField(message, "");
      if (consent && !consent.checked) {
        if (status) {
          status.textContent = "Отметьте согласие, чтобы продолжить демо.";
          status.classList.add("error");
        }
        ok = false;
      }
      if (!ok) {
        (form.querySelector("[aria-invalid=true]") || consent)?.focus?.();
        return;
      }
      const submit = $("button[type=submit]", form);
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Проверяем…";
      }
      if (status) {
        status.classList.remove("error");
        status.textContent = "Демо: данные никуда не отправляются.";
      }
      setTimeout(() => {
        if (status)
          status.textContent =
            "Проверка формы пройдена. Реальная отправка в этом мокапе выключена.";
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Проверить форму";
        }
      }, 650);
    }),
  );
  // Five-step appointment wizard: local draft, validation, payload preview, idempotent demo retry.
  const wizard = $("#appointmentWizard");
  if (wizard) {
    const steps = $$(".wizard-step", wizard),
      stepLabel = $("#wizardStepLabel"),
      bar = $("#wizardProgress"),
      back = $("#wizardBack"),
      next = $("#wizardNext"),
      submit = $("#wizardSubmit"),
      status = $("#wizardStatus"),
      success = $("#successTicket"),
      errorBox = $("#errorTicket"),
      payloadPanel = $("#payloadPanel");
    let step = 0,
      forceError = false,
      sending = false,
      idempotencyKey = null;
    const draftKey = "ats-demo-appointment-v1";
    const field = (n) => $(`[name="${n}"]`, wizard);
    const checked = (n) => $$(`[name="${n}"]:checked`, wizard);
    const setError = (n, msg) => markField(field(n), msg);
    const getValue = (n) => field(n)?.value?.trim() || "";
    const loadDraft = () => {
      const d = safeStore.get(draftKey, {});
      ["brand", "model", "year", "vin", "mileage", "name", "phone", "message"].forEach((k) => {
        if (d[k] && field(k)) field(k).value = d[k];
      });
      if (d.vinUnknown && field("vinUnknown")) field("vinUnknown").checked = true;
      if (d.yearUnknown && field("yearUnknown")) field("yearUnknown").checked = true;
      if (d.mileageUnknown && field("mileageUnknown")) field("mileageUnknown").checked = true;
      if (d.asap && field("asap")) field("asap").checked = true;
      if (d.contact_method && field(d.contact_method)) field(d.contact_method).checked = true;
      d.services?.forEach((v) => {
        const c = $$('[name="services"]', wizard).find((x) => x.value === v);
        if (c) c.checked = true;
      });
      if (d.consent && field("consent")) field("consent").checked = true;
    };
    const saveDraft = () => {
      const d = {};
      ["brand", "model", "year", "vin", "mileage", "name", "phone", "message"].forEach(
        (k) => (d[k] = getValue(k)),
      );
      d.vinUnknown = Boolean(field("vinUnknown")?.checked);
      d.yearUnknown = Boolean(field("yearUnknown")?.checked);
      d.mileageUnknown = Boolean(field("mileageUnknown")?.checked);
      d.asap = Boolean(field("asap")?.checked);
      d.contact_method = field("contact_method:telegram")?.checked
        ? "contact_method:telegram"
        : "contact_method:call";
      d.services = checked("services").map((x) => x.value);
      d.consent = Boolean(field("consent")?.checked);
      safeStore.set(draftKey, d);
    };
    function selectedDate() {
      return $("input[name=preferred_date]:checked", wizard)?.value || "";
    }
    function selectedSlot() {
      return $(".time-slot[aria-pressed=true]", wizard)?.dataset.slot || "";
    }
    function validity(n, show = true) {
      let good = true;
      const fail = (name, msg) => {
        good = false;
        if (show) setError(name, msg);
      };
      if (n === 0) {
        const brand = getValue("brand");
        if (!brand) fail("brand", "Укажите марку или выберите «Другая».");
        else setError("brand", "");
        const year = getValue("year");
        if (
          year &&
          !field("yearUnknown")?.checked &&
          (!/^\d{4}$/.test(year) || Number(year) < 1980 || Number(year) > 2026)
        )
          fail("year", "Введите год от 1980 до 2026.");
        else setError("year", "");
        const vin = getValue("vin").toUpperCase();
        if (vin && !field("vinUnknown")?.checked && !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))
          fail("vin", "VIN — 17 символов; I, O и Q не используются.");
        else setError("vin", "");
        const mileage = getValue("mileage");
        if (mileage && !field("mileageUnknown")?.checked && !/^\d{1,7}$/.test(mileage))
          fail("mileage", "Укажите пробег цифрами или отметьте «не знаю».");
        else setError("mileage", "");
      }
      if (n === 1) {
        const firstService = $('[name="services"]', wizard);
        const missingService = !checked("services").length;
        if (firstService) firstService.setAttribute("aria-invalid", String(missingService));
        if (missingService) good = false;
      }
      if (n === 2) {
        const missingTime = !field("asap")?.checked && (!selectedDate() || !selectedSlot());
        const firstSlot = $(".time-slot:not(:disabled)", wizard);
        if (firstSlot) firstSlot.setAttribute("aria-invalid", String(missingTime));
        if (missingTime) good = false;
      }
      if (n === 3) {
        const name = getValue("name"),
          digits = (field("phone")?.value || "").replace(/\D/g, "");
        if (!name) fail("name", "Введите имя.");
        else setError("name", "");
        if (digits.length !== 11) fail("phone", "Введите номер из 10 цифр после +7.");
        else setError("phone", "");
        const consent = field("consent");
        const missingConsent = !consent?.checked;
        consent?.setAttribute("aria-invalid", String(missingConsent));
        if (missingConsent) good = false;
      }
      return good;
    }
    function focusFirstInvalid(n) {
      let target = null;
      if (n === 0) {
        if (!getValue("brand")) target = field("brand");
        else if (
          getValue("year") &&
          !field("yearUnknown")?.checked &&
          (!/^\d{4}$/.test(getValue("year")) ||
            Number(getValue("year")) < 1980 ||
            Number(getValue("year")) > 2026)
        )
          target = field("year");
        else if (
          getValue("vin") &&
          !field("vinUnknown")?.checked &&
          !/^[A-HJ-NPR-Z0-9]{17}$/.test(getValue("vin").toUpperCase())
        )
          target = field("vin");
        else if (
          getValue("mileage") &&
          !field("mileageUnknown")?.checked &&
          !/^\d{1,7}$/.test(getValue("mileage"))
        )
          target = field("mileage");
      } else if (n === 1 && !checked("services").length) target = $('[name="services"]', wizard);
      else if (n === 2 && !field("asap")?.checked && (!selectedDate() || !selectedSlot()))
        target = $(".time-slot:not(:disabled)", wizard);
      else if (n === 3) {
        if (!getValue("name")) target = field("name");
        else if ((field("phone")?.value || "").replace(/\D/g, "").length !== 11)
          target = field("phone");
        else if (!field("consent")?.checked) target = field("consent");
      }
      target?.focus();
    }
    function update() {
      steps.forEach((x, i) => {
        x.hidden = i !== step;
        x.setAttribute("aria-hidden", String(i !== step));
      });
      if (stepLabel) stepLabel.textContent = `Шаг ${step + 1} из 5`;
      if (bar) {
        bar.setAttribute("aria-valuenow", String(step + 1));
        const fill = $("span", bar);
        if (fill) fill.style.transform = `scaleX(${(step + 1) / 5})`;
      }
      if (back) back.disabled = step === 0;
      if (next) next.hidden = step === 4;
      if (submit) submit.hidden = step !== 4;
      const good = validity(step, false);
      if (next) next.disabled = !good;
      if (submit) submit.disabled = !validity(3, false) || sending;
      if (status) {
        status.textContent = good
          ? ""
          : step === 1
            ? "Выберите хотя бы одну услугу или «нужна диагностика»."
            : step === 2
              ? "Выберите дату и время либо «как можно скорее»."
              : step === 3
                ? "Заполните имя, телефон и отметьте согласие."
                : "";
        status.classList.toggle("error", !good);
      }
      if (step === 4) renderSummary();
      saveDraft();
    }
    function renderSummary() {
      const box = $("#appointmentSummary");
      if (!box) return;
      idempotencyKey = idempotencyKey || createIdempotencyKey();
      const services = checked("services").map((x) => x.dataset.label || x.value);
      const items = [
        [
          "Автомобиль",
          [
            getValue("brand"),
            getValue("model"),
            getValue("year") && !field("yearUnknown")?.checked ? getValue("year") : "",
          ]
            .filter(Boolean)
            .join(" ") || "Марка указана позже",
        ],
        ["VIN", field("vinUnknown")?.checked ? "Не знаю" : getValue("vin") || "Не указан"],
        [
          "Пробег",
          field("mileageUnknown")?.checked
            ? "Не знаю"
            : getValue("mileage")
              ? `${getValue("mileage")} км`
              : "Не указан",
        ],
        ["Что нужно", services.join(", ") || "Нужна диагностика"],
        [
          "Когда",
          field("asap")?.checked ? "Как можно скорее" : `${selectedDate()} · ${selectedSlot()}`,
        ],
        ["Контакт", `${getValue("name")} · ${field("phone")?.value || ""}`],
        ["Способ связи", field("contact_method:telegram")?.checked ? "Telegram" : "Звонок"],
      ];
      box.innerHTML = items
        .map(
          ([a, b]) =>
            `<div class="summary-row"><strong>${a}</strong><span>${escapeHTML(b)}</span></div>`,
        )
        .join("");
      const payload = {
        name: getValue("name"),
        phone: "+" + (field("phone")?.value || "").replace(/\D/g, "").replace(/^8/, "7"),
        contact_method: field("contact_method:telegram")?.checked ? "telegram" : "call",
        car: {
          brand: getValue("brand"),
          model: getValue("model") || null,
          year:
            getValue("year") && !field("yearUnknown")?.checked ? Number(getValue("year")) : null,
          vin: field("vinUnknown")?.checked ? null : getValue("vin") || null,
          mileage:
            getValue("mileage") && !field("mileageUnknown")?.checked
              ? Number(getValue("mileage"))
              : null,
        },
        services: services.length ? checked("services").map((x) => x.value) : ["diagnostics"],
        preferred: {
          date: field("asap")?.checked ? null : selectedDate() || null,
          slot: field("asap")?.checked ? null : selectedSlot() || null,
          asap: Boolean(field("asap")?.checked),
        },
        photos_count: uploadedFiles.length,
        consent: Boolean(field("consent")?.checked),
        page: "appointment",
        idempotency_key: idempotencyKey || "создаётся один раз при демо-отправке",
      };
      if (payloadPanel) payloadPanel.textContent = JSON.stringify(payload, null, 2);
    }
    let uploadedFiles = [];
    const fileInput = field("photos"),
      fileList = $("#fileList");
    function renderFiles() {
      if (!fileList) return;
      fileList.innerHTML = "";
      uploadedFiles.forEach((f, i) => {
        const chip = document.createElement("span");
        chip.className = "file-chip";
        chip.innerHTML = `<img src="${f.url}" alt=""><span>${escapeHTML(f.name)}</span><button type="button" aria-label="Удалить ${escapeHTML(f.name)}" data-remove-file="${i}">×</button>`;
        fileList.append(chip);
      });
      fileList.querySelectorAll("[data-remove-file]").forEach((b) =>
        b.addEventListener("click", () => {
          const removed = uploadedFiles.splice(Number(b.dataset.removeFile), 1)[0];
          if (removed?.url) URL.revokeObjectURL(removed.url);
          renderFiles();
          update();
        }),
      );
    }
    fileInput?.addEventListener("change", () => {
      const incoming = Array.from(fileInput.files || []);
      const left = Math.max(0, 3 - uploadedFiles.length);
      uploadedFiles.push(
        ...incoming
          .slice(0, left)
          .map((file) => ({ file, name: file.name, url: URL.createObjectURL(file) })),
      );
      if (incoming.length > left) toast("Можно добавить не больше трёх файлов.");
      renderFiles();
      fileInput.value = "";
      update();
    });
    function makeDates() {
      const container = $("#dateStrip");
      if (!container) return;
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      container.innerHTML = "";
      const weekdays = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
      for (let i = 0; i < 14; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const id = `appt-date-${i}`;
        const wrap = document.createElement("div");
        wrap.className = "date-option";
        wrap.innerHTML = `<input type="radio" name="preferred_date" id="${id}" value="${value}" ${i === 0 ? "checked" : ""}><label for="${id}">${weekdays[date.getDay()]}<span>${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}</span></label>`;
        container.append(wrap);
      }
      container.addEventListener("change", update);
      const slots = $("#timeSlots");
      if (slots) {
        slots.innerHTML = "";
        for (let h = 9; h <= 19; h++) {
          const time = `${String(h).padStart(2, "0")}:00`;
          const busy = h === 11 || h === 15;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "time-slot";
          b.textContent = busy ? `${time} · занято` : time;
          b.dataset.slot = time;
          b.disabled = busy;
          b.setAttribute("aria-label", busy ? `${time}, демо-слот занят` : `Выбрать ${time}`);
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", () => {
            slots
              .querySelectorAll(".time-slot")
              .forEach((x) => x.setAttribute("aria-pressed", "false"));
            b.setAttribute("aria-pressed", "true");
            if (field("asap")) field("asap").checked = false;
            update();
          });
          slots.append(b);
        }
      }
    }
    function updateTimeDisabled() {
      const asap = Boolean(field("asap")?.checked);
      $$(".date-option input,.time-slot", wizard).forEach((x) => {
        if (!x.matches(".time-slot")) x.disabled = asap;
      });
      $$(".time-slot", wizard).forEach(
        (x) => (x.disabled = asap || x.dataset.slot === "11:00" || x.dataset.slot === "15:00"),
      );
      if (asap) {
        $$(".time-slot", wizard).forEach((x) => x.setAttribute("aria-pressed", "false"));
      }
    }
    loadDraft();
    makeDates();
    $$("[name=vin]", wizard).forEach((el) =>
      el.addEventListener("input", () => {
        el.value = el.value
          .toUpperCase()
          .replace(/[^A-HJ-NPR-Z0-9]/g, "")
          .slice(0, 17);
        update();
      }),
    );
    field("asap")?.addEventListener("change", () => {
      updateTimeDisabled();
      update();
    });
    $$("input,select,textarea", wizard).forEach((el) => {
      el.addEventListener("input", () => {
        if (el.name === "phone") el.value = phoneFormat(el.value);
        update();
      });
      el.addEventListener("change", () => {
        if (el.name === "phone") el.value = phoneFormat(el.value);
        update();
      });
      el.addEventListener("blur", () => {
        if (
          [
            "brand",
            "year",
            "vin",
            "mileage",
            "name",
            "phone",
            "services",
            "preferred_date",
            "asap",
            "consent",
          ].includes(el.name)
        ) {
          if (!validity(step, true)) focusFirstInvalid(step);
        }
      });
    });
    updateTimeDisabled();
    update();
    back?.addEventListener("click", () => {
      if (step > 0) {
        step--;
        errorBox?.classList.remove("show");
        update();
        $(".wizard-step:not([hidden]) h2")?.focus?.();
      }
    });
    next?.addEventListener("click", () => {
      if (!validity(step, true)) {
        focusFirstInvalid(step);
        update();
        return;
      }
      if (step < 4) {
        step++;
        update();
        $(".wizard-step:not([hidden]) h2")?.focus?.();
      }
    });
    $("#payloadToggle")?.addEventListener("click", (e) => {
      const open = payloadPanel?.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", String(Boolean(open)));
      e.currentTarget.textContent = open ? "Скрыть JSON payload" : "Что уйдёт на сервер";
    });
    $("#demoError")?.addEventListener("click", () => {
      forceError = true;
      submit?.focus();
      toast("Следующая демо-отправка покажет ошибку без потери данных.");
    });
    function createIdempotencyKey() {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
      const bytes = new Uint8Array(16);
      if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    function buildTicket() {
      return (
        "DEMO-" +
        new Date().toISOString().slice(0, 10).replaceAll("-", "") +
        "-" +
        Math.floor(100 + Math.random() * 900)
      );
    }
    submit?.addEventListener("click", () => {
      if (step !== 4 || sending) return;
      if (!validity(3, true)) {
        focusFirstInvalid(3);
        return;
      }
      sending = true;
      idempotencyKey = idempotencyKey || createIdempotencyKey();
      update();
      submit.textContent = "Проверяем…";
      status.textContent = "Демо: имитируем ответ сервера, данные не отправляются.";
      setTimeout(() => {
        sending = false;
        if (forceError) {
          forceError = false;
          errorBox?.classList.add("show");
          status.textContent =
            "Демо-ошибка. Ответ не получен; введённые поля и черновик сохранены.";
          status.classList.add("error");
          submit.disabled = false;
          submit.textContent = "Повторить демо";
          return;
        }
        errorBox?.classList.remove("show");
        if (success) {
          success.classList.add("show");
          $("#ticketNumber").textContent = buildTicket();
          success.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
        }
        status.classList.remove("error");
        status.textContent = "Демо завершено: сетевого запроса не было.";
        submit.hidden = true;
        safeStore.remove(draftKey);
        sending = false;
      }, 820);
    });
  }
  // Optional local admin demo: image preview and session-only publication to a gallery.
  const adminForm = $("#adminPublishForm");
  if (adminForm) {
    const input = $("#adminImage"),
      preview = $("#adminImagePreview"),
      publishStatus = $("#adminPublishStatus");
    let selectedImage = null;
    input?.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast("Выберите изображение.");
        input.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      selectedImage = { file, url };
      if (preview) {
        preview.src = url;
        preview.hidden = false;
      }
      $("#adminFileName").textContent = file.name;
      publishStatus.textContent = "Предпросмотр локальный: файл пока никуда не загружен.";
    });
    adminForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!selectedImage) {
        publishStatus.textContent = "Добавьте изображение для предпросмотра.";
        return;
      }
      const title = $("#adminWorkTitle").value.trim(),
        caption = $("#adminWorkCaption").value.trim();
      if (!title || !caption) {
        publishStatus.textContent = "Заполните название и подпись.";
        return;
      }
      const c = document.createElement("canvas"),
        ctx = c.getContext("2d"),
        img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 640 / img.width);
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL("image/jpeg", 0.76);
        const stored = safeStore.get("ats-demo-published-works", []);
        stored.push({ title, caption, data, demo: true });
        const ok = safeStore.set("ats-demo-published-works", stored);
        publishStatus.textContent = ok
          ? "Добавлено в демонстрационную галерею этого браузера. В сеть файл не отправлялся."
          : "Предпросмотр и карточка доступны только в текущем открытом демо-экране: хранилище браузера недоступно.";
        const row = document.createElement("div");
        row.className = "admin-preview";
        row.innerHTML = `<img src="${data}" alt="Предпросмотр загруженного файла"><p><strong>${escapeHTML(title)}</strong><br>${escapeHTML(caption)}<br><span class="demo-label">Демо · ${ok ? "сохранено локально" : "текущая сессия"}</span></p>`;
        $("#adminPublishedList")?.prepend(row);
        adminForm.reset();
        if (preview) {
          preview.hidden = true;
          preview.removeAttribute("src");
        }
        selectedImage = null;
        toast(ok ? "Демо-карточка сохранена локально." : "Карточка добавлена в текущую сессию.");
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () =>
        (publishStatus.textContent = "Не удалось прочитать файл в этом браузере.");
      img.src = selectedImage.url;
    });
  }
  const adminTabs = $$(".admin-tab[data-panel]"),
    adminPanels = $$(".admin-content-panel");
  function activateAdminTab(tab) {
    adminTabs.forEach((x) => {
      const active = x === tab;
      x.setAttribute("aria-selected", String(active));
      x.tabIndex = active ? 0 : -1;
    });
    adminPanels.forEach((p) => (p.hidden = p.id !== tab.dataset.panel));
  }
  adminTabs.forEach((b, i) => {
    b.addEventListener("click", () => activateAdminTab(b));
    b.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const nextIndex =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? adminTabs.length - 1
            : (i + (e.key === "ArrowRight" ? 1 : -1) + adminTabs.length) % adminTabs.length;
      const target = adminTabs[nextIndex];
      activateAdminTab(target);
      target.focus();
    });
  });
  $("#adminLeadFilter")?.addEventListener("change", (e) =>
    $$("[data-lead-status]").forEach(
      (row) => (row.hidden = e.target.value !== "all" && row.dataset.leadStatus !== e.target.value),
    ),
  );
  $$('.admin-side nav a[href^="#admin"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href").slice(1),
        tab = $(`.admin-tab[data-panel="${id}"]`);
      if (tab) {
        e.preventDefault();
        tab.click();
      }
    }),
  );
  $$("[data-demo-status]").forEach((b) =>
    b.addEventListener("click", () => {
      const row = b.closest("[data-lead-status]");
      if (row) {
        row.dataset.leadStatus = "contacted";
        const label = $(".status-tag", row);
        if (label) label.textContent = "Демо · связаться";
        toast("Статус изменён только в демо-представлении.");
      }
    }),
  );
})();
