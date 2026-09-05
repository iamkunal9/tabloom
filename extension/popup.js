const $ = selector => document.querySelector(selector);
const error = $('#error');

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'The extension did not respond');
  return response.result;
}

async function refresh() {
  try {
    const state = await request({ type: 'getState' });
    $('#paired').textContent = state.paired ? 'Paired' : 'Not paired';
    $('#connected').textContent = state.connected ? 'Connected' : 'Disconnected';
    $('#scope').textContent = state.mode === 'tab' ? 'Current tab' : state.mode === 'browser' ? 'Full browser' : 'Off';
    $('#scope').title = state.mode === 'tab' ? `Tab ${state.tabId}` : '';
    $('#badge').textContent = state.mode === 'off' ? (state.connected ? 'Ready' : 'Off') : 'Active';
    $('#badge').className = state.mode !== 'off' ? 'active' : state.connected ? 'ready' : '';
    $('#port').value = state.bridgePort || 17653;
    $('#saved-token').textContent = state.maskedToken ? `Saved token ${state.maskedToken}` : 'Stored only in this browser profile.';
    $('#current').disabled = !state.connected;
    $('#browser').disabled = !state.connected;
    $('#stop').disabled = state.mode === 'off';
  } catch (cause) { showError(cause); }
}

function showError(cause) { error.textContent = cause?.message || String(cause); }
async function perform(message) {
  error.textContent = '';
  try { await request(message); await refresh(); } catch (cause) { showError(cause); }
}

$('#pair-form').addEventListener('submit', event => {
  event.preventDefault();
  perform({ type: 'pair', bridgePort: Number($('#port').value), pairingToken: $('#token').value });
  $('#token').value = '';
});
$('#current').addEventListener('click', () => perform({ type: 'grantTab' }));
$('#browser').addEventListener('click', () => perform({ type: 'grantBrowser' }));
$('#stop').addEventListener('click', () => perform({ type: 'stop' }));
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stateChanged') refresh(); });
refresh();
