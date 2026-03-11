#[cfg(not(target_os = "android"))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter, Manager, Runtime,
};
use tauri::AppHandle;
use tauri::http::{Request, Response, StatusCode};

// Proxy an audio stream request to the backend.
// The WebView uses stream://<host>/<trackId>?token=<jwt> as audio.src.
// Tauri intercepts it here, fetches from the real backend over HTTP (no ATS
// restrictions apply to Rust), forwards Range headers, and returns the bytes.
async fn proxy_stream(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let track_id = request.uri().path().trim_start_matches('/').to_string();

    let token = request
        .uri()
        .query()
        .unwrap_or("")
        .split('&')
        .find_map(|part| {
            let mut kv = part.splitn(2, '=');
            if kv.next() == Some("token") {
                kv.next().map(|v| v.to_string())
            } else {
                None
            }
        });

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(b"Missing token".to_vec())
                .unwrap()
        }
    };

    if track_id.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(b"Missing track ID".to_vec())
            .unwrap();
    }

    // API base URL is embedded at build time via VITE_API_URL env variable.
    let api_base = option_env!("VITE_API_URL").unwrap_or("http://localhost:3000/api");
    let stream_url = format!("{}/tracks/{}/stream", api_base, track_id);

    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(e.to_string().into_bytes())
                .unwrap()
        }
    };

    let mut req_builder = client
        .get(&stream_url)
        .header("Authorization", format!("Bearer {}", token));

    // Forward Range header so seeking works correctly.
    if let Some(range) = request.headers().get("range") {
        req_builder = req_builder.header("range", range.as_bytes());
    }

    match req_builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("audio/mpeg")
                .to_string();
            let content_range = resp
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let content_length = resp
                .headers()
                .get("content-length")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let body = resp.bytes().await.unwrap_or_default().to_vec();

            let mut builder = Response::builder()
                .status(status)
                .header("content-type", content_type)
                .header("accept-ranges", "bytes")
                .header("access-control-allow-origin", "*");

            if let Some(cr) = content_range {
                builder = builder.header("content-range", cr);
            }
            if let Some(cl) = content_length {
                builder = builder.header("content-length", cl);
            }

            builder.body(body).unwrap_or_else(|_| {
                Response::builder().status(500).body(vec![]).unwrap()
            })
        }
        Err(e) => Response::builder()
            .status(StatusCode::BAD_GATEWAY)
            .body(e.to_string().into_bytes())
            .unwrap(),
    }
}

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
        .register_asynchronous_uri_scheme_protocol("stream", |_app, request, responder| {
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy_stream(request).await);
            });
        })
        .plugin(tauri_plugin_os::init())
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
