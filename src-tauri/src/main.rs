#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem}, tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}};
use tauri_plugin_window_state::StateFlags;
mod external_links;
mod language;
use language::tr;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};

struct Service(Mutex<Option<Child>>);
#[cfg(windows)]
struct ServiceJob(Mutex<Option<OwnedHandle>>);
#[cfg(windows)]
mod window_identity;
#[cfg(windows)]
mod win_key;
#[cfg(target_os = "macos")]
mod mac_key;

// The "recall Dev Space" shortcut: a bare Win-key tap on Windows, ⌃⌥⌘Space on macOS.
#[cfg(windows)]
type RecallShortcut = win_key::WinKeyShortcut;
#[cfg(target_os = "macos")]
type RecallShortcut = mac_key::RecallShortcut;
#[cfg(windows)]
const RECALL_LABEL: &str = "Win key";
#[cfg(target_os = "macos")]
const RECALL_LABEL: &str = mac_key::LABEL;

#[cfg(windows)]
fn process_job(child: &Child) -> Result<OwnedHandle, Box<dyn std::error::Error>> {
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return Err(std::io::Error::last_os_error().into()); }
        let owned = OwnedHandle::from_raw_handle(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(owned)
    }
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}

fn reveal(app: &tauri::AppHandle, _label: &str) {
    let label = "workspace";
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
    }
}

fn requested_window(args: &[String]) -> Option<&str> {
    args.windows(2).find_map(|pair| {
        if pair[0] == "--show" && matches!(pair[1].as_str(), "chats" | "workspace") { Some(pair[1].as_str()) } else { None }
    })
}

// Closing a window hides it; a minimized window still counts as open. macOS
// reports a minimized window as not visible (NSWindow.isVisible is false while
// miniaturized), so it also checks is_minimized there.
fn is_open(window: &tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false) || (cfg!(target_os = "macos") && window.is_minimized().unwrap_or(false))
}

fn hide(window: &tauri::WebviewWindow) {
    // macOS keeps the miniaturized flag on a hidden window; clear it so a
    // closed window is never taken for a minimized, open one.
    #[cfg(target_os = "macos")]
    if window.is_minimized().unwrap_or(false) { let _ = window.unminimize(); }
    let _ = window.hide();
}

fn recall_open_windows(app: &tauri::AppHandle) {
    if app.get_webview_window("workspace").is_some_and(|window| is_open(&window)) {
        reveal(app, "workspace");
    }
    reveal(app, "chats");
}

#[cfg(any(windows, target_os = "macos"))]
fn publish_shortcut(app: &tauri::AppHandle, request_id: Option<&str>, error: Option<String>) {
    let available = app.try_state::<RecallShortcut>().is_some();
    let enabled = app.try_state::<RecallShortcut>().is_some_and(|shortcut| shortcut.enabled());
    if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { let _ = item.set_checked(enabled); }
    let event = serde_json::json!({ "type": "native-settings", "requestId": request_id, "available": available, "winKey": enabled && available, "label": RECALL_LABEL, "error": error });
    if let Some(child) = app.state::<Service>().0.lock().unwrap().as_mut() {
        if let Some(stdin) = child.stdin.as_mut() { let _ = writeln!(stdin, "{event}"); }
    }
}

#[cfg(any(windows, target_os = "macos"))]
fn set_shortcut(app: &tauri::AppHandle, enabled: bool, request_id: Option<&str>) {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let shortcut = app.try_state::<RecallShortcut>().ok_or("Shortcut unavailable")?;
        let folder = app.path().app_config_dir()?;
        fs::create_dir_all(&folder)?;
        fs::write(folder.join("windows-key.json"), if enabled { "true" } else { "false" })?;
        #[cfg(windows)]
        shortcut.set_enabled(enabled);
        #[cfg(target_os = "macos")]
        shortcut.set_enabled(enabled)?;
        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() { item.set_checked(enabled)?; }
        Ok(())
    })();
    publish_shortcut(app, request_id, result.err().map(|error| error.to_string()));
}

#[cfg(any(windows, target_os = "macos"))]
fn start_file_drag(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let Some(window) = app.get_webview_window("workspace") else { return };
    let _ = app.run_on_main_thread(move || {
        let callback_window = window.clone();
        let result = drag::start_drag(
            &window, drag::DragItem::Files(paths),
            drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
            move |result, _| {
                let detail = serde_json::json!({ "dropped": matches!(result, drag::DragResult::Dropped) });
                let _ = callback_window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-native-drag-result',{{detail:{detail}}}))"));
            }, drag::Options::default(),
        );
        if let Err(error) = result {
            let detail = serde_json::json!({ "dropped": false, "error": error.to_string() });
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-native-drag-result',{{detail:{detail}}}))"));
        }
    });
}

