# reference/ — сюда кладём сохранённый референс

Папка для исходников сайта-референса `https://matronet.com/demo/car-7`, если заказчик его сохранит.

**Не обязательно.** Структура всех 8 страниц уже разобрана в `docs/08-reference-car7.md`, и раунд мокапов можно запускать без исходников. Эта папка нужна только для точного повторения вёрстки.

## Как сохранить

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
