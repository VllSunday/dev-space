use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, menu::MenuItem, tray::TrayIcon};

static RUSSIAN: AtomicBool = AtomicBool::new(true);
pub struct LanguageMenu(pub Vec<(MenuItem<tauri::Wry>, &'static str)>);

pub fn select(value: &str) {
    if matches!(value, "ru" | "en") { RUSSIAN.store(value == "ru", Ordering::Relaxed); }
}

pub fn tr(key: &str) -> &str {
    if !RUSSIAN.load(Ordering::Relaxed) { return key; }
    match key {
        "Workspace" => "Рабочее пространство", "Chats" => "Чаты", "Chat" => "Чат",
        "Show Workspace" => "Показать рабочее пространство", "Show Chats" => "Показать чаты",
        "Show both windows" => "Показать оба окна",
        "Quit Dev Space and stop terminals" => "Выйти из Dev Space и остановить терминалы",
        "Dev Space — your agents, close at hand" => "Dev Space — ваши агенты всегда рядом",
        "shows Dev Space" => "показывает Dev Space", "Win key" => "Клавиша Win",
        "Choose your Dev Space Workspace repository" => "Выберите репозиторий Dev Space Workspace",
        "Choose the Workspace folder" => "Выберите папку рабочего пространства",
        "Select the repository folder containing workspace/workspace.json." => "Выберите папку репозитория, в которой есть workspace/workspace.json.",
        "Dev Space could not start" => "Не удалось запустить Dev Space",
        "Dev Space could not open" => "Не удалось открыть Dev Space",
        "Attach file paths" => "Выберите файлы для прикрепления",
        "Dev Space service did not start" => "Не удалось запустить сервис Dev Space",
        "The local service stopped before opening the windows. Log:" => "Локальный сервис остановился до открытия окон. Журнал:",
        _ => key,
    }
}

pub fn apply(app: &tauri::AppHandle, value: &str) {
    select(value);
    if let Some(menu) = app.try_state::<LanguageMenu>() {
        for (item, key) in &menu.0 { let _ = item.set_text(tr(key)); }
    }
    for (id, key) in [("workspace", "Workspace"), ("chats", "Chats")] {
        if let Some(window) = app.get_webview_window(id) {
            let _ = window.set_title(&format!("Dev Space — {}", tr(key)));
        }
    }
    if let Some(tray) = app.try_state::<TrayIcon<tauri::Wry>>() { let _ = tray.set_tooltip(Some(tr("Dev Space — your agents, close at hand"))); }
    #[cfg(any(windows, target_os = "macos"))]
    if let Some(item) = app.try_state::<tauri::menu::CheckMenuItem<tauri::Wry>>() {
        let _ = item.set_text(format!("{} {}", tr(crate::RECALL_LABEL), tr("shows Dev Space")));
    }
    #[cfg(target_os = "macos")]
    if let Some(menu) = app.try_state::<MacChatsMenu>() {
        let _ = menu.0.set_text(tr("Chats"));
        for (index, item) in menu.1.iter().enumerate() { let _ = item.set_text(format!("{} {}", tr("Chat"), index + 1)); }
    }
}

#[cfg(target_os = "macos")]
pub struct MacChatsMenu(pub tauri::menu::Submenu<tauri::Wry>, pub Vec<MenuItem<tauri::Wry>>);

#[cfg(test)]
mod tests {
    #[test]
    fn switches_both_ways_and_ignores_unknown_locales() {
        super::select("ru"); assert_eq!(super::tr("Chats"), "Чаты");
        super::select("en"); assert_eq!(super::tr("Chats"), "Chats");
        super::select("invalid"); assert_eq!(super::tr("Chats"), "Chats");
        super::select("ru"); assert_eq!(super::tr("custom"), "custom");
    }
}
