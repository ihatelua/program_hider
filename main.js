// main.js
const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { windowManager } = require('node-window-manager');

let mainWindow = null;
let tray = null;

// 현재 선택된 창(id 목록) + 숨겨진 창 상태를 메모리에 유지
let config = null;
let hiddenWindows = new Map(); // id -> { bounds }

// 설정 파일 경로
function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  const defaultConfig = {
    hideHotkey: 'Control+Alt+H',
    showHotkey: 'Control+Alt+S',
    selectedWindowIds: [], // number[]
     excludedPaths: [
      'SearchApp.exe', 
      'Microsoft.Windows.Search_cw5n1h2txyewy\\SearchApp.exe',
      'C:\Windows\System32\ApplicationFrameHost.exe',
      'C:\Windows\SystemApps\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\StartMenuExperienceHost.exe',
      'TextInputHost.exe',
      'SystemSettings.exe',
      'ShellExperienceHost.exe',
      'electron.exe',
      'LockApp.exe'
    ]
  };

  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return defaultConfig;
}

function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// 진짜 화면에 보이는 "윈도우 창"만 골라서 목록으로 만들기
function listWindows() {
  const wins = windowManager.getWindows();

  const excluded = (config && Array.isArray(config.excludedPaths))
    ? config.excludedPaths
    : [];

  return wins
    .filter(w => {
      try {
        // 정상적인 윈도우 핸들인지
        if (!w.isWindow || !w.isWindow()) return false;

        // 화면에 보이는 창인지
        if (w.isVisible && !w.isVisible()) return false;

        // 최소 크기 이상인지 (너무 작은 내부 창 제거)
        const b = w.getBounds();
        if (!b || b.width < 100 || b.height < 50) return false;

        // 제목이 있는 실제 창만
        const title = (w.getTitle() || '').trim();
        if (!title) return false;

        // 🔴 여기: 경로 기반 제외
        const p = (w.path || '').toLowerCase();
        for (const pattern of excluded) {
          if (!pattern) continue;
          const pat = pattern.toLowerCase();
          if (pat && p.includes(pat)) {
            return false; // 제외 목록에 걸리면 보여주지 않음
          }
        }

        return true;
      } catch (e) {
        return false;
      }
    })
    .map(w => {
      let iconBase64 = null;
      try {
        if (w.getIcon) {
          const buf = w.getIcon(32); // 32x32 아이콘
          if (buf && buf.length) {
            iconBase64 = buf.toString('base64');
          }
        }
      } catch (e) {
        // 아이콘 못 가져와도 그냥 무시
      }

      return {
        id: w.id,
        title: w.getTitle(),
        path: w.path,
        iconBase64 // 렌더러에서 data URL로 써먹을 예정
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// 선택된 창 전부 숨기기
function hideSelectedWindows() {
  if (!config.selectedWindowIds || config.selectedWindowIds.length === 0) {
    console.log('선택된 창 없음');
    return;
  }

  const all = windowManager.getWindows();
  const byId = new Map(all.map(w => [w.id, w]));

  config.selectedWindowIds.forEach(id => {
    const win = byId.get(id);
    if (!win) return;

    try {
      const bounds = win.getBounds();
      const wasMinimized = typeof win.isMinimized === 'function' ? win.isMinimized() : false;
      const wasMaximized = typeof win.isMaximized === 'function' ? win.isMaximized() : false;

      // 나중에 상태 복원을 위해 저장
      hiddenWindows.set(id, { bounds, wasMinimized, wasMaximized });

      if (typeof win.hide === 'function') {
        // 작업표시줄 / Alt+Tab 에서도 사라지게
        win.hide();
      } else {
        // hide() 지원 안 되는 환경 fallback
        if (!wasMinimized) {
          win.minimize();
        }
        win.setBounds({ ...bounds, x: 5000, y: 5000 });
      }

      console.log(
        '숨김:',
        id,
        win.getTitle(),
        `(minimized=${wasMinimized}, maximized=${wasMaximized})`
      );
    } catch (e) {
      console.error('hideSelectedWindows error:', e);
    }
  });
}

// 숨겼던 창 전부 다시 보이기
function restoreHiddenWindows() {
  if (hiddenWindows.size === 0) {
    console.log('숨긴 창 없음');
    return;
  }

  const all = windowManager.getWindows();
  const byId = new Map(all.map(w => [w.id, w]));

  for (const [id, state] of hiddenWindows.entries()) {
    const win = byId.get(id);
    if (!win) {
      hiddenWindows.delete(id);
      continue;
    }

    try {
      const { bounds, wasMinimized, wasMaximized } = state || {};

      // 우선 다시 보이게
      if (typeof win.show === 'function') {
        win.show();
      }

      // 위치/크기 복원 (있을 경우)
      if (bounds) {
        win.setBounds(bounds);
      }

      // 원래 최소화였던 창이면: 최소화 상태만 유지 (작업표시줄에만 보이게)
      if (wasMinimized) {
        if (typeof win.minimize === 'function') {
          win.minimize();
        }
        // 일부러 bringToTop 하지 않음
        console.log('복원 (최소화 유지):', id, win.getTitle());
      } else {
        // 원래 정상/최대화 상태였던 창은 앞에 보이도록
        if (wasMaximized && typeof win.maximize === 'function') {
          win.maximize();
        } else if (typeof win.restore === 'function') {
          win.restore();
        }

        if (typeof win.bringToTop === 'function') {
          win.bringToTop();
        }
        console.log('복원 (표시):', id, win.getTitle());
      }

      hiddenWindows.delete(id);
    } catch (e) {
      console.error('restoreHiddenWindows error:', e);
    }
  }
}


// 글로벌 단축키 등록
function registerShortcuts() {
  globalShortcut.unregisterAll();

  if (config.hideHotkey) {
    const ok = globalShortcut.register(config.hideHotkey, () => {
      hideSelectedWindows();
    });
    if (!ok) console.warn('hideHotkey 등록 실패:', config.hideHotkey);
  }

  if (config.showHotkey) {
    const ok = globalShortcut.register(config.showHotkey, () => {
      restoreHiddenWindows();
    });
    if (!ok) console.warn('showHotkey 등록 실패:', config.showHotkey);
  }
}

// 트레이 생성
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const trayIcon = nativeImage.createFromPath(
    path.join(__dirname, 'assets', 'tray.ico')  // ⬅ 여기!
  );

  tray = new Tray(trayIcon);
  tray.setToolTip('Window Hider');

  const menu = Menu.buildFromTemplate([
    {
      label: '열기',
      click: () => {
        if (!mainWindow) {
          createMainWindow();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: `숨기기 (${config.hideHotkey})`,
      click: () => hideSelectedWindows()
    },
    {
      label: `복원 (${config.showHotkey})`,
      click: () => restoreHiddenWindows()
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(menu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
}

// 설정/윈도 목록 IPC 핸들러 등록
function setupIpc() {
  ipcMain.handle('get-config', () => {
    return config;
  });

  ipcMain.handle('get-windows', () => {
    return listWindows();
  });

  ipcMain.handle('save-settings', (event, payload) => {
    const { hideHotkey, showHotkey, selectedWindowIds, excludePatterns } = payload || {};

    const newConfig = {
      hideHotkey: hideHotkey || config.hideHotkey,
      showHotkey: showHotkey || config.showHotkey,
      selectedWindowIds: Array.isArray(selectedWindowIds)
        ? selectedWindowIds
        : config.selectedWindowIds,
      excludedPaths: Array.isArray(excludePatterns)
      ? excludePatterns
      : (config.excludedPaths || [])
    };

    saveConfig(newConfig);
    registerShortcuts();
    return config;
  });

  // "지금 숨기기" / "지금 복원" 버튼용 (단축키 안 누르고 테스트)
  ipcMain.handle('hide-now', () => {
    hideSelectedWindows();
  });
  ipcMain.handle('show-now', () => {
    restoreHiddenWindows();
  });
}

// 메인 윈도우 생성 (설정 UI)
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 1150,
    resizable: true,
    center: true,
    icon: path.join(__dirname, 'assets', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');

  // 🔹 여기 추가: 최소화할 때 작업표시줄에서 빼고 트레이로만 숨기기
  mainWindow.on('minimize', (e) => {
    e.preventDefault();   // 원래 최소화 동작 막고
    mainWindow.hide();    // 창 숨김 → 트레이 아이콘만 남음
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  config = loadConfig();
  createMainWindow();
  createTray();
  setupIpc();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
