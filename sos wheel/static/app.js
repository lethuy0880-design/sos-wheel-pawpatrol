const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { location: null, services: [], settings: { radius_km: 200 }, selectedCode: null, selectedMechanic: null, mechanics: [], map: null, markers: [], order: null, rating: 0, wizardStep: 0, wizardAnswers: [], mechanicToken: localStorage.getItem('sos_mechanic_token'), adminToken: localStorage.getItem('sos_admin_token'), pollTimer: null, fuelLayer: null, fastTrackPending: false };
const statusNames = { pending: 'Đang tìm thợ', accepted: 'Thợ đã nhận đơn', arriving: 'Thợ đang đến', in_progress: 'Đang sửa xe', completed: 'Đã hoàn thành', cancelled: 'Đã hủy' };

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...options.headers };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Có lỗi xảy ra. Vui lòng thử lại.');
  return data;
}
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('visible'), 3200); }
function setMessage(element, message, success = false) { element.textContent = message; element.classList.toggle('success', success); }
function money(value) { return new Intl.NumberFormat('vi-VN').format(value) + 'đ'; }
function dogAvatarMarkup() { return '<svg class="dog-avatar" viewBox="0 0 64 64" aria-hidden="true"><path class="dog-ear" d="M14 20 6 10q-3 19 9 25m35-15 8-10q3 19-9 25"/><path class="dog-face" d="M13 25q0-18 19-18t19 18v13q0 17-19 20-19-3-19-20Z"/><ellipse class="dog-muzzle" cx="32" cy="39" rx="13" ry="9"/><circle class="dog-eye" cx="23" cy="29" r="2.6"/><circle class="dog-eye" cx="41" cy="29" r="2.6"/><path class="dog-nose" d="M28 36q4-5 8 0-1 5-4 5t-4-5Z"/><path class="dog-smile" d="M32 41v3m0 0q-4 4-7 0m7 0q4 4 7 0"/></svg>'; }
function initMap() {
  state.map = L.map('map', { zoomControl: false }).setView([10.7769, 106.7009], 13);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(state.map);
}
function marker(iconClass, variant = 0) {
  const isMechanic = iconClass === 'mechanic-marker';
  const html = isMechanic ? `<div class="patrol-pin pin-${variant % 3}" aria-label="Thợ cứu hộ">${dogAvatarMarkup()}</div>` : `<div class="custom-marker ${iconClass}"></div>`;
  return L.divIcon({ className: '', html, iconSize: isMechanic ? [34, 38] : [25, 25], iconAnchor: isMechanic ? [17, 34] : [12, 12] });
}
function setLocation(position) {
  state.location = { lat: position.coords.latitude, lng: position.coords.longitude };
  $('#location-title').textContent = 'Vị trí đã được xác định';
  $('#location-subtitle').textContent = `${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`;
  $('#map-status').textContent = 'Đã xác định vị trí của bạn';
  if (!state.customerMarker) state.customerMarker = L.marker([state.location.lat, state.location.lng], { icon: marker('customer-marker') }).addTo(state.map).bindPopup('Vị trí của bạn');
  else state.customerMarker.setLatLng([state.location.lat, state.location.lng]);
  state.map.setView([state.location.lat, state.location.lng], 14);
  loadNearby().then(() => {
    if (state.fastTrackPending) {
      state.fastTrackPending = false;
      continueFastTrack();
    }
  });
}
function requestLocation() {
  if (!navigator.geolocation) {
    state.fastTrackPending = false;
    return showToast('Trình duyệt này không hỗ trợ định vị.');
  }
  $('#location-title').textContent = 'Đang xác định vị trí...';
  navigator.geolocation.getCurrentPosition(setLocation, error => { state.fastTrackPending = false; $('#location-title').textContent = 'Không thể lấy vị trí'; $('#location-subtitle').textContent = 'Kiểm tra quyền định vị và thử lại'; showToast(error.code === 1 ? 'Bạn cần cho phép truy cập vị trí để tìm thợ.' : 'Không lấy được vị trí. Hãy thử lại.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}
async function loadServices() { state.services = await api('/api/services'); }
async function loadSettings() { state.settings = await api('/api/settings'); $('#radius-note').textContent = `Vị trí chỉ được sử dụng để kết nối cứu hộ trong khu vực ${state.settings.radius_km} km.`; }
function renderQuote(quote) {
  $('#quote-content').innerHTML = `<div class="quote-card"><div><span class="price-label">${quote.service.name}</span><strong class="price">${money(quote.total_min)} – ${money(quote.total_max)}</strong></div><div class="travel">Di chuyển ${money(quote.travel_fee)}<br>Khoảng cách tính phí ${quote.adjusted_distance_km} km</div></div>`;
}
async function chooseService(code) {
  state.selectedCode = code;
  $$('.issue-option').forEach(button => {
    button.classList.toggle('selected', button.dataset.code === code);
    button.classList.remove('service-bounce');
  });
  const chosen = $(`[data-code="${code}"]`);
  if (chosen) requestAnimationFrame(() => chosen.classList.add('service-bounce'));
  if (!state.location) { showToast('Bật định vị để tính giá và tìm thợ quanh bạn.'); return; }
  $('#mechanic-list').querySelectorAll('[data-mechanic]').forEach(button => { button.disabled = false; });
  try { renderQuote(await api(`/api/quote?service_code=${encodeURIComponent(code)}`, { method: 'POST', body: JSON.stringify(state.location) })); }
  catch (error) { showToast(error.message); }
}
async function loadNearby() {
  try {
    state.mechanics = await api(`/api/mechanics/nearby?lat=${state.location.lat}&lng=${state.location.lng}`);
    $('#nearby-count').textContent = `${state.mechanics.length} thợ trong bán kính ${state.settings.radius_km} km`;
    $('#active-worker-count').textContent = `${state.mechanics.length} thợ cứu hộ`;
    $('#active-worker-copy').textContent = state.mechanics.length
      ? 'đang hoạt động gần bạn · Sẵn sàng 24/7'
      : 'hiện chưa có thợ sẵn sàng gần bạn';
    const list = $('#mechanic-list');
    list.innerHTML = state.mechanics.length ? state.mechanics.map(mechanic => `<div class="mechanic-row"><div class="avatar">${mechanic.name.split(' ').map(part => part[0]).slice(-2).join('')}</div><div class="mechanic-info"><strong>${escapeHtml(mechanic.name)}</strong><small>Đối tác SOS Wheel · Sẵn sàng</small></div><span class="distance-pill">${mechanic.distance_km} km</span><button class="call-button" data-mechanic="${mechanic.id}" ${state.selectedCode ? '' : 'disabled'}>Gọi cứu hộ</button></div>`).join('') : `<div class="empty-state">Hiện chưa có thợ sẵn sàng trong bán kính ${state.settings.radius_km} km.</div>`;
    list.querySelectorAll('[data-mechanic]').forEach(button => button.addEventListener('click', () => openRequest(Number(button.dataset.mechanic))));
    state.mechanicMarkers?.forEach(item => state.map.removeLayer(item)); state.mechanicMarkers = [];
    state.mechanics.forEach(mechanic => { const pin = L.marker([mechanic.lat, mechanic.lng], { icon: marker('mechanic-marker', mechanic.id) }).addTo(state.map).bindPopup(`<strong>${escapeHtml(mechanic.name)}</strong><br>${mechanic.distance_km} km away`); state.mechanicMarkers.push(pin); });
    if (state.selectedCode) { const quote = await api(`/api/quote?service_code=${encodeURIComponent(state.selectedCode)}`, { method: 'POST', body: JSON.stringify(state.location) }); renderQuote(quote); }
  } catch (error) {
    state.mechanics = [];
    $('#active-worker-count').textContent = '— thợ cứu hộ';
    $('#active-worker-copy').textContent = 'chưa thể cập nhật trạng thái';
    showToast(error.message);
  }
}
async function startFastTrack() {
  if (!state.selectedCode) await chooseService('diagnose');
  if (!state.location) {
    state.fastTrackPending = true;
    requestLocation();
    return;
  }
  await loadNearby();
  continueFastTrack();
}
function continueFastTrack() {
  const nearest = state.mechanics[0];
  if (!nearest) {
    showToast('Chưa có thợ sẵn sàng gần bạn. Thử lại sau hoặc chọn chẩn đoán nhanh.');
    return;
  }
  openRequest(nearest.id);
}
function openRequest(id) {
  if (!state.selectedCode) return showToast('Chọn sự cố trước khi gọi cứu hộ.');
  if (!state.location) return showToast('Vui lòng bật định vị trước.');
  state.selectedMechanic = state.mechanics.find(mechanic => mechanic.id === id);
  $('#request-mechanic-name').textContent = `${state.selectedMechanic.name} · thợ gần nhất, cách bạn ${state.selectedMechanic.distance_km} km. Nhập số điện thoại để gửi yêu cầu ưu tiên.`;
  $('#request-modal').classList.remove('hidden');
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
async function submitRequest(event) {
  event.preventDefault();
  const button = $('#request-form .primary-button'); button.disabled = true;
  try {
    const result = await api('/api/requests', { method: 'POST', body: JSON.stringify({ ...state.location, service_code: state.selectedCode, mechanic_id: state.selectedMechanic.id, customer_phone: new FormData(event.currentTarget).get('customer_phone') }) });
    state.order = { id: result.id, token: result.customer_token, share_url: result.share_url };
    $('#request-modal').classList.add('hidden'); event.currentTarget.reset(); await refreshOrder(); state.pollTimer = setInterval(refreshOrder, 7000); showToast('Yêu cầu cứu hộ đã gửi tới thợ.');
  } catch (error) { setMessage($('#request-message'), error.message); }
  finally { button.disabled = false; }
}
function renderOrder(item) {
  const panel = $('#active-order'); panel.classList.remove('hidden'); $('#order-number').textContent = item.id; $('#order-status').textContent = statusNames[item.status] || item.status;
  const mascot = $('#order-mascot');
  mascot.classList.toggle('hidden', item.status === 'pending' || item.status === 'cancelled');
  mascot.dataset.team = item.service_code || '';
  $('.moving-mascot-paw', mascot).innerHTML = dogAvatarMarkup();
  $('.mascot-caption', mascot).textContent = item.status === 'completed' ? 'Nhiệm vụ hoàn thành!' : 'Biệt đội đang lên đường!';
  $('#order-details').innerHTML = item.mechanic ? `Thợ <strong>${escapeHtml(item.mechanic.name)}</strong> · <a href="tel:${escapeHtml(item.mechanic.phone)}">${escapeHtml(item.mechanic.phone)}</a><br>Dự kiến ${money(item.total_min)} – ${money(item.total_max)}` : `Đang liên hệ thợ gần nhất.<br>Dự kiến ${money(item.total_min)} – ${money(item.total_max)}`;
  if (item.mechanic && state.map && item.mechanic.lat) { if (!state.assignedMarker) state.assignedMarker = L.marker([item.mechanic.lat, item.mechanic.lng], { icon: marker('mechanic-marker', item.mechanic.id) }).addTo(state.map); else state.assignedMarker.setLatLng([item.mechanic.lat, item.mechanic.lng]); }
  if (item.status === 'completed' && item.rating == null) renderReview();
  if (item.status === 'completed' || item.status === 'cancelled') clearInterval(state.pollTimer);
}
async function refreshOrder() {
  if (!state.order) return;
  try { renderOrder(await api(`/api/requests/${encodeURIComponent(state.order.id)}?token=${encodeURIComponent(state.order.token)}`)); }
  catch (error) { clearInterval(state.pollTimer); showToast(error.message); }
}
function renderReview() {
  const area = $('#review-area'); area.classList.remove('hidden');
  area.innerHTML = `<strong style="font-size:11px">Đánh giá dịch vụ</strong><div class="review-stars">${[1, 2, 3, 4, 5].map(value => `<button type="button" data-star="${value}" aria-label="${value} sao">★</button>`).join('')}</div><textarea placeholder="Chia sẻ trải nghiệm của bạn"></textarea><button type="button" class="primary-button" id="send-review">Gửi đánh giá</button>`;
  area.querySelectorAll('[data-star]').forEach(button => button.addEventListener('click', () => { state.rating = Number(button.dataset.star); area.querySelectorAll('[data-star]').forEach(star => star.classList.toggle('chosen', Number(star.dataset.star) <= state.rating)); }));
  $('#send-review').addEventListener('click', async () => { if (!state.rating) return showToast('Chọn số sao trước nhé.'); try { await api(`/api/requests/${state.order.id}/review?token=${encodeURIComponent(state.order.token)}`, { method: 'POST', body: JSON.stringify({ rating: state.rating, review_text: $('textarea', area).value }) }); area.innerHTML = '<strong style="font-size:11px;color:#047857">Cảm ơn bạn đã đánh giá.</strong>'; } catch (error) { showToast(error.message); } });
}
async function shareOrder() {
  const url = new URL(state.order.share_url, location.origin).href;
  try { if (navigator.share) await navigator.share({ title: 'Theo dõi cứu hộ SOS Wheel', url }); else { await navigator.clipboard.writeText(url); showToast('Đã sao chép liên kết an toàn.'); } }
  catch (error) { if (error.name !== 'AbortError') { try { await navigator.clipboard.writeText(url); showToast('Đã sao chép liên kết an toàn.'); } catch { showToast(url); } } }
}
async function findFuel() {
  if (!state.location) return showToast('Bật định vị trước để tìm cây xăng.');
  const button = $('#fuel-search'); button.disabled = true;
  try {
    const query = `[out:json][timeout:15];(node[amenity=fuel](around:5000,${state.location.lat},${state.location.lng});way[amenity=fuel](around:5000,${state.location.lat},${state.location.lng}););out center 15;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: `data=${encodeURIComponent(query)}` });
    if (!response.ok) throw new Error('Bản đồ cây xăng đang bận.');
    const data = await response.json(); state.fuelLayer?.clearLayers(); state.fuelLayer = L.layerGroup().addTo(state.map);
    data.elements.forEach(place => { const lat = place.lat ?? place.center?.lat, lng = place.lon ?? place.center?.lon; if (!lat || !lng) return; const name = escapeHtml(place.tags?.name || 'Trạm xăng'); L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="fuel-marker">⛽</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(state.fuelLayer).bindPopup(name); });
    if (!data.elements.length) showToast('Không thấy cây xăng OSM trong bán kính 5 km.'); else showToast(`Tìm thấy ${data.elements.length} điểm trên bản đồ.`);
  } catch (error) { showToast(error.message || 'Không kết nối được dịch vụ bản đồ.'); }
  finally { button.disabled = false; }
}
const wizardQuestions = ['Xe đề không nổ hoặc đèn đồng hồ yếu?', 'Bánh xe bị xẹp hoặc xe khó lăn?'];
function startWizard() { state.wizardStep = 0; state.wizardAnswers = []; $('#wizard-panel').classList.remove('hidden'); showQuestion(); $('#wizard-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function showQuestion() { $('#wizard-question').textContent = wizardQuestions[state.wizardStep]; $('#wizard-step-label').textContent = `${state.wizardStep + 1} / 2`; }
function answerWizard(answer) { state.wizardAnswers.push(answer); if (state.wizardStep === 0 && answer === 'yes') return recommend('battery_jump'); if (state.wizardStep === 1 || state.wizardStep === 0 && answer === 'no') { const code = state.wizardAnswers[0] === 'no' && answer === 'yes' ? 'tire_patch' : 'diagnose'; recommend(code); return; } state.wizardStep = 1; showQuestion(); }
function recommend(code) { $('#wizard-panel').classList.add('hidden'); if (code === 'diagnose') { showToast('Chọn “Chưa rõ nguyên nhân” để đặt lịch chẩn đoán.'); code = 'diagnose'; } if (!$(`[data-code="${code}"]`)) { state.selectedCode = code; if (state.location) api(`/api/quote?service_code=${code}`, { method: 'POST', body: JSON.stringify(state.location) }).then(renderQuote).catch(error => showToast(error.message)); return; } chooseService(code); }
function showPortal(tab = 'mechanic') { $('#customer-view').classList.add('hidden'); $('#portal-view').classList.remove('hidden'); setPortal(tab); }
function setPortal(tab) { $$('.portal-tab').forEach(button => button.classList.toggle('active', button.dataset.portal === tab)); $('#mechanic-portal').classList.toggle('hidden', tab !== 'mechanic'); $('#admin-portal').classList.toggle('hidden', tab !== 'admin'); }
function showCustomer() { $('#portal-view').classList.add('hidden'); $('#customer-view').classList.remove('hidden'); setTimeout(() => state.map.invalidateSize(), 50); }
function authHeaders(token) { return { token }; }
async function loadMechanicDashboard() {
  $('#mechanic-auth').classList.add('hidden'); const dashboard = $('#mechanic-dashboard'); dashboard.classList.remove('hidden');
  try {
    const mechanic = await api('/api/mechanics/me', authHeaders(state.mechanicToken));
    const requests = await api('/api/mechanics/requests', authHeaders(state.mechanicToken));
    dashboard.innerHTML = `<div class="dashboard-head"><div><span class="section-index">ĐỐI TÁC</span><h2>Xin chào, ${escapeHtml(mechanic.name)}</h2></div><div class="dashboard-actions"><button class="dashboard-button ${mechanic.is_available ? 'active' : ''}" id="availability-button">${mechanic.is_available ? '● Đang nhận đơn' : '○ Tạm nghỉ'}</button><button class="dashboard-button danger" id="mechanic-logout">Đăng xuất</button></div></div><p style="font-size:10px;color:#74808a;margin:10px 0">Đang dùng vị trí GPS khi bật nhận đơn. Cập nhật vị trí mỗi lần đổi trạng thái sẵn sàng.</p><div id="mechanic-requests">${requests.length ? requests.map(renderMechanicRequest).join('') : '<div class="empty-state">Chưa có đơn được gửi riêng cho bạn.</div>'}</div>`;
    $('#availability-button').addEventListener('click', toggleAvailability); $('#mechanic-logout').addEventListener('click', () => { localStorage.removeItem('sos_mechanic_token'); state.mechanicToken = null; $('#mechanic-dashboard').classList.add('hidden'); $('#mechanic-auth').classList.remove('hidden'); });
    dashboard.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => mechanicAction(button.dataset.id, button.dataset.action)));
    if (!state.mechanicPoll) state.mechanicPoll = setInterval(async () => { if (state.mechanicToken) { try { await loadMechanicDashboard(); } catch { clearInterval(state.mechanicPoll); } } }, 10000);
  } catch (error) { state.mechanicToken = null; localStorage.removeItem('sos_mechanic_token'); $('#mechanic-dashboard').classList.add('hidden'); $('#mechanic-auth').classList.remove('hidden'); showToast(error.message); }
}
function renderMechanicRequest(item) {
  const actions = item.status === 'pending' ? `<button class="primary-button" data-id="${item.id}" data-action="accept">Nhận đơn</button>` : item.status === 'accepted' ? `<button class="primary-button" data-id="${item.id}" data-action="arrive">Đang đến</button>` : item.status === 'arriving' ? `<button class="primary-button" data-id="${item.id}" data-action="start">Bắt đầu sửa</button>` : `<button class="outline-button" data-id="${item.id}" data-action="extra">Báo phát sinh</button><button class="primary-button" data-id="${item.id}" data-action="complete">Hoàn thành</button>`;
  return `<article class="request-card"><div class="request-card-top"><span>${escapeHtml(item.id)}</span><span class="status-tag">${statusNames[item.status]}</span></div><h3>${escapeHtml(item.service_name)}</h3><p>Khách ${escapeHtml(item.customer_phone)} · cách ${item.distance_km.toFixed(1)} km<br>Ước tính ${money(item.total_min)} – ${money(item.total_max)}</p><div class="request-actions">${actions}</div></article>`;
}
async function mechanicAction(id, action) {
  try {
    let body = null;
    if (action === 'extra') { const amount = Number(prompt('Nhập phí phát sinh (đồng):', '0')); if (!Number.isFinite(amount) || amount < 0) return; body = { amount, note: '' }; }
    await api(`/api/mechanics/requests/${id}/${action}`, { method: 'POST', token: state.mechanicToken, ...(body ? { body: JSON.stringify(body) } : {}) });
    showToast(action === 'accept' ? 'Đã nhận đơn cứu hộ.' : 'Đã cập nhật trạng thái.'); await loadMechanicDashboard();
  } catch (error) { showToast(error.message); }
}
function toggleAvailability() {
  if (!navigator.geolocation) return showToast('Cần GPS để bật nhận đơn.');
  navigator.geolocation.getCurrentPosition(async position => {
    try { const active = !$('#availability-button').classList.contains('active'); await api('/api/mechanics/location', { method: 'POST', token: state.mechanicToken, body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude, is_available: active }) }); await loadMechanicDashboard(); }
    catch (error) { showToast(error.message); }
  }, () => showToast('Cho phép truy cập vị trí để cập nhật trạng thái.'), { enableHighAccuracy: true, timeout: 12000 });
}
function closeSupportPanel() {
  $('#support-panel').classList.add('hidden');
  $('#support-fab').setAttribute('aria-expanded', 'false');
  $('#support-tooltip').classList.remove('hidden');
  clearTimeout(state.supportTooltipTimer);
  state.supportTooltipTimer = window.setTimeout(() => $('#support-tooltip').classList.add('hidden'), 6500);
}
function addSupportMessage(text, className) {
  const message = document.createElement('p');
  message.className = `chat-message ${className}`;
  message.textContent = text;
  $('#support-messages').append(message);
  $('#support-messages').scrollTop = $('#support-messages').scrollHeight;
}
function suggestSupportAction(text, code = null) {
  const button = document.createElement('button');
  button.className = 'support-suggestion';
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', () => {
    closeSupportPanel();
    showCustomer();
    if (code) {
      chooseService(code);
      $('#issue-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    startWizard();
  });
  $('#support-messages').append(button);
}
function replyToSupport(message) {
  const text = message.toLocaleLowerCase('vi');
  let reply = 'Mình chưa chắc sự cố thuộc nhóm nào. Bạn có thể trả lời hai câu hỏi của phần chẩn đoán nhanh nhé.';
  let suggestion = 'Mở chẩn đoán nhanh';
  let code = null;
  if (text.includes('xăng') || text.includes('hết nhiên liệu')) {
    reply = 'Có vẻ xe cần tiếp nhiên liệu. Chọn nhóm Hết xăng để xem thợ và giá dự kiến.';
    suggestion = 'Chọn hỗ trợ xăng';
    code = 'fuel';
  } else if (text.includes('lốp') || text.includes('bánh') || text.includes('xẹp') || text.includes('thủng')) {
    reply = 'Mình sẽ đưa bạn tới lựa chọn vá lốp. Thợ có thể kiểm tra và báo phương án phù hợp.';
    suggestion = 'Chọn hỗ trợ lốp';
    code = 'tire_patch';
  } else if (text.includes('bình') || text.includes('ắc quy') || text.includes('ac quy') || text.includes('đề không nổ')) {
    reply = 'Dấu hiệu này có thể liên quan tới bình điện. Hãy xem nhóm Kích bình / ắc quy.';
    suggestion = 'Chọn hỗ trợ bình điện';
    code = 'battery_jump';
  } else if (text.includes('xích') || text.includes('sên') || text.includes('curoa') || text.includes('cơ khí')) {
    reply = 'Mình sẽ mở nhóm truyền động để bạn tìm thợ chỉnh xích hoặc kiểm tra xe.';
    suggestion = 'Chọn hỗ trợ truyền động';
    code = 'chain_adjust';
  }
  addSupportMessage(reply, 'assistant-message');
  suggestSupportAction(suggestion, code);
}
function submitSupportChat(event) {
  event.preventDefault();
  const input = $('#support-chat-input');
  const message = input.value.trim();
  if (!message) return;
  addSupportMessage(message, 'user-message');
  input.value = '';
  window.setTimeout(() => replyToSupport(message), 250);
}
async function loadAdminDashboard() {
  $('#admin-login-form').classList.add('hidden'); const dashboard = $('#admin-dashboard'); dashboard.classList.remove('hidden');
  try {
    const [analytics, mechanics, requests] = await Promise.all([api('/api/admin/analytics', authHeaders(state.adminToken)), api('/api/admin/mechanics', authHeaders(state.adminToken)), api('/api/admin/requests', authHeaders(state.adminToken))]);
    dashboard.innerHTML = `<div class="dashboard-head"><div><span class="section-index">TỔNG QUAN VẬN HÀNH</span><h2>Dashboard</h2></div><button class="dashboard-button danger" id="admin-logout">Đăng xuất</button></div><div class="stats-grid"><div class="stat-block"><span>Tổng đơn</span><strong>${analytics.total_requests}</strong></div><div class="stat-block"><span>Thợ chờ duyệt</span><strong>${mechanics.filter(m => !m.is_approved).length}</strong></div><div class="stat-block"><span>Thời gian nhận TB</span><strong>${analytics.avg_response_minutes ?? '—'}<small style="font:500 9px var(--body)"> phút</small></strong></div><div class="stat-block"><span>Đánh giá TB</span><strong>${analytics.average_rating ?? '—'}<small style="font:500 9px var(--body)"> / 5</small></strong></div></div><div class="analytics-grid"><div class="analytics-block"><h3>Sự cố phổ biến</h3>${analytics.popular_services.map(row => `<div class="analytics-line"><span>${escapeHtml(row.name)}</span><span>${row.count}</span></div>`).join('') || '<div class="analytics-line">Chưa có dữ liệu</div>'}</div><div class="analytics-block"><h3>Giờ cao điểm</h3>${analytics.peak_hours.map(row => `<div class="analytics-line"><span>${String(row.hour).padStart(2, '0')}:00</span><span>${row.count} đơn</span></div>`).join('') || '<div class="analytics-line">Chưa có dữ liệu</div>'}</div><div class="analytics-block"><h3>Điểm nóng theo tọa độ</h3>${analytics.hotspots.map(row => `<div class="analytics-line"><span>${escapeHtml(row.area)}</span><span>${row.count} đơn</span></div>`).join('') || '<div class="analytics-line">Chưa có dữ liệu</div>'}</div><div class="analytics-block"><h3>Đối tác chờ duyệt</h3>${mechanics.filter(m => !m.is_approved).map(m => `<div class="analytics-line"><span>${escapeHtml(m.name)} · ${escapeHtml(m.phone)}</span><button class="dashboard-button" data-approve="${m.id}">Duyệt</button></div>`).join('') || '<div class="analytics-line">Không có hồ sơ chờ duyệt</div>'}</div></div><div style="margin-top:19px"><h3 style="font:700 13px var(--display)">Đơn gần đây</h3><div style="overflow:auto"><table class="data-table"><thead><tr><th>MÃ ĐƠN</th><th>SỰ CỐ</th><th>TRẠNG THÁI</th><th>ĐÁNH GIÁ</th></tr></thead><tbody>${requests.slice(0, 12).map(item => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.service_name)}</td><td>${statusNames[item.status]}</td><td>${item.rating ? '★'.repeat(item.rating) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
    $('#admin-logout').addEventListener('click', () => { localStorage.removeItem('sos_admin_token'); state.adminToken = null; $('#admin-dashboard').classList.add('hidden'); $('#admin-login-form').classList.remove('hidden'); });
    dashboard.querySelectorAll('[data-approve]').forEach(button => button.addEventListener('click', async () => { try { await api(`/api/admin/mechanics/${button.dataset.approve}/approve`, { method: 'POST', token: state.adminToken }); await loadAdminDashboard(); } catch (error) { showToast(error.message); } }));
  } catch (error) { state.adminToken = null; localStorage.removeItem('sos_admin_token'); dashboard.classList.add('hidden'); $('#admin-login-form').classList.remove('hidden'); showToast(error.message); }
}
function bindForms() {
  state.supportTooltipTimer = window.setTimeout(() => $('#support-tooltip').classList.add('hidden'), 6500);
  $('#support-fab').addEventListener('click', () => {
    const panel = $('#support-panel');
    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    $('#support-fab').setAttribute('aria-expanded', String(!isOpen));
    $('#support-tooltip').classList.toggle('hidden', !isOpen);
    clearTimeout(state.supportTooltipTimer);
  });
  $('#support-close').addEventListener('click', closeSupportPanel);
  $('#support-chat-open').addEventListener('click', () => {
    $('#support-actions').classList.add('hidden');
    $('#support-chat').classList.remove('hidden');
    $('#support-chat-input').focus();
  });
  $('#support-chat-form').addEventListener('submit', submitSupportChat);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSupportPanel(); });
  $('#emergency-fast-track').addEventListener('click', startFastTrack);
  $('#locate-button').addEventListener('click', requestLocation);
  $$('.issue-option').forEach(button => button.addEventListener('click', () => chooseService(button.dataset.code)));
  $('#wizard-button').addEventListener('click', startWizard); $('#wizard-close').addEventListener('click', () => $('#wizard-panel').classList.add('hidden'));
  $$('.answer-button').forEach(button => button.addEventListener('click', () => answerWizard(button.dataset.answer)));
  $('#fuel-search').addEventListener('click', findFuel); $('#request-form').addEventListener('submit', submitRequest); $('#share-button').addEventListener('click', shareOrder);
  $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => $('#request-modal').classList.add('hidden')));
  $('#request-modal').addEventListener('click', event => { if (event.target === $('#request-modal')) $('#request-modal').classList.add('hidden'); });
  $('#open-portal').addEventListener('click', () => showPortal()); $('#back-home').addEventListener('click', showCustomer);
  $$('.portal-tab').forEach(button => button.addEventListener('click', () => setPortal(button.dataset.portal)));
  $('#mechanic-login-form').addEventListener('submit', async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); try { const result = await api('/api/mechanics/login', { method: 'POST', body: JSON.stringify(values) }); state.mechanicToken = result.access_token; localStorage.setItem('sos_mechanic_token', state.mechanicToken); await loadMechanicDashboard(); } catch (error) { setMessage($('#mechanic-login-message'), error.message); } });
  $('#mechanic-register-form').addEventListener('submit', async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); try { const result = await api('/api/mechanics/register', { method: 'POST', body: JSON.stringify(values) }); setMessage($('#mechanic-register-message'), result.message, true); event.currentTarget.reset(); } catch (error) { setMessage($('#mechanic-register-message'), error.message); } });
  $('#admin-login-form').addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); state.adminToken = result.access_token; localStorage.setItem('sos_admin_token', state.adminToken); await loadAdminDashboard(); } catch (error) { setMessage($('#admin-login-message'), error.message); } });
}
async function loadShareView() {
  const item = await api(`/api/track/${encodeURIComponent(window.SOS_SHARE_TOKEN)}`);
  $('#customer-view').classList.remove('hidden'); $('#location-title').textContent = 'Theo dõi cứu hộ an toàn'; $('#location-subtitle').textContent = `Mã đơn ${item.id}`; $('#map-status').textContent = statusNames[item.status];
  state.map.setView([item.customer_lat, item.customer_lng], 15); state.customerMarker = L.marker([item.customer_lat, item.customer_lng], { icon: marker('customer-marker') }).addTo(state.map).bindPopup('Vị trí khách');
  $('#active-order').classList.remove('hidden'); $('#order-number').textContent = item.id; $('#order-status').textContent = statusNames[item.status]; $('#order-details').innerHTML = item.mechanic ? `Thợ <strong>${escapeHtml(item.mechanic.name)}</strong> · <a href="tel:${escapeHtml(item.mechanic.phone)}">${escapeHtml(item.mechanic.phone)}</a>` : 'Đơn đang tìm thợ. Thông tin thợ sẽ hiện khi nhận đơn.';
  $('#order-mascot').classList.toggle('hidden', item.status === 'pending' || item.status === 'cancelled');
  $('.moving-mascot-paw').innerHTML = dogAvatarMarkup();
  $('#share-button').classList.add('hidden'); $('.main-column').innerHTML = `<div class="eyebrow"><span class="eyebrow-line"></span> THEO DÕI CỨU HỘ AN TOÀN</div><h1>Hành trình<br><span>SOS Wheel</span></h1><p class="intro">Vị trí được chia sẻ riêng bởi người đang cần cứu hộ.</p><div class="location-strip"><div class="location-icon">⌖</div><div class="location-copy"><strong>${escapeHtml(item.id)}</strong><span>${statusNames[item.status]}</span></div></div>`;
  setInterval(async () => { try { const updated = await api(`/api/track/${encodeURIComponent(window.SOS_SHARE_TOKEN)}`); $('#order-status').textContent = statusNames[updated.status]; $('#map-status').textContent = statusNames[updated.status]; $('#order-details').innerHTML = updated.mechanic ? `Thợ <strong>${escapeHtml(updated.mechanic.name)}</strong> · <a href="tel:${escapeHtml(updated.mechanic.phone)}">${escapeHtml(updated.mechanic.phone)}</a>` : 'Đơn đang tìm thợ. Thông tin thợ sẽ hiện khi nhận đơn.'; $('#order-mascot').classList.toggle('hidden', updated.status === 'pending' || updated.status === 'cancelled'); if (updated.mechanic?.lat) { if (!state.assignedMarker) state.assignedMarker = L.marker([updated.mechanic.lat, updated.mechanic.lng], { icon: marker('mechanic-marker', updated.mechanic.id) }).addTo(state.map); else state.assignedMarker.setLatLng([updated.mechanic.lat, updated.mechanic.lng]); } } catch {} }, 7000);
}
async function init() {
  initMap(); bindForms();
  try { await Promise.all([loadServices(), loadSettings()]); } catch (error) { showToast(error.message); }
  if (window.SOS_SHARE_TOKEN) { try { await loadShareView(); } catch (error) { showToast(error.message); } }
  else if (state.mechanicToken) { showPortal(); await loadMechanicDashboard(); }
  setTimeout(() => state.map.invalidateSize(), 100);
}
document.addEventListener('DOMContentLoaded', init);
