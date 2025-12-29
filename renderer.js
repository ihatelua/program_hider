// renderer.js

const api = window.windowHiderApi;

const hideHotkeyInput = document.getElementById('hideHotkey');
const showHotkeyInput = document.getElementById('showHotkey');
const tableBody = document.getElementById('windowTableBody');
const saveBtn = document.getElementById('saveBtn');
const refreshBtn = document.getElementById('refreshBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const hideNowBtn = document.getElementById('hideNowBtn');
const showNowBtn = document.getElementById('showNowBtn');
const statusEl = document.getElementById('status');
const excludePathsTextarea = document.getElementById('excludePaths');

let currentWindows = []; // {id,title,path,iconBase64}
let selectedIds = new Set();

// 자동 저장 디바운스용
let saveTimer = null;
function scheduleAutoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  // 300ms 정도 쉬었다가 저장 (타이핑 중일 때 너무 자주 저장되는 것 방지)
  saveTimer = setTimeout(() => {
    saveSettings({ manual: false });
  }, 300);
}

// 상태 메시지 표시
function setStatus(msg, type = 'ok') {
  statusEl.textContent = msg;
  statusEl.classList.remove('ok', 'error');
  statusEl.classList.add(type);
}

// Electron accelerator 문자열 생성
function buildAcceleratorFromEvent(e) {
  const parts = [];

  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super'); // 윈도우키

  const onlyModifier =
    (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') &&
    parts.length > 0;

  if (onlyModifier) {
    return null;
  }

  let keyPart = '';

  if (e.code && e.code.startsWith('Key')) {
    keyPart = e.code.slice(3).toUpperCase(); // KeyA -> A
  } else if (e.code && e.code.startsWith('Digit')) {
    keyPart = e.code.slice(5); // Digit1 -> 1
  } else if (e.key && e.key.length === 1) {
    keyPart = e.key.toUpperCase();
  } else if (e.key) {
    keyPart = e.key;
  }

  if (!keyPart) return null;

  parts.push(keyPart);
  return parts.join('+');
}

// 입력 칸에 키 캡처 로직 붙이기
function attachHotkeyCapture(inputEl) {
  inputEl.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const accel = buildAcceleratorFromEvent(e);
    if (!accel) {
      inputEl.value = '';
      // 자동 저장 모드에서는 굳이 오류 표시 안 하고 조용히 있음
      setStatus('Ctrl / Alt / Shift / Win 키는 다른 키와 같이 눌러주세요.', 'error');
      return;
    }

    inputEl.value = accel;
    setStatus(`입력된 단축키: ${accel}`, 'ok');
    scheduleAutoSave();
  });

  inputEl.addEventListener('focus', () => {
    inputEl.select();
  });
}

