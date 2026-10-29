// Captures the game with Windows Graphics Capture, as OBS's Window and Display
// Capture do. The window is found by its title, and WGC reads the image it
// has already drawn: nothing here opens the game's process (ADR 0009).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use windows::core::{factory, Interface, Ref, Result, BOOL};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, LPARAM, POINT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};

use crate::frames::{millis, FrameStats};
use crate::log::{log, seconds};
use crate::regions::{crop, save_png, Frame, Image, FRAME, REGIONS};

pub enum Target {
    // The game's window, by its title.
    Window,
    // The primary monitor, for when window capture shows nothing fullscreen.
    Monitor,
}

// What the capture shares with the rest of the spike.
pub struct Shared {
    pub stats: Mutex<FrameStats>,
    // When the person asked for the regions to be saved, until the next frame
    // saves them.
    pub region_request: Mutex<Option<Instant>>,
    // Map every frame and crop the regions from it, as the Spotter will, so
    // the CPU figure includes reading the pixels back.
    pub readback: bool,
    // Log every frame, not just the summary each second.
    pub each_frame: bool,
    pub captures: PathBuf,
}

// Keeps the capture running while it's held.
pub struct Capture {
    _pool: Direct3D11CaptureFramePool,
    _session: GraphicsCaptureSession,
}

pub fn start(target: Target, shared: Arc<Shared>) -> Result<Capture> {
    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item: GraphicsCaptureItem = match target {
        Target::Window => {
            let window = wait_for_window();
            unsafe { interop.CreateForWindow(window)? }
        }
        Target::Monitor => unsafe {
            interop.CreateForMonitor(MonitorFromPoint(
                POINT { x: 0, y: 0 },
                MONITOR_DEFAULTTOPRIMARY,
            ))?
        },
    };

    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device: ID3D11Device = device.unwrap();
    // WGC uses the device from its own threads too.
    // It returns whether it was on before, which doesn't matter here.
    let _ = unsafe {
        device
            .cast::<ID3D11Multithread>()?
            .SetMultithreadProtected(true)
    };
    let context: ID3D11DeviceContext = context.unwrap();
    let winrt_device: IDirect3DDevice =
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&device.cast::<IDXGIDevice>()?)? }.cast()?;

    let size = item.Size()?;
    log(
        Instant::now(),
        "frame",
        &format!(
            "capturing {:?} at {}x{}",
            item.DisplayName()?.to_string(),
            size.Width,
            size.Height
        ),
    );
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &winrt_device,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )?;
    let reader = Mutex::new(Reader {
        device,
        context,
        winrt_device,
        size,
        staging: None,
    });
    pool.FrameArrived(&TypedEventHandler::new(
        move |pool: Ref<Direct3D11CaptureFramePool>, _| {
            let at = Instant::now();
            let mut stats = shared.stats.lock().unwrap();
            let gap = stats.gap(at);
            let stall = stats.frame(at);
            drop(stats);
            if let Some(gap) = stall {
                log(
                    at,
                    "frame",
                    &format!("stall: {:.0} ms since the last frame", millis(gap)),
                );
            } else if let (true, Some(gap)) = (shared.each_frame, gap) {
                log(
                    at,
                    "frame",
                    &format!("{:.1} ms since the last frame", millis(gap)),
                );
            }
            let pool = pool.ok()?;
            let frame = pool.TryGetNextFrame()?;
            let request = shared.region_request.lock().unwrap().take();
            let mut reader = reader.lock().unwrap();
            let content = frame.ContentSize()?;
            if content != reader.size {
                log(
                    at,
                    "frame",
                    &format!("frame size now {}x{}", content.Width, content.Height),
                );
                reader.size = content;
                pool.Recreate(
                    &reader.winrt_device,
                    DirectXPixelFormat::B8G8R8A8UIntNormalized,
                    2,
                    content,
                )?;
                return Ok(());
            }
            if shared.readback || request.is_some() {
                let texture: ID3D11Texture2D = unsafe {
                    frame
                        .Surface()?
                        .cast::<IDirect3DDxgiInterfaceAccess>()?
                        .GetInterface()?
                };
                let images = reader.read_back(&texture, request.is_some())?;
                if let Some(asked_at) = request {
                    save(&shared.captures, asked_at, at, images);
                }
            }
            Ok(())
        },
    ))?;
    item.Closed(&TypedEventHandler::new(|_, _| {
        log(
            Instant::now(),
            "frame",
            "the captured window closed; frames have stopped",
        );
        Ok(())
    }))?;

    let session = pool.CreateCaptureSession(&item)?;
    // Not on every version of Windows, and not needed.
    let _ = session.SetIsCursorCaptureEnabled(false);
    let _ = session.SetIsBorderRequired(false);
    session.StartCapture()?;
    Ok(Capture {
        _pool: pool,
        _session: session,
    })
}

