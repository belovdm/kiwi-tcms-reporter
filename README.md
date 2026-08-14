# kiwi-tcms-reporter

Репортеры для Playwright, Jest и Mocha плюс CLI для JUnit/JSON: пишут результаты автотестов в [Kiwi TCMS](https://kiwitcms.org) как TestExecution.

Это аналог reporter'а Testomat.io / `testy-reporter-pipe` для TestY. Общается с Kiwi через [`@kiwi-tcms-ai/kiwi-tcms-client`](https://www.npmjs.com/package/@kiwi-tcms-ai/kiwi-tcms-client).

Ошибка репортера или pipe **логируется и не валит** тестовый процесс.

## Установка

```bash
npm install --save-dev @kiwi-tcms-ai/kiwi-tcms-reporter
```

Локальная разработка:

```bash
npm install
npm run build        # tsc -> dist/
```

Требования: **Node.js ≥ 18**.

## Переменные окружения

| Переменная      | Обязательна | Описание                                        |
| --------------- | ----------- | ----------------------------------------------- |
| `KIWI_URL`      | да          | Базовый URL инстанса, без суффикса `/json-rpc/` |
| `KIWI_USERNAME` | да          | Логин Kiwi TCMS (`Auth.login`)                  |
| `KIWI_PASSWORD` | да          | Пароль Kiwi TCMS                                |
| `KIWI_PROJECT`  | режим plan  | Имя или id продукта (Product)                   |
| `KIWI_TIMEOUT`  | нет         | Таймаут RPC, мс (по умолчанию `30000`)          |
| `KIWI_INSECURE` | нет         | `1` / `true` — не проверять TLS-сертификат      |

`KIWI_PROJECT` нужен, чтобы искать кейсы по названию и создавать сборки/кейсы.

## Нативные репортеры

### Playwright — `playwright.config.ts`

```ts
export default {
  reporter: [
    ["list"],
    [
      "@kiwi-tcms-ai/kiwi-tcms-reporter/playwright",
      {
        plan: 12,
        build: process.env.CI_COMMIT_TAG ?? "dev",
      },
    ],
  ],
};
```

### Jest — `jest.config.js`

```js
module.exports = {
  reporters: ["default", ["@kiwi-tcms-ai/kiwi-tcms-reporter/jest", { plan: 12, build: "dev" }]],
};
```

### Mocha

```bash
mocha --reporter @kiwi-tcms-ai/kiwi-tcms-reporter/mocha \
      --reporter-options plan=12,build=dev
```

### Опции репортера

| Опция              | Описание                                                      |
| ------------------ | ------------------------------------------------------------- |
| `run`              | Id существующего TestRun                                      |
| `plan`             | Id TestPlan (вместе с `build` — найти или создать ран)        |
| `build`            | Имя сборки для режима plan (тег релиза, коммит, …)            |
| `runSummary`       | Заголовок рана при автосоздании                               |
| `matchBy`          | `auto` \| `tag` \| `title` — как сопоставлять тесты с кейсами |
| `createMissing`    | Создавать TestCase для несопоставленных тестов                |
| `commentFailures`  | Комментировать упавшие исполнения (по умолчанию да)           |
| `dryRun`           | Только сопоставление, без записи в Kiwi                       |
| `limitErrorLength` | Обрезать текст ошибки в комментарии (по умолчанию 2000)       |

Либо передайте `run`, либо пару `plan` + `build` (тогда нужен `KIWI_PROJECT`).

## Pipe (любой фреймворк, который умеет JUnit или JSON)

```bash
npx playwright test --reporter=junit
npx kiwi-tcms-pipe --plan 12 --build "$CI_COMMIT_TAG" --results junit.xml
```

`kiwi-tcms-pipe --help` показывает флаги. `--dry-run` только сопоставляет, ничего не пишет. `--strict` завершается с ненулевым кодом, если тесты остались без кейса или операция упала.

Результаты можно передать файлом (`--results`) или через stdin.

### JSON-формат

```json
{
  "tests": [
    {
      "title": "логин с валидными данными",
      "fullTitle": "Auth > логин с валидными данными",
      "status": "passed",
      "durationMs": 120,
      "error": null,
      "tags": ["C412"]
    }
  ]
}
```

Допустимы также `{ "results": [...] }` или голый массив. Статусы `pass` / `fail` / `skip` / `blocked` / `pending` нормализуются.

## Сопоставление тестов с кейсами

1. Маркеры в названии, тегах Playwright или classname JUnit: `C412`, `TC-412`, `KIWI:412`, `[C412]`.
2. Точное, затем частичное совпадение summary кейса с названием теста (в рамках `--plan` или `KIWI_PROJECT`).

`createMissing` включайте только после прохода с `--dry-run`.

## Соответствие статусов

| Фреймворк                       | Исполнение в Kiwi |
| ------------------------------- | ----------------- |
| passed                          | PASSED            |
| failed / timedOut / interrupted | FAILED            |
| skipped / pending / todo        | BLOCKED           |

У упавших тестов текст ошибки пишется комментарием к TestExecution (если не выключить `commentFailures`).

## Скрипты

```bash
npm test
npm run typecheck
npm run build
```
