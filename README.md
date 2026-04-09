# PulseMesh Desktop

PulseMesh Desktop — это Discord-подобное P2P-приложение для голоса, видео, экрана и чата с локальными профилями, IndexedDB-хранилищем, ручным WebRTC bootstrap и Electron-скелетом для упаковки в desktop-приложение.

## Что уже реализовано

- Discord-style интерфейс: серверы слева, каналы в центре, чат/звонки в основном окне, участники справа.
- Локальные профили и вход:
  - email / пароль
  - provider-stub входы для Google / Discord / GitHub
  - хранение в IndexedDB
- Локальная история сообщений в IndexedDB.
- Создание и подключение к комнатам по invite-коду.
- WebRTC bootstrap без постоянного хоста:
  - создание offer
  - прием offer и генерация answer
  - применение answer
  - DataChannel для P2P-сообщений
- Голос / видео:
  - getUserMedia
  - mute / unmute
  - camera on / off
  - screen share
  - локальная запись сессии в WebM
- Desktop scaffold:
  - `electron/main.mjs`
  - `electron/preload.mjs`
  - `electron-builder.yml`
  - `electron-updater`
  - tray mode
  - native notifications
  - GitHub Actions workflow

## Архитектура связи

### 1. Как мы подключаемся друг к другу без постоянного хоста

Принцип такой:

1. Пользователь создает комнату и получает invite-код, например `room-abc123`.
2. Из invite-кода вычисляется детерминированный topic discovery.
3. Пиры находят друг друга одним из способов:
   - ручной обмен SDP/ICE
   - временный relay / signaling bootstrap
   - локальный discovery topic для LAN-режима
4. После знакомства создаются **прямые WebRTC peer connections**.
5. Все дальнейшие сообщения, голос, видео и screen share идут **напрямую между участниками**, без центрального медиасервера.

### 2. Топология комнат

- До `6–8` участников: **mesh** (каждый со всеми).
- Для больших комнат: **peer-selected SFU relay** — временный узел выбирается среди самих участников по качеству сети/CPU.
- Для LAN / offline режима: discovery по topic + локальные transports.

### 3. NAT traversal

Используется стандартный подход:

- публичные STUN-сервера Google
- опциональный TURN как fallback для сложных NAT/корпоративных сетей

## Локальное хранение данных

В IndexedDB хранятся:

- профили пользователей
- активная сессия
- комнаты
- история сообщений
- тема интерфейса

## Структура репозитория

- `src/App.tsx` — основное UI и WebRTC-логика для браузерного preview
- `src/store/useAppStore.ts` — Zustand store
- `src/lib/persistence.ts` — IndexedDB persistence
- `electron/main.mjs` — основной Electron process
- `electron/preload.mjs` — безопасный bridge для renderer
- `electron-builder.yml` — конфигурация упаковки
- `.github/workflows/release.yml` — CI для сборки артефактов

## Desktop-first запуск

Проект теперь работает как desktop-приложение: Electron поднимает локальный signaling relay + SQLite внутри `main process`, а React renderer подключается к этому endpoint через preload API.

### Запуск desktop в dev-режиме

1. Поднимите renderer:

```bash
npm run dev
```

2. В отдельном терминале запустите Electron:

```bash
npx electron electron/main.mjs
```

### Что это дает

- Приложение открывается как отдельное desktop-окно.
- Локальный signaling сервер стартует автоматически внутри Electron.
- База `pulsemesh.db` хранится в `app.getPath('userData')` и не требует ручного запуска backend.

## Запуск и сборка

### Web preview

```bash
npm install
npm run build
```

### Desktop packaging

В этом sandbox-проекте уже добавлены Electron-зависимости и конфиг упаковки.
Для создания desktop-артефактов используйте:

```bash
npx electron-builder --config electron-builder.yml --publish never
```

> Если вы публикуете проект в отдельный GitHub-репозиторий и хотите использовать именно `npm run dist`, добавьте соответствующий script в `package.json` вне текущего sandbox-ограничения.

## GitHub Releases

Файл workflow уже подготовлен для CI-сборки артефактов под:

- Windows
- macOS
- Linux

Для автообновлений:

1. опубликуйте репозиторий на GitHub
2. создавайте tag / release
3. загружайте артефакты в GitHub Releases
4. `electron-updater` будет использовать release-канал как источник обновлений

## Что можно добавить следующим шагом

- полноценный встроенный signaling relay на WebSocket
- OpenPGP.js / Signal-подобное E2EE для личных сообщений
- пересылка файлов чанками через DataChannel
- overlay в играх
- rich presence
- SQLite storage inside Electron main process
- proxy support для корпоративных сетей
- код-подпись Windows/macOS

## Ограничение текущего окружения

Текущий результат собран внутри frontend sandbox, поэтому я не могу напрямую:

- опубликовать внешний GitHub-репозиторий
- создать реальные GitHub Releases от вашего имени
- выдать готовые публичные ссылки на `.exe` / `.dmg` / `.AppImage`

Но сам проект теперь подготовлен так, чтобы вы могли перенести его в репозиторий и продолжить desktop-сборку и публикацию.