struct Reader {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    winrt_device: IDirect3DDevice,
    size: SizeInt32,
    // A CPU-readable copy of the frame, remade when the size changes.
    staging: Option<(ID3D11Texture2D, u32, u32)>,
}

// SAFETY: the D3D11 device is free-threaded, and the immediate context, which
// isn't, is only used behind the Mutex the Reader is kept in.
unsafe impl Send for Reader {}

impl Reader {
    // Copies the frame to the CPU and crops the regions out of it, with the
    // whole frame too when `whole` is set.
    fn read_back(
        &mut self,
        texture: &ID3D11Texture2D,
        whole: bool,
    ) -> Result<Vec<(&'static str, Image)>> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        if !matches!(self.staging, Some((_, w, h)) if w == desc.Width && h == desc.Height) {
            let staging_desc = D3D11_TEXTURE2D_DESC {
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
                ..desc
            };
            let mut staging = None;
            unsafe {
                self.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))?
            };
            self.staging = Some((staging.unwrap(), desc.Width, desc.Height));
        }
        let (staging, width, height) = self.staging.as_ref().unwrap();
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.context.CopyResource(staging, texture);
            self.context
                .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        }
        let row_pitch = mapped.RowPitch as usize;
        // SAFETY: the mapping holds `height` rows of `row_pitch` bytes until
        // the Unmap below, and nothing else uses the staging texture.
        let bgra = unsafe {
            std::slice::from_raw_parts(mapped.pData as *const u8, row_pitch * *height as usize)
        };
        let frame = Frame {
            bgra,
            width: *width,
            height: *height,
            row_pitch,
        };
        let mut images: Vec<_> = REGIONS.iter().map(|r| (r.name, crop(&frame, r))).collect();
        if whole {
            images.push((FRAME.name, crop(&frame, &FRAME)));
        }
        unsafe { self.context.Unmap(staging, 0) };
        Ok(images)
    }
}

// Encoding is slow, so it's done off the capture thread.
fn save(folder: &Path, asked_at: Instant, frame_at: Instant, images: Vec<(&'static str, Image)>) {
    let folder = folder.to_path_buf();
    thread::spawn(move || {
        if let Err(e) = std::fs::create_dir_all(&folder) {
            log(
                Instant::now(),
                "region",
                &format!("can't make {}: {e}", folder.display()),
            );
            return;
        }
        let stamp = format!("{:010.3}", seconds(frame_at));
        for (name, image) in images {
            let path = folder.join(format!("{stamp}-{name}.png"));
            match save_png(&path, &image) {
                Ok(()) => log(
                    frame_at,
                    "region",
                    &format!(
                        "saved {} ({}x{}), {:.0} ms after asking",
                        path.display(),
                        image.width,
                        image.height,
                        millis(frame_at - asked_at)
                    ),
                ),
                Err(e) => log(
                    Instant::now(),
                    "region",
                    &format!("can't save {}: {e}", path.display()),
                ),
            }
        }
    });
}

// The game's window, waited for until it's open.
fn wait_for_window() -> HWND {
    let mut said = false;
    loop {
        if let Some(window) = find_window() {
            return window;
        }
        if !said {
            log(Instant::now(), "frame", "waiting for the ELDEN RING window");
            said = true;
        }
        thread::sleep(Duration::from_secs(2));
    }
}

// A visible window titled ELDEN RING™, which a browser tab about the game
// isn't. Titles are read from the window list, which never opens the process
// that owns the window.
fn find_window() -> Option<HWND> {
    unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
        let mut title = [0u16; 64];
        let len = unsafe { GetWindowTextW(window, &mut title) } as usize;
        if unsafe { IsWindowVisible(window) }.as_bool()
            && String::from_utf16_lossy(&title[..len]).trim_end_matches('™') == "ELDEN RING"
        {
            unsafe { *(found.0 as *mut Option<HWND>) = Some(window) };
            return false.into();
        }
        true.into()
    }
    let mut found: Option<HWND> = None;
    // Stopping early reports an error, which is expected.
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize)) };
    found
}
