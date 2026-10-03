'use strict';
// ---------- IndexedDB ----------
const DB_NAME = 'gallery-db';
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('photos', { keyPath: 'id' });
      r.result.createObjectStore('albums', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = (store, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(store, mode);
  const out = fn(t.objectStore(store));
  t.oncomplete = () => res(out && out.result);
  t.onerror = () => rej(t.error);
});
const dbAll = s => tx(s, 'readonly', st => st.getAll());
const dbPut = (s, v) => tx(s, 'readwrite', st => st.put(v));
const dbDel = (s, id) => tx(s, 'readwrite', st => st.delete(id));

// ---------- State ----------
let photos = [], albums = [];
const urls = new Map(); // photoId -> object URL
let view = 'photos';     // photos | albums | album
let curAlbum = null;
let selected = new Set();
let query = '';
let lbList = [], lbIdx = 0;

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const urlOf = p => { if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob)); return urls.get(p.id); };
const photoById = id => photos.find(p => p.id === id);
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2500);
}
function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- Dialog helper ----------
function dialog(title, bodyHTML, onOpen) {
  return new Promise(resolve => {
    const d = $('dlg');
    $('dlgTitle').textContent = title;
    $('dlgBody').innerHTML = bodyHTML;
    if (onOpen) onOpen();
    const done = v => { d.close(); resolve(v); };
    $('dlgForm').onsubmit = e => { e.preventDefault(); done(true); };
    $('dlgCancel').onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
    const f = $('dlgBody').querySelector('input[type=text]'); if (f) f.focus();
  });
}
async function askText(title, value = '') {
  const ok = await dialog(title, `<input type="text" id="dlgText" value="${esc(value)}">`);
  const v = $('dlgText').value.trim();
  return ok && v ? v : null;
}
async function confirmBox(title, text) {
  return dialog(title, `<p>${esc(text)}</p>`);
}

// ---------- Upload ----------
async function addFiles(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return toast('Không có file ảnh hợp lệ');
  const newIds = [];
  for (const f of imgs) {
    const p = { id: uid(), name: f.name, blob: f, added: Date.now() };
    photos.push(p); newIds.push(p.id);
    await dbPut('photos', p);
  }
  // đang ở trong album thì thêm luôn vào album đó
  if (view === 'album' && curAlbum) {
    curAlbum.photoIds.push(...newIds);
    await dbPut('albums', curAlbum);
  }
  toast(`Đã tải lên ${imgs.length} ảnh`);
  render();
}

// ---------- Render ----------
function visiblePhotos() {
  let list = photos;
  if (view === 'album' && curAlbum) list = curAlbum.photoIds.map(photoById).filter(Boolean);
  else list = [...photos].sort((a, b) => b.added - a.added);
  if (query) list = list.filter(p => p.name.toLowerCase().includes(query));
  return list;
}

function render() {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === (view === 'album' ? 'albums' : view)));
  $('cntPhotos').textContent = `(${photos.length})`;
  $('cntAlbums').textContent = `(${albums.length})`;
  $('albumHead').hidden = view !== 'album';
  if (view === 'album') $('albumTitle').textContent = curAlbum.name;
  const grid = $('grid'), empty = $('empty');
  grid.innerHTML = '';
  grid.classList.toggle('selecting', selected.size > 0);

  if (view === 'albums') {
    $('empty').hidden = albums.length > 0;
    empty.innerHTML = 'Chưa có album nào.<br>Chọn vài ảnh rồi bấm “Thêm vào album” để tạo album.';
    const q = query;
    for (const a of albums.filter(a => !q || a.name.toLowerCase().includes(q))) {
      const cover = photoById(a.cover) || photoById(a.photoIds.find(id => photoById(id)));
      const n = a.photoIds.filter(photoById).length;
      const el = document.createElement('div');
      el.className = 'album';
      el.innerHTML = `<div class="cover">${cover ? `<img src="${urlOf(cover)}" alt="">` : '🖼'}</div>
        <div class="info"><b>${esc(a.name)}</b><small>${n} ảnh</small></div>`;
      el.onclick = () => { curAlbum = a; view = 'album'; selected.clear(); render(); };
      grid.appendChild(el);
    }
    updateSelbar(); return;
  }

  const list = visiblePhotos();
  empty.hidden = list.length > 0;
  empty.innerHTML = query ? 'Không tìm thấy ảnh nào.'
    : view === 'album' ? 'Album trống. Tải ảnh lên (sẽ tự thêm vào album này) hoặc thêm từ “Tất cả ảnh”.'
    : 'Chưa có ảnh. Bấm “Tải ảnh lên” hoặc kéo thả ảnh vào trang.';
  list.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'item' + (selected.has(p.id) ? ' sel' : '');
    el.innerHTML = `<img loading="lazy" src="${urlOf(p)}" alt="${esc(p.name)}"><div class="chk">${selected.has(p.id) ? '✓' : ''}</div><div class="name">${esc(p.name)}</div>`;
    el.querySelector('.chk').onclick = e => { e.stopPropagation(); toggleSel(p.id); };
    el.onclick = () => selected.size ? toggleSel(p.id) : openLightbox(list, i);
    grid.appendChild(el);
  });
  updateSelbar();
}