// Cancelling the repository picker: quit quietly instead of reporting an error.
#[derive(Debug)]
struct Cancelled;
impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("No Workspace repository selected") }
}
impl std::error::Error for Cancelled {}

fn repo_path(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let config = app.path().app_config_dir()?.join("repository.json");
    let args: Vec<String> = std::env::args().collect();
    let supplied = args.iter().position(|v| v == "--repo").and_then(|i| args.get(i + 1)).map(PathBuf::from);
    let saved = fs::read_to_string(&config).ok().and_then(|s| serde_json::from_str::<String>(&s).ok()).map(PathBuf::from);
    let current = std::env::current_dir().ok().filter(|root| root.join("workspace/workspace.json").is_file());
    let root = supplied.or(saved).or(current).unwrap_or(app.path().app_data_dir()?.join("projects"));
    fs::create_dir_all(root.join("workspace"))?;
    if !root.join("workspace/workspace.json").is_file() { fs::write(root.join("workspace/workspace.json"), r#"{"entities":[],"spaces":[{"id":"default","name":"Мой проект","sections":[]}]}"#)?; }
    fs::create_dir_all(config.parent().unwrap())?;
    fs::write(config, serde_json::to_string(&root.to_string_lossy())?)?;
    Ok(root)
}

fn normalize_node_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn window_defaults(builder: WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>) -> WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle> {
    // macOS: a forced theme sets NSApp.appearance app-wide, which WKWebView
    // reports as prefers-color-scheme, so the page's System theme could never
    // turn light. The dark background still avoids a white flash on load.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.theme(Some(tauri::Theme::Dark));
    // macOS: without a download handler, wry cancels every WKWebView download
    // (image Download buttons, report downloads). Save to ~/Downloads under a
    // unique name, as wry chooses, and select the file in Finder when done.
    #[cfg(target_os = "macos")]
    let builder = {
        let pending = Mutex::new(std::collections::HashMap::<String, PathBuf>::new());
        builder.on_download(move |_, event| {
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => { pending.lock().unwrap().insert(url.to_string(), destination.clone()); },
                tauri::webview::DownloadEvent::Finished { url, path, success } => {
                    // wry never reports the saved path on macOS; use the requested one.
                    let saved = path.or_else(|| pending.lock().unwrap().remove(url.as_str()));
                    if let (true, Some(saved)) = (success, saved) { let _ = external_links::reveal_path(&saved.to_string_lossy()); }
                },
                _ => {}
            }
            true
        })
    };
    builder.background_color(tauri::webview::Color(12, 13, 16, 255))
}

fn make_windows(app: &tauri::AppHandle, workspace: &str, _chats: &str) -> Result<(), Box<dyn std::error::Error>> {
    let service_url: tauri::Url = workspace.parse()?;
    let service_token = service_url.query_pairs().find(|(key, _)| key == "token").map(|(_, value)| value.into_owned()).ok_or("Service credential unavailable")?;
    let auth_script = include_str!("desktop-auth.js")
        .replace("__MRMAK_SERVICE_ORIGIN__", &serde_json::to_string(&service_url.origin().ascii_serialization())?)
        .replace("__MRMAK_SERVICE_TOKEN__", &serde_json::to_string(&service_token)?);
    let window = window_defaults(WebviewWindowBuilder::new(app, "workspace", WebviewUrl::External(workspace.parse()?)))
        .initialization_script(&auth_script)
        .on_new_window(|url, _| external_links::open_popup(url))
        .disable_drag_drop_handler().visible(false)
        .title("Dev Space").inner_size(1440.0, 920.0).min_inner_size(720.0, 480.0)
        .build()?;
    #[cfg(windows)]
    window_identity::set_window(&window)?;
    let handle = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); hide(&handle); }
    });
    window.show()?;
    #[cfg(windows)]
    window_identity::refresh_shortcuts(app);
    Ok(())
}

#[cfg(unix)]
mod login_path;

// Finder and Dock launches get launchd's environment, not the user's shell
// exports. PATH always comes from the login shell; the other imported
// variables only fill gaps, so a Terminal launch or `launchctl setenv` wins.
#[cfg(target_os = "macos")]
fn login_environment(command: &mut Command) {
    let (path, vars) = login_path::discover();
    command.env("PATH", path);
    let missing = |name: &str| std::env::var_os(name).is_none();
    let mut has_locale = !(missing("LANG") && missing("LC_ALL") && missing("LC_CTYPE"));
    for (name, value) in vars {
        if missing(&name) {
            has_locale |= matches!(name.as_str(), "LANG" | "LC_ALL" | "LC_CTYPE");
            command.env(name, value);
        }
    }
    // Without any locale the service and every terminal run in the C locale.
    if !has_locale { command.env("LANG", "en_US.UTF-8"); }
}

