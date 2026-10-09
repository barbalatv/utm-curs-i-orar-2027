# SEC-01 — Render: проверка готовности к восстановлению

10 октября 2026, Europe/Chisinau. Проверка только для чтения.
Gate B и Gate C закрыты. Ни rollback, ни deploy, ни сохранение settings/env не выполнялись.

## Подтверждённый baseline

Пользователь в этой сессии подтвердил workspace `My Workspace`,
`tea-dae26cad0e5s73erp6p0`, и intended Pages origin `https://barbalatv.github.io`.
После подтверждения выполнены Render connector `get_service` и `list_deploys`
с явным workspaceId, без смены выбранного workspace.

| Поле | Наблюдение connector |
|---|---|
| Service | `utm-curs-i-orar-2027`, `srv-dae2bq0n74is73c3p4cg` |
| Owner/workspace | `tea-dae26cad0e5s73erp6p0`, совпадает с подтверждённым |
| Repository / branch | `barbalatv/utm-curs-i-orar-2027` / `main` |
| Runtime / region | Docker / Frankfurt |
| Compute plan / instances | `free` / 1; `buildPlan=starter` — отдельное поле, не compute plan |
| Workspace pricing plan | UNKNOWN: list_workspaces его не сообщает |
| Auto-deploy | `yes`, trigger `commit`; merge в main запускает production deployment |
| Suspension / maintenance | `not_suspended` / disabled |
| Render healthCheckPath | Пуст; Dockerfile имеет собственный HEALTHCHECK `/api/health` |
| Live deploy | `dep-db43ebu0tbcc73ckr760`, status `live` |
| Live Git revision | `735b64f28e78eb1de98c36bb68ddf4dc3ecc0426` |
| Завершение live deploy | `2026-10-09T00:38:11.423508Z` |
| Предшествующий успешный deploy | `dep-db4175rl550s73d08c00`, сейчас `deactivated`, SHA `6ed04b735d2c037a4aeedfba14e375878eeb4910` |
| Его завершение | `2026-10-08T22:07:20.657980Z` |

Рабочий rollback target из задания пока является **текущим live deploy**. После
следующего успешного выпуска он станет первым предыдущим deploy. Это не следует
путать с предшествующим deploy на `6ed04b…`.

`gh api .../git/ref/heads/main` подтвердил remote main `735b64f…`.
`git merge-base --is-ancestor 735b64f… HEAD` вернул 0: revision доступна локально
и входит в ancestry release branch. Reset, revert, force-push для её deployment
не требуются. Исходный Dockerfile не запускает DB migrations.

Bounded read-only smoke около `2026-10-09T23:07:55Z`:
`/api/health`, schedule/status обоих курсов — HTTP 200; health `ok=true`, оба
расписания доступны. Курс 1: 41 группа / 454 занятия, PDF hash
`ea38a76a3800da5ee320cfd048f19af14cbfa81168c26626babcf25cca050d05`.
Курс 2: 26 / 291, hash
`d2f7bde17384ecd9a5033882f30e288aa917fe40e26964a4095a5dc5f7a8e737`.
Parser `1.4.0`. Для confirmed Pages origin ACAO отсутствует: это ожидаемый baseline
до MAP-02B, не acceptance будущего CORS. Admin/refresh/publication не вызывались.

## Что проверено, а что остаётся неподтверждённым

| Вопрос | Статус |
|---|---|
| Service, workspace, main, live revision, auto-deploy, история | VERIFIED — connector |
| Поддержка rollback текущим compute plan | DOCUMENTED SUPPORTED — Free допускает два предыдущих deploy |
| Конкретный сохранённый artifact `dep-db43…` после будущего выпуска | UNVERIFIED; сейчас target live, будущий retention ещё не наблюдался |
| Rollback / Deploy a specific commit в UI именно этого account | UNVERIFIED |
| Право пользователя выполнить эти операции, build quota | UNVERIFIED |
| Service env baseline, linked groups, наличие/отсутствие нужного key | UNVERIFIED |
| Восстановление exact code без Git/DB изменений | Документированная процедура + доступный SHA; operational execution не тестировалось |
| Время переключения, cold start, durability runtime cache | UNVERIFIED |