function toggleSel(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  render();
}
function updateSelbar() {
  const n = selected.size;
  $('selbar').hidden = n === 0;
  $('selCount').textContent = `Đã chọn ${n} ảnh`;
  $('btnRemoveFromAlbum').hidden = view !== 'album';
  $('btnSetCover').hidden = view !== 'album' || n !== 1;
}

// ---------- Actions on selection ----------
async function addToAlbum() {
  const ids = [...selected];
  let choice = 'new';
  const ok = await dialog('Thêm vào album', `
    <div class="optlist">
      <label class="opt"><input type="radio" name="al" value="new" checked> ＋ Album mới</label>
      ${albums.map(a => `<label class="opt"><input type="radio" name="al" value="${a.id}"> ${esc(a.name)}</label>`).join('')}
    </div>
    <input type="text" id="dlgText" placeholder="Tên album mới">`);
  if (!ok) return;
  choice = document.querySelector('input[name=al]:checked').value;
  let album;
  if (choice === 'new') {
    const name = $('dlgText').value.trim();
    if (!name) return toast('Hãy nhập tên album');
    album = { id: uid(), name, photoIds: [], cover: null, created: Date.now() };
    albums.push(album);
  } else album = albums.find(a => a.id === choice);
  const before = album.photoIds.length;
  for (const id of ids) if (!album.photoIds.includes(id)) album.photoIds.push(id);
  await dbPut('albums', album);
  toast(`Đã thêm ${album.photoIds.length - before} ảnh vào “${album.name}”`);
  selected.clear(); render();
}

async function removeFromAlbum() {
  curAlbum.photoIds = curAlbum.photoIds.filter(id => !selected.has(id));
  if (selected.has(curAlbum.cover)) curAlbum.cover = null;
  await dbPut('albums', curAlbum);
  selected.clear(); render();
}

async function setCover() {
  curAlbum.cover = [...selected][0];
  await dbPut('albums', curAlbum);
  selected.clear(); toast('Đã đặt ảnh bìa'); render();
}

async function deletePhotos() {
  const ids = [...selected];
  if (!await confirmBox('Xóa ảnh', `Xóa vĩnh viễn ${ids.length} ảnh khỏi thư viện (và mọi album)?`)) return;
  for (const id of ids) {
    await dbDel('photos', id);
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  }
  photos = photos.filter(p => !selected.has(p.id));
  for (const a of albums) {
    if (a.photoIds.some(id => selected.has(id))) {
      a.photoIds = a.photoIds.filter(id => !selected.has(id));
      if (selected.has(a.cover)) a.cover = null;
      await dbPut('albums', a);
    }
  }
  selected.clear(); toast(`Đã xóa ${ids.length} ảnh`); render();
}

async function renameAlbum() {
  const name = await askText('Đổi tên album', curAlbum.name);
  if (!name) return;
  curAlbum.name = name; await dbPut('albums', curAlbum); render();
}
async function deleteAlbum() {
  if (!await confirmBox('Xóa album', `Xóa album “${curAlbum.name}”? Ảnh vẫn được giữ trong thư viện.`)) return;
  await dbDel('albums', curAlbum.id);
  albums = albums.filter(a => a !== curAlbum);
  curAlbum = null; view = 'albums'; render();
}

// ---------- Lightbox ----------
function openLightbox(list, i) { lbList = list; lbIdx = i; showLb(); $('lightbox').hidden = false; }
function showLb() {
  const p = lbList[lbIdx];
  $('lbImg').src = urlOf(p);
  $('lbCap').textContent = `${p.name}  (${lbIdx + 1}/${lbList.length})`;
}
const lbMove = d => { lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLb(); };
const closeLb = () => $('lightbox').hidden = true;

// ---------- Events ----------
function bind() {
  $('btnUpload').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    view = t.dataset.view; curAlbum = null; selected.clear(); render();
  });
  $('search').oninput = e => { query = e.target.value.trim().toLowerCase(); render(); };
  $('btnBack').onclick = () => { view = 'albums'; curAlbum = null; selected.clear(); render(); };
  $('btnRename').onclick = renameAlbum;
  $('btnDelAlbum').onclick = deleteAlbum;
  $('btnToAlbum').onclick = addToAlbum;
  $('btnRemoveFromAlbum').onclick = removeFromAlbum;
  $('btnSetCover').onclick = setCover;
  $('btnDelete').onclick = deletePhotos;
  $('btnClearSel').onclick = () => { selected.clear(); render(); };
  $('btnSelAll').onclick = () => { visiblePhotos().forEach(p => selected.add(p.id)); render(); };
  $('lbClose').onclick = closeLb;
  $('lbPrev').onclick = () => lbMove(-1);
  $('lbNext').onclick = () => lbMove(1);
  $('lightbox').onclick = e => { if (e.target.id === 'lightbox') closeLb(); };
  document.addEventListener('keydown', e => {
    if ($('lightbox').hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') lbMove(-1);
    if (e.key === 'ArrowRight') lbMove(1);
  });
  // kéo thả
  let depth = 0;
  addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { depth++; $('drop').hidden = false; } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => {
    e.preventDefault(); depth = 0; $('drop').hidden = true;
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

(async function init() {
  try {
    db = await openDB();
    [photos, albums] = await Promise.all([dbAll('photos'), dbAll('albums')]);
  } catch (err) {
    toast('Không mở được bộ nhớ trình duyệt: ' + err.message);
  }
  bind(); render();
})();