// 테이블 렌더링
function renderTable() {
  tableBody.innerHTML = '';

  if (currentWindows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = '표시할 창이 없습니다.';
    td.style.textAlign = 'center';
    td.style.padding = '16px';
    tr.appendChild(td);
    tableBody.appendChild(tr);
    return;
  }

  currentWindows.forEach(win => {
    const tr = document.createElement('tr');

    // 체크박스
    const tdCheck = document.createElement('td');
    tdCheck.className = 'checkbox-col';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = String(win.id);
    if (selectedIds.has(win.id)) cb.checked = true;
    cb.addEventListener('change', () => {
      const id = win.id;
      if (cb.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      scheduleAutoSave();
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    // 아이콘
    const tdIcon = document.createElement('td');
    tdIcon.className = 'icon-col';
    if (win.iconBase64) {
      const img = document.createElement('img');
      img.className = 'icon-img';
      img.src = `data:image/png;base64,${win.iconBase64}`;
      tdIcon.appendChild(img);
    } else {
      tdIcon.textContent = '🗔';
    }
    tr.appendChild(tdIcon);

    // 제목
    const tdTitle = document.createElement('td');
    tdTitle.className = 'title-cell';
    tdTitle.textContent = win.title || '(제목 없음)';
    tr.appendChild(tdTitle);

    // 경로
    const tdPath = document.createElement('td');
    tdPath.className = 'path-cell';
    tdPath.textContent = win.path || '';
    tr.appendChild(tdPath);

    tableBody.appendChild(tr);
  });
}

// 설정 로드
async function loadConfigAndWindows() {
  try {
    const conf = await api.getConfig();
    if (conf) {
      hideHotkeyInput.value = conf.hideHotkey || '';
      showHotkeyInput.value = conf.showHotkey || '';
      selectedIds = new Set(conf.selectedWindowIds || []);

      if (Array.isArray(conf.excludedPaths)) {
        excludePathsTextarea.value = conf.excludedPaths.join('\n');
      } else {
        excludePathsTextarea.value = '';
      }
    }

    currentWindows = await api.getWindows();
    renderTable();
    setStatus('설정을 불러왔습니다.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('설정/윈도 목록을 불러오지 못했습니다.', 'error');
  }
}

// 설정 저장 (manual=true 는 사용자가 버튼 누른 케이스)
async function saveSettings({ manual } = { manual: false }) {
  const hideHotkey = hideHotkeyInput.value.trim();
  const showHotkey = showHotkeyInput.value.trim();

  // 단축키가 둘 중 하나라도 없으면 자동 저장일 때는 조용히 skip
  if (!hideHotkey || !showHotkey) {
    if (manual) {
      setStatus('단축키를 모두 입력해야 합니다.', 'error');
    }
    return;
  }

  const raw = excludePathsTextarea.value || '';
  const excludePatterns = raw
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  try {
    const payload = {
      hideHotkey,
      showHotkey,
      selectedWindowIds: Array.from(selectedIds),
      excludePatterns
    };
    const updated = await api.saveSettings(payload);

    if (manual) {
      setStatus(
        `설정 저장 및 단축키 등록 완료 (숨기기: ${updated.hideHotkey}, 복원: ${updated.showHotkey})`,
        'ok'
      );
    } else {
      setStatus('자동 저장 완료', 'ok');
    }
  } catch (e) {
    console.error(e);
    setStatus('설정을 저장하지 못했습니다.', 'error');
  }
}

// 윈도 목록 새로고침
async function refreshWindows() {
  try {
    currentWindows = await api.getWindows();
    const newIds = new Set(currentWindows.map(w => w.id));
    selectedIds = new Set(Array.from(selectedIds).filter(id => newIds.has(id)));
    renderTable();
    setStatus('윈도 목록을 새로고침했습니다.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('윈도 목록 새로고침 실패.', 'error');
  }
}

// 전체 선택 / 해제
function selectAll() {
  currentWindows.forEach(w => selectedIds.add(w.id));
  renderTable();
  scheduleAutoSave();
}

function clearSelection() {
  selectedIds.clear();
  renderTable();
  scheduleAutoSave();
}

// 지금 숨기기 / 복원
async function hideNow() {
  try {
    await saveSettings({ manual: true });
    await api.hideNow();
    setStatus('선택된 창을 숨겼습니다.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('창 숨기기 중 오류가 발생했습니다.', 'error');
  }
}

async function showNow() {
  try {Control+Shift+T
    await api.showNow();
    setStatus('숨긴 창을 복원했습니다.', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('창 복원 중 오류가 발생했습니다.', 'error');
  }
}

// 이벤트 바인딩
saveBtn.addEventListener('click', () => saveSettings({ manual: true }));
refreshBtn.addEventListener('click', refreshWindows);
selectAllBtn.addEventListener('click', selectAll);
clearSelectionBtn.addEventListener('click', clearSelection);
hideNowBtn.addEventListener('click', hideNow);
showNowBtn.addEventListener('click', showNow);

// 제외 목록 textarea 변경 → 자동 저장
excludePathsTextarea.addEventListener('input', () => {
  scheduleAutoSave();
});

window.addEventListener('DOMContentLoaded', () => {
  attachHotkeyCapture(hideHotkeyInput);
  attachHotkeyCapture(showHotkeyInput);
  loadConfigAndWindows();
});
