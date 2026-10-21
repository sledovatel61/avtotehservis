# reference/ — сохранённый референс

Референс `https://matronet.com/demo/car-7` **уже выгружен заказчиком в Google Drive**:
**https://drive.google.com/drive/folders/18iNEQaFElf8-8IszfxX77NGzK5GDbWcB**

Там весь сайт: HTML всех 8 страниц, `style.css`, `responsive.css`, `theme.min.css`, JS-библиотеки и скриншоты. Разбор — `docs/08-reference-car7.md`.

**В git эти файлы не кладём:** чужие тексты, картинки и 316-килобайтные CSS не должны попасть в репозиторий проекта. Локальная копия — по желанию, в `reference/` и вне коммита.

## Если нужно сохранить ещё раз

Инструкция — `docs/09-save-reference.md`. Коротко:

1. Яндекс.Браузер → **Ctrl + S** → тип **«Веб-страница, полностью»** → сохранить сюда.
2. Повторить для 8 страниц (адреса — в инструкции).
3. Рядом с каждым HTML появится папка `<имя>_files` — не переименовывать и не разделять.

## Структура, которую я жду

```
reference/
  matronet-car-7/
    home.html      + home_files/
    about.html     + about_files/
    services.html  + services_files/
    service.html   + service_files/
    appointment.html + appointment_files/
    news.html      + news_files/
    post.html      + post_files/
    contacts.html  + contacts_files/
```

Альтернатива: архив `matronet-car-7.zip` в этой папке.

## Ограничения GitHub

- один файл ≤ 100 МБ;
- папку с сотнями картинок лучше архивировать;
- не коммитить `.DS_Store`, `Thumbs.db` и временные файлы.
