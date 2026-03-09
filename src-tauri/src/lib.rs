#[cfg(not(target_os = "android"))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager, Runtime,
};
use tauri::AppHandle;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct TrayCommand {
    command: String,
}

#[tauri::command]
fn update_tray(
    app: AppHandle,
    track_name: String,
    artist: String,
    is_playing: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        use tauri::Manager;
        if let Some(tray) = app.tray_by_id("main") {
            let tooltip = if track_name.is_empty() {
                "Resonance".to_string()
            } else {
                format!(
                    "{} — {}\n{}",
                    track_name,
                    artist,
                    if is_playing { "▶ Playing" } else { "⏸ Paused" }
                )
            };
            tray.set_tooltip(Some(&tooltip))
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "android")]
    let _ = (app, track_name, artist, is_playing);
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn setup_tray<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let play_pause = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous Track", true, None::<&str>)?;
    let separator = tauri::menu::PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Resonance", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &play_pause,
            &next,
            &previous,
            &separator,
            &show,
            &quit,
        ],
    )?;

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .icon_as_template(true)
        .tooltip("Resonance")
        .on_menu_event(move |app, event| {
            let command = event.id().as_ref().to_string();
            match command.as_str() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {
                    let _ = app.emit("tray:command", TrayCommand { command });
                }
            }
        })
        .on_tray_icon_event(|tray, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![update_tray])
        .setup(|_app| {
            #[cfg(not(target_os = "android"))]
            setup_tray(_app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
