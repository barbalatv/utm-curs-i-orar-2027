# SEC-01 — решение для DEPLOY-01 Gate B

10 октября 2026, Europe/Chisinau.

**BLOCKED — Gate B CLOSED; Gate C CLOSED.** Service-level rollback/artifact/UI
readiness и private environment baseline не подтверждены; остаточный dev High risk
не принят человеком; изменённое dependency tree ещё не проходило hosted CI/review.
Локальная dependency remediation завершена и все запущенные обязательные
producer regressions прошли. Этот verdict не разрешает внешние изменения.

Пользователь отдельно разрешил 10 октября commit/push package/lock и трёх отчётов
в существующую `codex/map-02b-producer-integration`, update Draft PR #58 и ожидание
fresh hosted full CI. Это разрешение только на producer PR publication;
merge/auto-merge, Render changes и consumer PR/publication запрещены.

## Security результат

| Пункт | Результат |
|---|---|
| Production High sharp | `0.35.4` → `0.35.5`; `GHSA-wq5f-xc86-pv6w`, patched librsvg `2.63.2` |
| Production High source-map-js | `1.2.1` → `1.2.2`; `GHSA-68fv-2mgg-jv7q` |
| Дополнительный dev fix | brace-expansion `1.1.18` → `1.1.21`, `5.0.9` → `5.0.12` |
| Production npm audit | **2 High → 0 findings** |
| Full npm audit | **14 (10 High/4 Moderate) → 9 (5 High/4 Moderate)**; exit 1 остаётся |
| Existing live production | Всё ещё `735b64f…` с исходными dependencies; local fix туда не применён |

Обе production findings независимо исследованы: installed versions, advisory ranges,
minimum patches, introduction chains, Docker/standalone inclusion, input paths,
exploit preconditions и residual risk описаны в [security report](SEC-01_SECURITY_REPORT.md).
Live exploitation/PIE не проверялись; risk не принят по одному отсутствию call site.

Все **индивидуальные незакрытые package findings**:

1. **High** `braces 3.0.3` — `GHSA-vfj7-8cjw-p6xm`, patched release отсутствует.
2. **High** `micromatch 4.0.8` — propagation от braces.
3. **High** `fast-glob 3.3.1` — propagation от braces.
4. **High** `@next/eslint-plugin-next 16.3.8` — propagation от braces.
5. **High** `eslint-config-next 16.3.8` — propagation от braces.
6. **Moderate** вложенный `esbuild 0.18.20` — `GHSA-67mh-4wv8-2f99`;
   patch `0.25.0` вне разрешённого loader-chain range.
7. **Moderate** `@esbuild-kit/core-utils 3.3.2` — propagation от esbuild.
8. **Moderate** `@esbuild-kit/esm-loader 2.6.5` — propagation от esbuild.
9. **Moderate** `drizzle-kit 0.31.11` — propagation от esbuild.

Это два root advisory в dev toolchain, а не девять независимых production attacks.
Отдельные packages отсутствуют в новом local standalone, но присутствуют в builder/CI.
Npm предлагает breaking downgrades Next ESLint и Drizzle; их не выполняли.
Нужны explicit human qualification с владельцем/сроком/ограничениями либо отдельно
разрешённая toolchain remediation и её regression plan. Ни остаточный High risk,
ни breaking pre-1.0 esbuild override автоматически не приняты.

**Ограниченное proposal:** владелец — `barbalatv`, producer maintainer, assignment
pending confirmation; пересмотр до **17 октября 2026 Europe/Chisinau** или до Gate B,
если раньше. Только reviewed dev/build/CI без production secrets/real DB; исключить
esbuild.serve/Drizzle Studio и untrusted glob/config input. Пересматривать немедленно
при upstream patch/advisory, изменении toolchain/permissions или runtime inclusion.
Статус OPEN / NOT ACCEPTED; автоматического продления и deployment acceptance нет.
Полные условия по каждой risk group — в security report.

## Проверки

Все обязательные local команды завершились exit 0:
`npm ci`, production audit, `npm test` (**743/743**, 34 files), app/Worker/publisher
typechecks, lint, Next build, publisher build, Worker **dry-run** и Chromium E2E
(**4/4**, local fixture APIs). CORS focused suite включён в npm test.
Isolated `npm ci --omit=dev` реально установил patched sharp/rsvg/source-map-js;
нулевой audit не получен исключением optional packages. Consumer contract/API/data —
**69/69**, его checkout не изменён.

