Native desktop/mobile-скриншоты и QUALITY BAR card недоступны; GUI не запускался. Это одна ограниченная проверка исправлений по исходникам; настоящий запуск Whisper и микрофон не проверялись.

## persistence

PASS: PRODUCT.md, корневой DESIGN.md и direction.md существуют. setCount теперь клонирует layout, поэтому повторный preset получает новый state и сохраняется. Локальные Draco-файлы подготавливаются scripts/prepare-model-assets.mjs через prebuild/postbuild; на момент чтения public/assets/draco и dist/assets/draco ещё отсутствуют, поэтому финальная npm-сборка обязательна перед упаковкой.

## fidelity

Проверены шесть прежних findings: Attach ограничен target id либо focused Conversation; диктовка не покидает явно сфокусированную пустую панель; NewChat вынесен portal в native modal dialog с viewport scroll; закрытие вкладки проходит через AgentWorkbench и выбирает local preferred; setCount использует structuredClone; Draco использует локальный путь, без eager preload, с worker/WASM CSP. Первоначальные причины исправлены. В close-tab остаётся описанная ниже гонка с более поздним выбором пользователя. Фактическая геометрия, фокус WebView и отрисовка декодера не подтверждены визуально.

## ceiling

LocalWhisperSetup и API /dictation/local проверены на функциональные блокеры: авторизация до маршрута, существующие Python/model.bin, allowlist устройства, успешный localCheck до атомарного изменения .env, отмена через AbortSignal, блокировка параллельных setup и broadcast провайдера согласованы по коду. Новых необходимых исправлений в этом добавлении не найдено. Тесты с подставным runner не подтверждают CUDA/Whisper на машине пользователя; исправленный тест провайдера ожидает повторного запуска родителем. Дополнительный визуальный polish не запрашивается.

## material_fixes

1. Остаток прежнего close/focus finding: AgentWorkbench.tsx:35,55–70 увеличивает focusVersion только для focus/move/choose, пропускает selectedId effect во время DELETE, но split/zoom/setCount и выбор агента через DevSpace rail могут поменять текущую цель в этот период без изменения версии; завершившийся closeTab возвращает старую панель и перекрывает более поздний выбор — учитывать все явные смены цели, отличая их от серверного fallback, либо устранить global-first fallback протоколом закрытия с preferred successor.

## keep

Сохранить адресные Attach, no-op диктовки в пустой панели, native NewChat modal, независимые потоки реальных сессий, закрытие панели без остановки агента, локальные декодеры и проверку Whisper до сохранения конфигурации.

## Applied after review

Родительский агент учёл оставшуюся гонку: все явные изменения раскладки меняют
focusVersion, а client.chatSelectionIntent отдельно отмечает выбор агента через
rail/терминалы и отличает его от серверного fallback. Завершение DELETE сохраняет
более поздний выбор пользователя. Production TypeScript/Vite, Windows Rust и NSIS
сборки прошли; локальные декодеры присутствуют в runtime. Исправленный HTTP-тест
Whisper прошёл, реальный --check загрузил large-v3 на CUDA float16. Это запись
выполненных исправлений, а не дополнительная визуальная проверка.