Открытие [Dashboard](https://dashboard.render.com/web/srv-dae2bq0n74is73c3p4cg)
через in-app browser привело на Sign In to Render. Доступной авторизованной UI-сессии
нет. Connector не предоставляет read-env или read-artifact-availability методов.
Не вводились credentials, не извлекались API keys и не выполнялись mutation-пробы
для проверки прав. История успешных deploy не доказывает наличие кнопки rollback.

## Primary: восстановление предыдущего Render artifact

Процедура подготовлена, **не выполнена**. Перед Gate B оператор должен подтвердить
доступность целевого artifact и кнопки в авторизованном Dashboard; повторить после
выпуска, когда `dep-db43…` перейдёт в предыдущие deploy.

Только после отдельного разрешения на incident rollback:

1. Проверить workspace `tea-dae26cad0e5s73erp6p0`, service `srv-dae2…` и incident SHA.
2. Deploys → успешный `dep-db43ebu0tbcc73ckr760` → сверить полный SHA `735b64f…`.
3. Rollback → повторно проверить target → Rollback to this deploy.
4. Записать новый deploy ID, статус live и commit SHA; дождаться acceptance ниже.
5. Приватно восстановить сохранённую service env-конфигурацию и проверить auto-deploy.

Render переиспользует artifact; Dashboard rollback отключает auto-deploy, API rollback
этого не делает. Rollback использует env целевого deploy для этого запуска, но
не переписывает сохранённые текущие settings сервиса. Последующий обычный deploy
снова использует текущие settings. Значения linked environment groups не откатываются.
Поэтому обязательна отдельная сверка env и auto-deploy; не включать auto-deploy,
пока main содержит проблемную revision. [Render Rollbacks](https://render.com/docs/rollbacks).

Для оператора с отдельно авторизованным API-доступом существует POST
`/v1/services/srv-dae2bq0n74is73c3p4cg/rollback`, body
`{"deployId":"dep-db43ebu0tbcc73ckr760"}`. Его permission и artifact availability
не проверены. API-запрос не отправлялся; автоматическое отключение auto-deploy
не происходит. [Официальный endpoint](https://api-docs.render.com/reference/rollback-deploy).

## Fallback: новый build точного принятого Git commit

Если artifact недоступен, только после независимого разрешения на recovery deploy:

1. Сверить тот же service/workspace/repo; восстановить прежний service key через
   **Save only** до запуска build. При исходном отсутствии убрать только этот key.
2. Manual Deploy → Deploy a specific commit.
3. Вставить полный `735b64f28e78eb1de98c36bb68ddf4dc3ecc0426`, проверить selection.
4. Deploy Commit; записать build/deploy ID и подтвердить live SHA + acceptance.
5. Dashboard отключает auto-deploy для specific commit; оставить off до отдельного
   исправленного и проверенного release. Не нажимать Deploy latest commit.

Этот механизм официально поддержан для Git-backed services; права и кнопка данного
account не наблюдались. API POST `/v1/services/srv-dae2bq0n74is73c3p4cg/deploys`
с `{"commitId":"735b64f28e78eb1de98c36bb68ddf4dc3ecc0426"}` тоже документирован,
но сам не отключает auto-deploy. Текущий connector trigger_deploy не принимает SHA,
поэтому им нельзя подменять exact-commit recovery обычным latest deploy.
[Deploy a specific commit](https://render.com/docs/deploys#deploying-a-specific-commit),
[API commitId](https://api-docs.render.com/reference/create-deploy).

Fallback пересобирает код. `node:22-bookworm-slim` — floating Docker tag, поэтому
это не доказанная побитовая копия прежнего image. Нужны доступные Git/npm/base image
и build quota; primary предпочтительнее. Оба пути возвращают исходные dependency
versions с двумя квалифицированными High findings из baseline. Это recovery
исправной функции, а не security remediation: длительность такого исключения
и follow-up fix должен одобрить человек.

## Environment: baseline, выпуск и откат

Confirmed intended project URL: `https://barbalatv.github.io/fcim-indoor-map/`.
Confirmed intended origin: `https://barbalatv.github.io`, без project path.
GitHub repo сейчас `has_pages=false`, Pages API 404. Это подтверждённый план
публикации, **не существующий published origin**. Перед Gate C сверить actual page_url;
custom hostname требует нового allowlist review.

Будущий key/value:

```dotenv
SCHEDULE_MAP_ORIGINS=https://barbalatv.github.io
```

Текущее значение или отсутствие **не подтверждено и не сохранено**: Environment UI
недоступен, connector read-env отсутствует. Нельзя объявлять key отсутствующим по
одному отсутствию CORS. Это обязательный незакрытый pre-Gate-B пункт.

Оператор приватно сохраняет value либо отметку ABSENT вне Git/PR/reports; проверяет
одноимённый key в linked groups. Меняет только service-specific key, сохраняя
остальные origins, если они есть и остаются разрешёнными. Остальные secrets/settings
не трогает. При восстановлении возвращает прежний exact value либо прежнее отсутствие;
проверяет, что inherited group value не активировался после удаления service key.

Render предлагает Save only (без deploy; применение на следующем deploy), Save and
deploy (старый artifact с новым env) и Save, rebuild, and deploy (новый build).
Group changes могут деплоить связанные сервисы. Поэтому future sequence:
fresh PR-head CI + review → human Gate B → сохранить baseline → service key **Save only**
→ merge approved PR #58 в main → один auto-deploy → acceptance. Не использовать
save-and-deploy до merge и не запускать duplicate manual deploy после merge.
Для fallback restored key Save only предшествует exact-SHA deployment.
Для primary отдельно вернуть сохранённый key через Save only после artifact rollback,
сверив env восстановленного запуска. UI наличие Save only ещё не проверено.
[Render Environment Variables](https://render.com/docs/configure-environment-variables).

## Проверки после любого восстановления

1. Connector/UI: target SHA `735b64f…`, новый успешный deploy ID, отсутствие build/error;
   зафиксировать auto-deploy и конфигурацию env.
2. Health HTTP 200, `ok=true`, оба курса `has_schedule=true`; штатный UI Anul I/II.
3. Четыре public GET schedule/status: HTTP 200, course/schema/academic year/semester,
   PDF URL/hash, parser, downloaded_at/parsed_at согласованы. Сравнить со snapshot
   до incident; более новый accepted dataset требует проверки, не удаления ради
   совпадения старого hash. Реальные обновления не считать автоматически регрессией.
4. Для baseline без MAP-02B отсутствие ACAO ожидаемо. Если fallback env удаляет CORS,
   consumer должен показывать unavailable/qualified LKG, без synthetic substitution.
5. Не вызывать admin refresh, DB migrations, rollback БД, удаление data/R2/history.
   Проверить ошибки scheduler/broker read и восстановление accepted data без записи
   административными командами.

## Операционные ограничения и открытые пункты

Free поддерживает rollback к двум предыдущим deploy; target может выйти из окна
после последующих выпусков. Free filesystem теряется при restart/redeploy/spin-down,
а persistent disk для этого compute plan недоступен. Нельзя обещать сохранение
локального cache на `/app/data`. Долговечность remote accepted state/DB и их live
configuration нужно подтвердить приватно до выпуска; в SEC-01 инфраструктура
не менялась. Idle spin-up около минуты возможен. [Render Free](https://render.com/docs/free).

Документация описывает штатное переключение без downtime для сервисов без disk,
но actual latency/доступность этого recovery не тестировались. Нельзя гарантировать
отсутствие cold start, upstream outage или исчерпания квоты.

**Rollback readiness остаётся UNVERIFIED:** plan-level capability доказана
документацией, code target/history подтверждены connector, конкретные UI права,
artifact availability, private env baseline и recovery execution не доказаны.
Перед Gate B нужны независимая авторизованная UI-проверка без запуска действия,
приватный env snapshot и разрешённая incident recovery policy.