DB suite локально не запускался: disposable PostgreSQL отсутствует, docker/psql CLI
нет, process DATABASE_URL не задан. Старый hosted producer run
[37996573591](https://github.com/barbalatv/utm-curs-i-orar-2027/actions/runs/37996573591)
PASS, включая 6 DB tests; его Linux npm test — 737 PASS + 6 Windows-only skips,
Chromium 4 PASS. Старый consumer run
[37996588538](https://github.com/barbalatv/fcim-indoor-map/actions/runs/37996588538)
PASS. Они не доказывают acceptance обновлённого producer dependency tree.
До Gate B обязателен новый hosted full CI с disposable DB на exact updated PR head.
Свежий повторный audit перед разрешённым push: production 0 (exit 0), full 9
(5 High/4 Moderate, exit 1), installed patched versions и цепочки совпали с SEC-01.
Fresh hosted update run: **PENDING** до завершения разрешённого publication step.

## Render / env readiness

User-confirmed workspace: `My Workspace`, `tea-dae26cad0e5s73erp6p0`.
Connector подтвердил service `srv-dae2bq0n74is73c3p4cg`, main, Docker/Frankfurt/free,
auto-deploy yes/on commit, live `dep-db43ebu0tbcc73ckr760` на
`735b64f28e78eb1de98c36bb68ddf4dc3ecc0426`. Повторное чтение после тестов подтвердило
тот же live deploy. Health и четыре public API GET — HTTP 200, counts/hashes baseline
сохранены; MAP-02B CORS ещё не deployed.

Официальная документация Free подтверждает plan-level rollback support к двум
предыдущим deploy. После будущего релиза target станет предыдущим. Actual artifact
availability, UI action availability/permissions и env baseline остаются **UNVERIFIED**:
Dashboard in-app session требует sign-in, connector не читает env/artifact capability.
Primary artifact rollback и fallback exact-SHA rebuild подготовлены с полными IDs,
env recovery и post-rollback acceptance в [rollback report](SEC-01_RENDER_ROLLBACK.md).
Operational rollback не выполнялся; duration/durability live cache не доказаны.

Confirmed intended origin: `https://barbalatv.github.io`; кандидат
`SCHEDULE_MAP_ORIGINS=https://barbalatv.github.io`.
Pages ещё не enabled/published (`has_pages=false`, API 404).
Предыдущее значение/ABSENT не сохранено: это открытый обязательный пункт.
Future sequence после Gate B: private baseline → service key Save only → approved
PR #58 merge → один auto-deploy → acceptance. Group env changes не использовать.
Rollback должен вернуть и runtime revision, и saved env key; сохранить исходное
отсутствие или точное значение, учитывая inherited group values и auto-deploy.

## Git / точный scope

Исходный approved producer HEAD — `badad94fbf6e2a2caf87e028cda029f993eaadd8`;
publication сохраняет существующую `codex/map-02b-producer-integration` и ancestry,
без force-push. Публикуемый scope: `package.json`, `package-lock.json`
(30 patch-version records) и три SEC-01 report files. Новый implementation SHA
фиксируется после commit; состояние CI обновляется после завершения run.
Secret check пяти файлов: Gitleaks 8.30.1 PASS, 0 findings; positive control exit 42;
ручной report review PASS. .env, secrets, raw evidence и scanner в commit не входят.
Из 176 исходных tracked files SHA-256 изменился ровно у двух dependency files;
остальные 174 совпали byte-for-byte.

Consumer HEAD остаётся `a6fe0d35fc9ddfad410de1b795911b2623695852` на
`codex/map-02b-consumer-integration`; status чистый. Runtime/API/schema/CORS/parser/
source acceptance/DB/broker/publisher и consumer mappings/geometry/storage не менялись.
Existing producer [PR #58](https://github.com/barbalatv/utm-curs-i-orar-2027/pull/58)
остаётся Draft; новый PR не создаётся. Consumer PR #2 остаётся на прежнем head;
его description/settings не обновляются.

## Что должно закрыться перед независимым Gate B approval

1. Авторизованный оператор без запуска deploy проверяет Rollback / Deploy a specific
   commit, свои права, Save only и доступный target artifact; после релиза повторно
   сверяет target. Приватно сохраняет previous env value/ABSENT и group precedence.
2. Подтверждает durability accepted state и recovery обычного ephemeral cache без
   удаления расписаний/DB/R2; принимает ограничения normal redeployment/cold start.
3. Независимо принимает/отклоняет каждый residual risk в указанной dev scope;
   при отказе разрешает отдельное исправление, не `audit fix --force`.
4. В рамках уже разрешённого producer PR update фиксирует новый SHA и получает
   fresh hosted full CI; renewed independent review остаётся обязательным.
5. Затем независимо решает Gate B, включая разрешённый incident rollback scope.
   Gate C/Pages/consumer deployment остаются закрытыми до producer acceptance.

Разрешены только producer branch commit/push и existing Draft PR update.
Merge/auto-merge, Render env/settings/deploy/rollback, real DB changes,
consumer PR/publication и GitHub Pages settings **не выполнялись** и не разрешены.
Residual risk не принят; production release ожидает независимого human approval.