// macOS: NSFileManager needs no Automation (Apple Events) permission, unlike
// the crate's default Finder script, but Finder offers no "Put Back" for it.
fn move_to_trash(path: &str) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = trash::TrashContext::default();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    { trash::delete(path) }
}

// Keep the supplied star's colours in the menu bar as well as the Dock.
#[cfg(target_os = "macos")]
fn menu_bar_icon() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
}

#[cfg(target_os = "macos")]
fn recall_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::ShortcutState;
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
        if event.state() == ShortcutState::Pressed { recall_all_windows(app); }
    }).build()
}

// Windows and Linux have nothing to register here; keep the builder chain uniform.
#[cfg(not(target_os = "macos"))]
fn recall_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> { tauri::plugin::Builder::new("mrmak-recall").build() }

// macOS: the recall shortcut and a Dock-icon click bring back both windows,
// since closing a window there only hides it.
#[cfg(target_os = "macos")]
fn recall_all_windows(app: &tauri::AppHandle) {
    let any_visible = ["workspace", "chats"].iter().any(|label| app.get_webview_window(label).is_some_and(|w| is_open(&w)));
    if any_visible { recall_open_windows(app); } else { reveal(app, "workspace"); reveal(app, "chats"); }
}

// macOS: the web view never receives Cmd+1…9 (the native window consumes them
// before the page), so chat switching lives in a Chats menu, as in other Mac
// apps. Selecting an item shows Chats and asks the page to open that tab.
#[cfg(target_os = "macos")]
fn install_chats_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::Submenu;
    let menu = Menu::default(app)?;
    let items = (1..=9).map(|n| MenuItem::with_id(app, format!("chat-{n}"), format!("{} {n}", tr("Chat")), true, Some(format!("CmdOrCtrl+{n}"))))
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    let chats_menu = Submenu::with_items(app, tr("Chats"), true, &refs)?;
    menu.append(&chats_menu)?;
    app.manage(language::MacChatsMenu(chats_menu, items));
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(index) = event.id.as_ref().strip_prefix("chat-").and_then(|n| n.parse::<u8>().ok()) else { return };
        reveal(app, "chats");
        if let Some(window) = app.get_webview_window("workspace") {
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-select-chat',{{detail:{{index:{index}}}}}))"));
        }
    });
    Ok(())
}

// Tauri panics on a setup error, which macOS reports as a crash. Show the
// error and quit instead, quietly when the repository picker was cancelled.
fn guarded_setup(app: &mut tauri::App, setup: impl FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>>) -> Result<(), Box<dyn std::error::Error>> {
    let Err(error) = setup(app) else { return Ok(()) };
    if !cfg!(target_os = "macos") { return Err(error); }
    let cancelled = error.downcast_ref::<Cancelled>().is_some();
    if !cancelled {
        rfd::MessageDialog::new().set_level(rfd::MessageLevel::Error).set_title(tr("Dev Space could not start")).set_description(error.to_string()).show();
    }
    app.handle().exit(if cancelled { 0 } else { 1 });
    Ok(())
}

fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--quit") { app.exit(0); }
            else if let Some(label) = requested_window(&args) { reveal(app, label); }
            else { reveal(app, "workspace"); reveal(app, "chats"); }
        }))
        .plugin(recall_plugin())
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED).build())
        .manage(Service(Mutex::new(None)))
        .setup(|app| guarded_setup(app, |app| {
            if std::env::args().any(|arg| arg == "--quit") { app.handle().exit(0); return Ok(()); }
            #[cfg(windows)]
            window_identity::initialize(app.handle())?;
            let repo = repo_path(app.handle())?;
            if let Ok(saved) = fs::read_to_string(repo.join(".devspace/settings.json")) {
                if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&saved) { language::select(settings["language"].as_str().unwrap_or("ru")); }
            }
            let resource_dir = app.path().resource_dir()?;
            let runtime = resource_dir.join("runtime");
            let runtime_node = if cfg!(windows) { runtime.join("node.exe") } else { runtime.join("node") };
            let (node, script, ui) = if runtime_node.is_file() {
                (runtime_node, runtime.join("service/main.mjs"), runtime.join("ui"))
            } else {
                (PathBuf::from("node"), repo.join("desktop/service/main.mjs"), repo.join("dist"))
            };
            let script = normalize_node_path(script);
            let logs = app.path().app_log_dir()?; fs::create_dir_all(&logs)?;
            let service_log = logs.join("service.log");
            let log = fs::OpenOptions::new().create(true).append(true).open(&service_log)?;
            let mut command = Command::new(node);
            command.arg(script).arg("--repo").arg(&repo).arg("--ui").arg(ui).current_dir(&repo)
                .env("MRMAK_PARENT_PID", std::process::id().to_string()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
            #[cfg(target_os = "macos")]
            login_environment(&mut command);
            let mut child = hidden(&mut command).spawn()?;
            // The job contains only this app's service and descendants. Quitting
            // or a host crash cannot leave managed CLI/MCP processes behind.
            #[cfg(windows)]
            app.manage(ServiceJob(Mutex::new(Some(process_job(&child)?))));
            let stdout = child.stdout.take().ok_or("Service output unavailable")?;
            *app.state::<Service>().0.lock().unwrap() = Some(child);
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    match event["type"].as_str().unwrap_or("") {
                        #[cfg(any(windows, target_os = "macos"))]
                        "native-settings" => {
                            if let Some(enabled) = event["winKey"].as_bool() {
                                let handle = app_handle.clone();
                                let request_id = event["requestId"].as_str().map(str::to_owned);
                                let _ = app_handle.run_on_main_thread(move || set_shortcut(&handle, enabled, request_id.as_deref()));
                            }
                        },
                        "language" => {
                            let handle = app_handle.clone();
                            let locale = event["language"].as_str().unwrap_or("ru").to_owned();
                            let _ = app_handle.run_on_main_thread(move || language::apply(&handle, &locale));
                        },
                        "ready" => {
                            let handle = app_handle.clone();
                            let workspace = event["workspace"].as_str().unwrap_or("").to_owned();
                            let chats = event["chats"].as_str().unwrap_or("").to_owned();
                            let _ = app_handle.run_on_main_thread(move || {
                                if let Err(error) = make_windows(&handle, &workspace, &chats) {
                                    rfd::MessageDialog::new().set_title(tr("Dev Space could not open")).set_description(error.to_string()).show(); handle.exit(1);
                                }
                            });
                        },
                        "window" => {
                            let label = "workspace";
                            if let Some(window) = app_handle.get_webview_window(label) {
                                match event["action"].as_str().unwrap_or("") {
                                    "show" => reveal(&app_handle, label),
                                    "hide" => hide(&window),
                                    "minimize" => { let _ = window.minimize(); },
                                    "pin" => { let _ = window.set_always_on_top(event["value"].as_bool().unwrap_or(false)); },
                                    _ => {}
                                }
                            }
                        },
                        "recycle-file" => {
                            if let Some(file) = event["path"].as_str() {
                                if let Some(window) = app_handle.get_webview_window("workspace") {
                                    let file = file.to_owned();
                                    std::thread::spawn(move || {
                                        let detail = match move_to_trash(&file) {
                                            Ok(()) => serde_json::json!({ "path": file, "recycled": true }),
                                            Err(error) => serde_json::json!({ "path": file, "recycled": false, "error": error.to_string() }),
                                        };
                                        let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-recycle-result',{{detail:{detail}}}))"));
                                    });
                                }
                            }
                        },
                        #[cfg(any(windows, target_os = "macos"))]
                        "drag-files" => {
                            if let Some(paths) = event["paths"].as_array() {
                                let paths: Vec<PathBuf> = paths.iter().filter_map(|p| p.as_str().map(PathBuf::from)).collect();
                                if !paths.is_empty() { start_file_drag(&app_handle, paths); }
                            }
                        },
                        "pick-files" => {
                            if let (Some(window), Some(request_id)) = (app_handle.get_webview_window("workspace"), event["requestId"].as_str()) {
                                let request_id = request_id.to_owned();
                                std::thread::spawn(move || {
                                    let paths = rfd::FileDialog::new().set_parent(&window).set_title(tr("Attach file paths")).pick_files().unwrap_or_default();
                                    let detail = serde_json::json!({ "requestId": request_id, "paths": paths });
                                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('mrmak-picked-files',{{detail:{detail}}}))"));
                                });
                            }
                        },
                        "reveal" => { if let Some(file) = event["path"].as_str() { let _ = external_links::reveal_path(file); } },
                        _ => {}
                    }
                }
                if app_handle.get_webview_window("workspace").is_none() {
                    rfd::MessageDialog::new().set_title(tr("Dev Space service did not start")).set_description(format!("{} {}", tr("The local service stopped before opening the windows. Log:"), service_log.display())).show();
                    app_handle.exit(1);
                }
            });
            #[cfg(target_os = "macos")]
            install_chats_menu(app.handle())?;
            let workspace_item = MenuItem::with_id(app, "workspace", tr("Show Workspace"), true, None::<&str>)?;
            let chats_item = MenuItem::with_id(app, "chats", tr("Show Chats"), true, None::<&str>)?;
            let both_item = MenuItem::with_id(app, "both", tr("Show both windows"), true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", tr("Quit Dev Space and stop terminals"), true, None::<&str>)?;
            app.manage(language::LanguageMenu(vec![(workspace_item.clone(), "Show Workspace"), (chats_item.clone(), "Show Chats"), (both_item.clone(), "Show both windows"), (quit_item.clone(), "Quit Dev Space and stop terminals")]));
            let separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&workspace_item, &separator, &quit_item])?;
            #[cfg(any(windows, target_os = "macos"))]
            {
                let preference = app.path().app_config_dir()?.join("windows-key.json");
                let enabled = fs::read_to_string(&preference).ok().and_then(|text| serde_json::from_str::<bool>(&text).ok()).unwrap_or(false);
                let shortcut = RecallShortcut::start(app.handle(), enabled);
                let available = shortcut.is_ok();
                if let Ok(shortcut) = shortcut { app.manage(shortcut); }
                let item = CheckMenuItem::with_id(app, "win-key", format!("{} {}", tr(RECALL_LABEL), tr("shows Dev Space")), available, enabled && available, None::<&str>)?;
                menu.insert(&item, 1)?;
                app.manage(item);
                publish_shortcut(app.handle(), None, if available { None } else { Some(format!("The system could not register {RECALL_LABEL}.")) });
            }
            #[cfg(target_os = "macos")]
            let tray = TrayIconBuilder::new().icon(menu_bar_icon()?).icon_as_template(false);
            #[cfg(not(target_os = "macos"))]
            let tray = TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone());
            let tray = tray.tooltip(tr("Dev Space — your agents, close at hand"))
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "workspace" => reveal(app, "workspace"), "chats" => reveal(app, "chats"),
                    "both" => { reveal(app, "workspace"); reveal(app, "chats"); }, "quit" => app.exit(0),
                    #[cfg(any(windows, target_os = "macos"))]
                    "win-key" => {
                        if let Some(item) = app.try_state::<CheckMenuItem<tauri::Wry>>() {
                            if let Ok(enabled) = item.is_checked() {
                                set_shortcut(app, enabled, None);
                            }
                        }
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| { if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { reveal(tray.app_handle(), "chats"); } })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })).build(tauri::generate_context!());
    match result {
        Ok(app) => app.run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event { recall_all_windows(app); }
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                if let Some(shortcut) = app.try_state::<win_key::WinKeyShortcut>() { shortcut.shutdown(); }
                if let Some(mut child) = app.state::<Service>().0.lock().unwrap().take() {
                    if let Some(mut stdin) = child.stdin.take() { let _ = stdin.write_all(b"quit\n"); }
                    for _ in 0..80 { if child.try_wait().ok().flatten().is_some() { break; } std::thread::sleep(std::time::Duration::from_millis(100)); }
                    let _ = child.kill(); let _ = child.wait();
                }
                #[cfg(windows)]
                if let Some(job) = app.try_state::<ServiceJob>() { job.0.lock().unwrap().take(); }
            }
        }),
        Err(error) => { rfd::MessageDialog::new().set_title(tr("Dev Space could not start")).set_description(error.to_string()).show(); }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_node_path;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    #[test]
    fn menu_bar_icon_preserves_the_supplied_star_colours() {
        let icon = super::menu_bar_icon().unwrap();
        assert_eq!((icon.width(), icon.height()), (128, 128));
        assert!(icon.rgba().chunks_exact(4).any(|pixel| pixel[2] > pixel[1] && pixel[3] > 0));
    }

    #[test]
    fn normalize_node_path_removes_windows_extended_prefixes() {
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\C:\Mr Mak\service\main.mjs")), PathBuf::from(r"C:\Mr Mak\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"\\?\UNC\server\share\service\main.mjs")), PathBuf::from(r"\\server\share\service\main.mjs"));
        assert_eq!(normalize_node_path(PathBuf::from(r"C:\Mr Mak\service\main.mjs")), PathBuf::from(r"C:\Mr Mak\service\main.mjs"));
    }
}
