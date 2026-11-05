Новых GUI-скриншотов 1.0.5 нет; снимки design/readme сняты с установленной 1.0.4 и не подтверждают новые кнопки. Browser fixture локально не запускался. Выполнен один статический pass только extension учебного шаблона.

## persistence

PASS: import-template проверяет baseRevision до файловых изменений, принимает только wind-islands, создаёт отдельные project folder и asset copies с новыми ID, затем добавляет projects/pages/materials/tasks к текущим массивам. Существующие записи сохраняются; обычный history/undo охватывает импорт. В seed нет live workspace, настроек или чатов; ссылки home/source/modelPage/topic/asset переназначаются внутри независимой копии. Публикация именно pristine template явно разрешена пользователем.

## fidelity

Faithful по коду: пример запускается только явной кнопкой пустого состояния, командой или отдельной кнопкой «Новый проект»; импорт открывает новую Wiki. Старые проекты и capture остаются в обычном хранилище/навигации. addExample и backend import не создают и не отправляют агентские сессии. Установленная Graphite-оболочка сохранена, новые контролы используют существующий dialog/empty-state.

## ceiling

Новых material correctness/data-preservation/accessibility blockers в указанном scope не найдено. Кнопка примера имеет type=button в форме и не зависит от required полей создания пустого проекта; busy отключает повторный ввод, успешное завершение объявляется существующим role=status. Проверки project-template.test.mjs покрывают независимость повторного импорта, файлы, membership, сохранение существующей заметки, undo, allowlist и stale revision. Ожидания template-ui.mjs согласованы с seed: пять тем плюс gallery-nav, шесть страниц, 12 материалов, четыре записи «Локации», modelPageId для трёх GLB, повторная копия с суффиксом и ноль agent sessions. Это оценка достижимости fixture, а не результат его GUI-запуска.

## material_fixes

Нет необходимых исправлений в ограниченном scope 1.0.5 template extension.

## keep

Сохранить опциональность примера, независимые ID и assets каждой копии, проверку revision до записи, synthetic labels и полное исключение live пользовательских данных/чатов из поставляемого шаблона.