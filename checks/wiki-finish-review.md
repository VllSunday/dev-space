Нет новых GUI-скриншотов: запуск браузера ранее заблокирован средой. Старые пользовательские референсы не подтверждают текущую сборку; ниже один статический review 1.0.4, без запуска GUI и повторного detector pass.

## persistence

PASS по наличию PRODUCT.md, DESIGN.md и direction.md и сохранению установленного Graphite-направления. Коллекции записываются как ссылки, проверяют project/topic/gallery membership, сохраняют исходные материалы и участвуют в обычном undo. Пустой collections[] отличается от отсутствующего поля для старых wiki. Остаются две ошибки сохранения состояния: поздний Markdown tombstone и повторная инициализация history после reload.

## fidelity

Intentional: Wiki-nav открывает полную тему; превью открывает inline expanded record; gallery разворачивает только image files; home показывает до восьми элементов с pins, а длинное описание находится после коллекций. AgentWorkbench key остаётся project.id, поэтому same-project route не перемонтирует агентов. PageModelViewer допускает page отсутствующим и защищает upload через readOnly/!page. По статике ожидания checks/wiki-navigation-ui.mjs достижимы: 12 записей темы, переход к loc-1 за пределами первых восьми, nested scroll/focus, редактирование, четыре изображения, lightbox, pin коллекции и восстановление Markdown. Фактический scroll, focus и геометрия не проверены браузером.

## ceiling

Новых декоративных требований нет. Восстановление Markdown сохраняет конфликтующий текст и предлагает сравнение, route parser не превращает file query в произвольный URL, collection API не допускает чужие/архивные pins. Нового security blocker в просмотренной поверхности не найдено. Fixture не покрывает delayed-save/remount, reload с существующей историей и повторное использование одного attachment несколькими материалами; эти случаи требуют исправлений ниже. Шрифтовые advisory не входят в material batch.

## material_fixes

1. Сохранность Markdown: useMarkdownDraft.ts:35–42 после awaited commit продолжает делать cleared tombstone даже после unmount; при уходе/возврате на ту же страницу старый экземпляр может записать свежий Date.now() поверх более нового ввода нового экземпляра, включая localStorage — запретить post-save clear устаревшей generation и/или очищать server draft по CAS версии snapshot, проверив задержанный commit + remount + новый ввод.
2. История и scroll: useSpaceNavigation.ts:8–20 всегда начинает index=0/pendingScroll=null, а DevSpace.tsx:110 повторно вызывает navigate(requested,true), затирая существующий history.state.space индексом 0 и новым scroll; после reload Back/Alt← отключены при наличии внутренних entries — восстанавливать matching entry и не заменять его нулевым состоянием при нормализации того же валидного route.
3. Идентичность изображений: TopicMaterials.tsx:23 использует key=file.path для gallery, хотя API допускает один asset в разных материалах; одинаковые ключи нарушают reconciliation при фильтрации/архивации и могут сохранять состояние чужой карточки — использовать составной material.id + file.path (с различением повторов внутри материала) и проверить два материала с общим attachment.

## keep

Сохранить живые references коллекций, лимит восемь превью, независимый capture, inline редактирование с conflict recovery, отдельный image-only gallery и непрерывность реальных агентов при навигации внутри проекта.
## Resolution by implementation thread

The three material fixes were applied: mounted-instance guards for Markdown
clearing, matching history state preserved on reload, and material/file/index
gallery identities. The user-run browser check then passed the delayed-save,
reload/back, shared-image, topic and collection scenarios. It also revealed the
shared desktop bootstrap clearing history.state; that call now preserves it.
This resolution records implementation and test evidence, not another review.
