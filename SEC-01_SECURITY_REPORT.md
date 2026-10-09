# SEC-01 — targeted dependency remediation

10 октября 2026, Europe/Chisinau. Пользователь разрешил commit/push SEC-01 в
существующую producer release branch и update Draft PR #58; production remediation
не разрешена и не выполнялась. Gate B/C CLOSED. Данные расписаний, схемы, parser, broker,
publisher, auth/admin и CORS-код не изменены.

## Baseline и границы evidence

| Объект | Проверенный статус |
|---|---|
| Producer исходный approved HEAD | `codex/map-02b-producer-integration` / `badad94fbf6e2a2caf87e028cda029f993eaadd8` |
| Producer PR до update | [#58](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/58), OPEN / Draft, `badad94…` |
| Consumer branch / HEAD | `codex/map-02b-consumer-integration` / `a6fe0d35fc9ddfad410de1b795911b2623695852` |
| Consumer PR | [#2](https://github.com/barbalatv/fcim-indoor-map/pull/2), OPEN / Draft, тот же head |
| Producer remote main / Render live | `735b64f28e78eb1de98c36bb68ddf4dc3ecc0426` |
| Рабочие деревья до SEC-01 | Оба чистые; существующие ветки/commits сохранены |
| Среда локальной проверки | Windows; Node `v22.23.1`, npm `10.9.8` |
| SEC-01 publication / CI | Итоговые implementation SHA и hosted evidence — в `SEC-01_GATE_B_DECISION.md`; SHA документационного commit определяется `git rev-parse HEAD` |

GitHub read-only подтвердил SUCCESS producer
[run 37996573591](https://github.com/barbalatv/utm-curs-i-orar-2027/actions/runs/37996573591)
на `badad94…` и consumer
[run 37996588538](https://github.com/barbalatv/fcim-indoor-map/actions/runs/37996588538)
на `a6fe0d…`. Это CI исходных heads, **не изменённого dependency tree**.
При первичном локальном аудите новый hosted CI/public PR update не запускались.
После отдельного разрешения выполняется update существующего Draft PR; результаты
нового run фиксируются в decision packet. Предыдущий SUCCESS не переносится на SEC-01.

Сырой audit baseline выполнен до изменений: `npm audit --json`,
`npm audit --omit=dev --json`, `npm ls sharp source-map-js`. Проверены package-lock,
реальные node_modules, dependency paths, Dockerfile, next.config, Next image optimizer,
PostCSS previous-map и исходные API routes. Advisory ranges/patches сверены с
GitHub Advisory API и страницами, а availability versions — с npm registry.

`npm audit` считает затронутые package records, включая propagation к parent
packages. Число 14 не означает 14 независимых exploit primitives.
Production audit — классификация dependency graph npm; фактический Docker runner
содержит traced standalone subset плюс PDF.js/@napi-rs и seed files.

## SEC-P1 — sharp: High

| Обязательный вопрос | Результат независимой проверки |
|---|---|
| 1. Installed version | До: `sharp 0.35.4`, единая deduplicated копия; после: `0.35.5` |
| 2. Advisory / affected | `GHSA-wq5f-xc86-pv6w`, upstream librsvg `CVE-2026-96889`; npm affected `<0.35.5`. Поле cve_id sharp advisory null: upstream CVE указан в title/references |
| 3. Minimum patch | `sharp 0.35.5`; prebuilt binaries содержат исправленный `librsvg 2.63.2` |
| 4. Production chain | `next 16.3.8` → optional `sharp ^0.35.4` → installed `0.35.4` |
| Дополнительная dev chain | `wrangler 4.146.0` → `miniflare 5.20261001.0-alpha` → exact `sharp 0.35.4`; используется та же копия |
| 5. Runtime inclusion | `sharp` найден в исходном локальном `.next/standalone`; после нового build там `0.35.5`. Dockerfile копирует standalone в runner. Actual live container filesystem не инспектировался |
| 6. Attacker-controlled input | Next image optimizer принимает request-controlled `url`, но remotePatterns пуст, SVG запрещён default `dangerouslyAllowSVG=false`; direct sharp/next-image/SVG-upload call sites в app не найдены. До vulnerable decoder не продемонстрирован reachable path |
| 7. Preconditions | Вредоносный SVG должен попасть в librsvg decoder; memory vulnerability и возможное RCE зависят от runtime conditions на glibc Linux. PIE влияет на возможность RCE; actual deployed Node PIE status UNKNOWN |
| 8. Compatible fix | Patch `0.35.5` + соответствующие prebuilt `@img/*`/libvips. Exact dev pin требует override, чтобы не осталась вторая `0.35.4`; Wrangler/Next upgrade не нужен |
| 9. Residual risk | Локально известная уязвимая версия устранена, native load подтверждён. Production всё ещё на прежнем SHA; Linux image/PIE и actual attack path не проверены. Это не утверждение общей безопасности SVG/parser |

[Upstream sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w),
[GitHub package range](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

Bookworm Docker base указывает на glibc runtime; это вывод из Dockerfile, а не
наблюдение действующего процесса. `getSharp` в Next сначала блокирует loaders,
затем разрешает ряд loaders, включая `VipsForeignLoadSvg`; отдельное SVG rejection
происходит выше вызова optimization. Это defense при текущей конфигурации,
не эквивалент upstream workaround полного запрета SVG decode.
Type-sniffing bypass и live exploitation не тестировались. Отсутствие UI
`next/image` само по себе не выключает framework endpoint и не доказывает safety.

## SEC-P2 — source-map-js: High

| Обязательный вопрос | Результат независимой проверки |
|---|---|
| 1. Installed version | До: единая `1.2.1`; после: единая `1.2.2` |
| 2. Advisory / affected | `GHSA-68fv-2mgg-jv7q`, `CVE-2026-93749`; affected `>=1.0.0 <1.2.2` |
| 3. Minimum patch | `1.2.2`, проверено advisory first_patched_version и release |
| 4. Production chain | `next 16.3.8` → `postcss 8.5.23` → `source-map-js ^1.2.1` → installed `1.2.1` |
| Дополнительные dev chains | Root `postcss 8.5.28`; `@tailwindcss/postcss 4.3.3` → `@tailwindcss/node 4.3.3`; обе deduped к той же версии |
| 5. Runtime inclusion | npm считает production dependency. Docker runner не копирует все node_modules; отдельный source-map-js/PostCSS не найден в исходном и новом standalone, ссылки source-map-js отсутствуют в новом route NFT. Фактический live image UNKNOWN |
| 6. Attacker-controlled input | App не принимает CSS/source-map uploads; не найдены direct SourceMapConsumer/previous-map/sourceMappingURL call sites. Public schedule/status course/filter input не становится source map. Dependency PostCSS previous-map создаёт SourceMapConsumer: функциональность есть в toolchain |
| 7. Preconditions | Непроверенная indexed source map с огромным section offset line должна попасть в vulnerable processing; синхронная обработка может блокировать event loop. Источник такой карты в текущем app не установлен |
| 8. Compatible fix | Patch `1.2.2` удовлетворяет существующим `^1.2.1` ranges всех цепочек; lockfile update, direct dependency не добавлена |
| 9. Residual risk | Известная npm версия устранена. Не заявляется доказанная невозможность иных source-map attacks; reachability/live artifact qualification остаётся ограниченной inspected code и local build |

[GitHub advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[upstream release v1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2).

Отсутствие отдельного traced package или очевидного app call site не является
доказательством полной безопасности всех framework bundles. Здесь квалифицирована
именно установленная npm dependency и граница её использования; embedded third-party
code в других bundles не выдаётся за отдельно проаудированную версию.

## Выполненная минимальная remediation

`package.json`: добавлен только `overrides.sharp = "0.35.5"`.
Пакет уже существовал транзитивно, новый dependency name не добавлен.

`package-lock.json`: ровно **30 package records** с patch updates:

| Семейство | До → после | Объём |
|---|---|---:|
| sharp | `0.35.4` → `0.35.5` | 1 |
| @img/sharp platform packages, включая wasm | `0.35.4` → `0.35.5` | 16 |
| @img/sharp-libvips platform packages | `1.3.3` → `1.3.4` | 10 |
| source-map-js | `1.2.1` → `1.2.2` | 1 |
| brace-expansion (eslint/minimatch 3 chain) | `1.1.18` → `1.1.21` | 1 |
| brace-expansion (typescript-eslint/minimatch 10 chain) | `5.0.9` → `5.0.12` | 1 |

Обновлены resolved URLs, integrity и versioned sharp optionalDependency refs.
Package-record identities и прочие package versions/dependency ranges сохранены.
Npm при targeted update дополнительно изменил dev/libc metadata 23 неизменённых
пакетов; этот посторонний drift удалён. Для обновлённых sharp platform records
сохранены исходные dev/devOptional/optional classifications. Финальный `npm ci`
и отдельный `npm ci --omit=dev` подтвердили lock consistency и native installation.
Dependency delta — 127 добавленных/127 удалённых строк lock и 3 строки package.json.

Команда resolver: `npm update sharp source-map-js brace-expansion --package-lock-only
--ignore-scripts --no-fund --no-audit`, затем минимизация metadata delta и полный
`npm ci --no-fund`. Это `npm ci` с флагом только отключения fundraising output.
`npm audit fix`, `--force`, major upgrades и schema/parser rewrites не использовались.

Оба brace-expansion patch соответствуют проверенным ranges: quadratic DoS
`GHSA-q2hr-2g5m-vwhr` требует `1.1.21`/`5.0.12`; recursion advisories
`GHSA-qhr7-859c-m2p7` и `GHSA-6j4f-fj2g-mc7p` также устранены этими версиями.
Это дополнительная совместимая security remediation унаследованной dev finding.
[Quadratic advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[recursion advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[parseCommaParts advisory](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).

## Audit до/после

| Audit | Baseline `badad94…` | Локальный исправленный tree | Exit после |
|---|---|---|---:|
| `npm audit --json` | 14: 10 High + 4 Moderate | 9: 5 High + 4 Moderate | 1, residual findings |
| `npm audit --omit=dev --json` | 2 High: sharp/source-map-js | **0 findings**, все severity 0 | 0 |

Убраны пять package records: sharp, source-map-js, brace-expansion и propagation
sharp к miniflare/wrangler. Нулевой production audit не используется как утверждение
нулевого общего риска и не относится к ещё не изменённому production deploy.

## Все незакрытые security findings, по одной записи

Все девять — `dev=true` цепочки. Все девять отсутствуют как отдельные packages в
новом standalone; route NFT не ссылается на esbuild/braces/micromatch/fast-glob/drizzle-kit.
Это local Windows build evidence, не инспекция live Linux image.
Builder/локальная разработка/CI по-прежнему устанавливают
их; scope dev не делает риск автоматически приемлемым.

| Package record | Exact installed | Severity | Root advisory / путь / действие |
|---|---|---|---|
| `braces` | `3.0.3` | High | `GHSA-vfj7-8cjw-p6xm`, `CVE-2026-93687`; ESLint chain ниже; patched version нет |
| `micromatch` | `4.0.8` | High | Propagation braces; `micromatch → braces` |
| `fast-glob` | `3.3.1` | High | Propagation braces; `fast-glob → micromatch → braces` |
| `@next/eslint-plugin-next` | `16.3.8` | High | Propagation braces; `plugin → fast-glob → micromatch → braces` |
| `eslint-config-next` | `16.3.8` | High | Direct dev root цепочки braces |
| `esbuild` (`@esbuild-kit/core-utils/node_modules`) | `0.18.20` | Moderate | `GHSA-67mh-4wv8-2f99`; affected `<=0.24.2`, patch `0.25.0` |
| `@esbuild-kit/core-utils` | `3.3.2` | Moderate | Propagation к вложенному esbuild; package deprecated |
| `@esbuild-kit/esm-loader` | `2.6.5` | Moderate | Propagation `esm-loader → core-utils → esbuild`; deprecated |
| `drizzle-kit` | `0.31.11` | Moderate | Direct dev root `drizzle-kit → esm-loader → core-utils → esbuild 0.18.20` |

**Braces risk decision:** advisory описывает stack exhaustion от глубоко вложенного
brace pattern; registry заканчивается на `3.0.3`, first_patched_version отсутствует.
Application public input к ESLint glob path не подключён. Untrusted repository/config
input в developer/CI toolchain требует отдельного решения. Npm предлагает
`eslint-config-next 14.2.35` как breaking downgrade с 16; автоматически не выполнен.
Варианты для человека: явно квалифицировать ограниченный build-time risk с владельцем
и сроком пересмотра; либо отдельно разрешить toolchain replacement/обновление после
upstream patch. Остаточный High risk от имени пользователя не принят.
[Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

**Esbuild risk decision:** проблема требует запущенного esbuild development server и
чтения его ответов сторонним сайтом. Docker build выполняет next build, runner —
standalone Node server, не этот dev server. Факт запуска drizzle studio/serve в иных
developer sessions не проверен. `0.25.0` не удовлетворяет loader-chain range для
`0.18.x`; override был бы потенциально breaking изменением pre-1.0 API.
Registry latest drizzle-kit всё ещё `0.31.11` с тем же esm-loader dependency;
1.0 находится в beta/RC. Npm downgrade на `0.18.1` не выполнен. Автоматическая
remediation этой части остановлена: нужны отдельное разрешение и disposable DB/CLI
regression plan либо явно одобренная build/dev-only qualification.
[Esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99).

## Проверки и сравнение с принятым baseline

Финальная проверка выполняется после последнего dependency/metadata изменения.
Логи находятся вне producer/consumer source:
`C:\Users\user\AppData\Local\Temp\fcim-sec01-20261010`.
`checks.json` содержит exit codes/длительность/log paths. Temp evidence может быть
удалён ОС; данный отчёт сохраняет основные результаты и точные revisions.

| Проверка | SEC-01 | Baseline / граница |
|---|---|---|
| `npm ci --no-fund` | PASS, exit 0 | Финальный lock; expected deprecated dev-package warnings |
| `npm audit --omit=dev --json` | PASS, 0 findings | Было 2 High |
| `npm audit --json` | 9 findings, exit 1 | Было 14; это незакрытый audit, не PASS |
| `npm test` | PASS, 743/743, 34 files | DEPLOY local 743; hosted baseline 737 PASS + 6 Windows-only skips |
| `npm run typecheck` | PASS | App routes/types сохранены |
| `npm run lint` | PASS | Security checks не отключались |
| `npm run build` | PASS, exit 0 | Next 16.3.8, standalone sharp 0.35.5 |
| `npm run typecheck:worker` | PASS, exit 0 | Worker code/config неизменны |
| `npm run typecheck:publisher` | PASS, exit 0 | Publisher code/config неизменны |
| `npm run build:publisher` | PASS, exit 0 | Локальная компиляция |
| `npm run check:worker` | PASS, exit 0 | `wrangler deploy --dry-run`, без remote mutation |
| `npm run test:e2e -- --project=chromium` | PASS, 4/4, exit 0 | Как baseline; local fixture APIs, не production acceptance |
| Isolated `npm ci --omit=dev --no-audit --no-fund` | PASS | sharp 0.35.5 / rsvg 2.63.2 / source-map-js 1.2.2 реально установлены |
| Consumer portable contract/API/data tests | PASS, 69/69 | Consumer files не изменены |
| `git diff --check` | PASS | Line-ending advisory не является diff error |
| PostgreSQL integration suite | NOT RUN LOCAL | Нет docker/psql CLI и disposable test DB; DATABASE_URL не задан |

Hosted baseline DB suite — 6/6 PASS, но это **старое дерево dependencies**.
DB migrations/tests на реальной БД не запускались. Новый hosted full CI с
изолированным Postgres обязателен до Gate B; push разрешён только в существующую
producer release branch. Actual hosted results нового implementation SHA — в packet.

Unit suite включает 14 параметризованных проверок bounded public CORS, а также
API smoke, parser/source acceptance, broker/retention/publication trust-boundary
tests. Исходные assertions не менялись.
Consumer contract проверяет frozen API/geometry/data compatibility; это не новый
hosted run и не real production browser integration.

## Точные изменения и дальнейший release review

Изменены только существующие `package.json` и `package-lock.json`; добавлены:

- `SEC-01_SECURITY_REPORT.md`;
- `SEC-01_RENDER_ROLLBACK.md`;
- `SEC-01_GATE_B_DECISION.md`.

Все 176 исходных tracked файлов сравнены по raw SHA-256 с snapshot до SEC-01:
174 совпали, изменились ровно package/lock. Consumer рабочее дерево чистое.
Не изменены timetable parser, schemas/data/seed, broker/Worker/publisher code/config,
Dockerfile, CI, CORS helper/routes/tests, consumer geometry/room mappings/storage.
Tests/build создали только обычные local ignored artifacts и external evidence.

SHA-256 окончательных dependency files:

```text
package.json      37ed9bafb5698bb437678ba1fe76aa32a4f6fb97bb155ed2c2c9cf2ce20e84b8
package-lock.json 1ee66e3a90ce436305ea1f9ea1b6d20957af81e59f23eb81cd3038a09e174ef4
```

В проверках были обычные warnings: deprecated dev packages, Next ignored lockfile
в user home за границей Git repo, Vitest native config warning и NO_COLOR/FORCE_COLOR
в E2E. Они не подавлялись изменением config и не привели к failures.
Дополнительный диагностический `require("sharp/package.json")` встретил
`ERR_PACKAGE_PATH_NOT_EXPORTED`; повторная диагностика через supported
`require("sharp").versions` успешно подтвердила `0.35.5`/`2.63.2`.
Это ошибка диагностического способа чтения metadata, не failed regression.
Обычный `npm audit --omit=dev` также повторно вернул `found 0 vulnerabilities`, exit 0.

## Ограниченное residual-risk предложение — НЕ ПРИНЯТО

Предлагаемый владелец обеих dev-risk групп — **barbalatv**, maintainer producer repo.
Назначение и принятие исключения требуют его независимого подтверждения; наличие
имени в документе не является согласием. Пересмотр **не позднее 17 октября 2026,
Europe/Chisinau**, и обязательно до Gate B, если его review будет раньше.
Без явного решения статус остаётся OPEN/NOT ACCEPTED; автоматического продления нет.

| Risk group | Предлагаемая ограниченная область | Условия, которые человек должен подтвердить |
|---|---|---|
| Braces High + 4 parent records | Только разработка, lint/build и hosted PR CI reviewed producer SHA | Не передавать HTTP/API input, произвольные glob patterns или непроверенные конфиги в эту цепочку; до запуска просматривать изменения package/lock/ESLint/CI; изолировать непроверенный repository input; отсутствие packages в runner заново проверять при изменении tracing/build |
| Esbuild Moderate + 3 parent records | Только существующий loader/build и migration tests в disposable CI PostgreSQL | Не запускать `esbuild.serve` или Drizzle Studio с этой vulnerable цепочкой; loopback binding сам по себе не закрывает advisory; не подключать real DB/production secrets; не заменять esbuild вне совместимого range без отдельной санкции |

Общие условия: `npm ci` из reviewed lock; CI с `contents: read`, без ссылок на
production secrets и без remote deploy; реальные DB/R2/accepted state не используются
для тестов. Эти свойства текущего workflow проверены по committed `ci.yml`; полный
набор произвольных developer sessions и фактические runner secrets не инспектировались.
Ограничения являются предложением, а не гарантией их выполнения вне inspected CI.

Немедленный пересмотр: новый patched release/advisory или изменение severity,
добавление dev server, новая обработка untrusted glob/config input, изменение
workflow/permissions, попадание этих packages в runtime или попытка открыть Gate B.
Если условие нарушено, исключение не действует: остановить соответствующее dev/CI
использование, провести новую оценку. Gate B остаётся закрытым независимо от этого
proposal; deployment risk acceptance из него не следует.

Предлагаемое human решение: отдельно принять/отклонить каждую root-risk группу,
подтвердить владельца, условия и срок. В случае отказа запланировать отдельное
совместимое исправление после upstream patch либо отдельно разрешённую toolchain
замену. Breaking upgrades/downgrades, audit fix --force и новые dependencies не сделаны.

## Разрешённая публикация и независимый review

Pre-publication secret check: **PASS**, Gitleaks `8.30.1`, официальный release
checksum проверен. Synthetic positive control вне репозитория обнаружен (exit 42).
Scoped scan ровно пяти публикуемых файлов — exit 0, 0 findings; ручной просмотр
отчётов не обнаружил env secret values, credentials, private keys или deploy hooks.
Service/workspace/deploy IDs, публичные origins/advisory URLs и SHA-256 не являются
секретами. Сырые audit/test logs, scanner/canary и private env в commit не включены.
Это scan публикационного delta, не утверждение полного historical repo secret audit.

10 октября пользователь принял локальную targeted remediation и разрешил commit,
обычный push в `codex/map-02b-producer-integration` и update существующего Draft PR #58.
Публикуются ровно package/lock и три SEC-01 отчёта после secret check.
Fresh full hosted CI exact head обязателен, включая disposable PostgreSQL,
Chromium и Worker/publisher checks; затем требуется renewed independent review.
GitHub PR workflow может checkout synthetic merge SHA — это не merge в main.
Зелёный старый CI `badad94…` не переносится на этот patch. Итоговый новый SHA/run
и состояние публикации приведены в decision packet/PR description.
Consumer PR #2 не изменяется. Merge/auto-merge, Render env/settings, deploy/rollback,
GitHub Pages и consumer publication запрещены и не выполнялись.

Security findings в local production graph устранены. Общая рекомендация Gate B
определена в `SEC-01_GATE_B_DECISION.md` с учётом residual dev risk и неподтверждённой
rollback/env readiness; отдельное human approval остаётся обязательным.
