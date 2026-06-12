const SUPABASE_URL = 'https://femyevsxvvdeldfsxwqy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZAfh1wYyqVa-T_SWJyl6w_xfopoxv';
const BUCKET_NAME = 'fotos-avaliacao';
const TABLE_NAME = 'avaliacao_fotos';

const PHOTO_TYPES = {
  frente: 'Frente',
  costas: 'Costas',
  lado_direito: 'Lado Direito',
  lado_esquerdo: 'Lado Esquerdo'
};

const params = new URLSearchParams(window.location.search);
const avaliacaoId = params.get('avaliacao') || params.get('avaliacao_id');
const alunoId = params.get('aluno') || params.get('aluno_id');
const alunoNome = params.get('nome') || params.get('aluno_nome') || '';

const state = {
  photos: new Map(),
  pending: null
};

const elements = {
  studentSummary: document.querySelector('#studentSummary'),
  configWarning: document.querySelector('#configWarning'),
  paramWarning: document.querySelector('#paramWarning'),
  globalMessage: document.querySelector('#globalMessage'),
  doneMessage: document.querySelector('#doneMessage'),
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmTitle: document.querySelector('#confirmTitle'),
  confirmPreview: document.querySelector('#confirmPreview'),
  confirmUpload: document.querySelector('#confirmUpload'),
  cancelUpload: document.querySelector('#cancelUpload')
};

const isConfigured = !SUPABASE_URL.includes('SEU-PROJETO') && isValidSupabaseKey(SUPABASE_ANON_KEY);

init();
window.addEventListener('load', renderIcons);

function init() {
  renderIcons();

  renderHeader();
  bindPhotoInputs();
  bindConfirmDialog();

  renderConfigWarning();
  elements.paramWarning.hidden = Boolean(avaliacaoId && alunoId);
  setPhotoInputsEnabled(Boolean(avaliacaoId && alunoId && isConfigured));

  if (!avaliacaoId || !alunoId || !isConfigured) {
    return;
  }

  loadExistingPhotos();
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderConfigWarning() {
  elements.configWarning.hidden = isConfigured;

  if (isConfigured) {
    elements.configWarning.textContent = '';
    return;
  }

  elements.configWarning.innerHTML = 'Configure em <strong>app.js</strong> a chave publica do Supabase. Use uma chave <strong>sb_publishable_...</strong> ou a chave legada <strong>anon</strong> que comeca com <strong>eyJ...</strong>. Nao use <strong>service_role</strong> ou <strong>sb_secret_...</strong> neste site.';
}

function renderHeader() {
  const alunoLabel = alunoNome ? `<strong>${escapeHtml(alunoNome)}</strong>` : `<strong>Aluno ${escapeHtml(alunoId || '-')}</strong>`;
  const avaliacaoLabel = escapeHtml(avaliacaoId || '-');
  elements.studentSummary.innerHTML = `${alunoLabel} - Avaliacao ${avaliacaoLabel}`;
}

function bindPhotoInputs() {
  document.querySelectorAll('.photo-card').forEach((card) => {
    const input = card.querySelector('input[type="file"]');
    const resendButton = card.querySelector('.secondary-button');

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      openConfirmDialog(card.dataset.type, file, input);
    });

    resendButton.addEventListener('click', () => input.click());
  });
}

function setPhotoInputsEnabled(enabled) {
  document.querySelectorAll('.photo-card').forEach((card) => {
    const input = card.querySelector('input[type="file"]');
    const resendButton = card.querySelector('.secondary-button');

    input.disabled = !enabled;
    resendButton.disabled = !enabled;
  });
}

function bindConfirmDialog() {
  elements.confirmUpload.addEventListener('click', async () => {
    if (!state.pending) return;
    await uploadSelectedPhoto(state.pending.type, state.pending.file);
    resetPendingInput();
    closeConfirmDialog();
  });

  elements.cancelUpload.addEventListener('click', () => {
    resetPendingInput();
    closeConfirmDialog();
  });
  elements.confirmDialog.addEventListener('close', () => {
    clearConfirmPreview();
  });
}

function openConfirmDialog(type, file, input) {
  if (!file.type.startsWith('image/')) {
    showMessage('Selecione uma imagem valida.', 'error');
    input.value = '';
    return;
  }

  state.pending = {
    type,
    file,
    input
  };

  elements.confirmTitle.textContent = `Confirmar foto - ${PHOTO_TYPES[type]}`;
  elements.confirmPreview.src = URL.createObjectURL(file);
  openDialog(elements.confirmDialog);
}

async function loadExistingPhotos() {
  try {
    showMessage('Verificando fotos ja enviadas...', 'info');
    const query = new URLSearchParams({
      select: 'id,tipo_foto,url,created_at',
      avaliacao_id: `eq.${avaliacaoId}`,
      aluno_id: `eq.${alunoId}`,
      order: 'created_at.desc'
    });

    const response = await supabaseFetch(`/rest/v1/${TABLE_NAME}?${query.toString()}`);
    const photos = await parseJsonResponse(response);

    photos.forEach((photo) => {
      if (!state.photos.has(photo.tipo_foto)) {
        state.photos.set(photo.tipo_foto, photo);
        markAsSent(photo.tipo_foto, photo.url);
      }
    });

    showMessage('', 'info');
    updateDoneState();
  } catch (error) {
    showMessage(error.message || 'Nao foi possivel consultar as fotos enviadas.', 'error');
  }
}

async function uploadSelectedPhoto(type, file) {
  const card = getCard(type);

  try {
    if (!isConfigured) {
      throw new Error('Configure a chave publica do Supabase antes de enviar fotos.');
    }

    setCardStatus(card, 'Enviando...', 'sending');
    elements.confirmUpload.disabled = true;
    showMessage('', 'info');

    const filePath = buildFilePath(type, file);
    const uploadResponse = await supabaseFetch(`/storage/v1/object/${BUCKET_NAME}/${filePath}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/jpeg',
        'x-upsert': 'true'
      },
      body: file
    });

    await parseJsonResponse(uploadResponse);

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${filePath}`;
    const savedPhoto = await savePhotoRecord(type, publicUrl, filePath);

    state.photos.set(type, savedPhoto);
    markAsSent(type, publicUrl);
    updateDoneState();
    showMessage(`${PHOTO_TYPES[type]} enviada com sucesso.`, 'success');
  } catch (error) {
    if (state.photos.has(type)) {
      setCardStatus(card, 'Enviado', 'sent');
    } else {
      setCardStatus(card, 'Pendente', 'pending');
    }

    showMessage(error.message || 'Falha ao enviar a foto.', 'error');
  } finally {
    elements.confirmUpload.disabled = false;
  }
}

async function savePhotoRecord(type, url, filePath) {
  const payload = {
    avaliacao_id: Number(avaliacaoId),
    aluno_id: Number(alunoId),
    tipo_foto: type,
    nome_arquivo: filePath,
    url
  };

  const response = await supabaseFetch(`/rest/v1/${TABLE_NAME}?on_conflict=avaliacao_id,tipo_foto`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJsonResponse(response);
  return Array.isArray(data) ? data[0] : data;
}

function markAsSent(type, url) {
  const card = getCard(type);
  const preview = card.querySelector('.preview');
  const resendButton = card.querySelector('.secondary-button');

  preview.src = url;
  preview.hidden = false;
  resendButton.hidden = false;
  setCardStatus(card, 'Enviado', 'sent');
}

function updateDoneState() {
  const allSent = Object.keys(PHOTO_TYPES).every((type) => state.photos.has(type));
  elements.doneMessage.hidden = !allSent;
}

function setCardStatus(card, text, className) {
  const status = card.querySelector('.status');
  status.textContent = text;
  status.className = `status ${className}`;
}

function getCard(type) {
  return document.querySelector(`.photo-card[data-type="${type}"]`);
}

function buildFilePath(type, file) {
  const extension = getFileExtension(file);
  const version = Date.now();
  return `aluno_${alunoId}_avaliacao_${avaliacaoId}_${type}_${version}.${extension}`;
}

function getFileExtension(file) {
  const nameExtension = file.name.split('.').pop();
  if (nameExtension && nameExtension.length <= 5) {
    return nameExtension.toLowerCase();
  }

  const mimeExtension = file.type.split('/').pop();
  return mimeExtension || 'jpg';
}

async function supabaseFetch(path, options = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...(options.headers || {})
  };

  if (isValidJwtKey(SUPABASE_ANON_KEY) && !headers.Authorization) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data && typeof data === 'object'
      ? (data.message || data.error || data.msg)
      : data;
    throw new Error(message || `Erro ${response.status} ao comunicar com o Supabase.`);
  }

  return data;
}

function showMessage(message, type) {
  elements.globalMessage.hidden = !message;
  elements.globalMessage.textContent = message;
  const typeClass = {
    error: 'notice-error',
    success: 'notice-success'
  }[type] || '';
  elements.globalMessage.className = `notice ${typeClass}`;
}

function resetPendingInput() {
  if (state.pending && state.pending.input) {
    state.pending.input.value = '';
  }

  state.pending = null;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
    return;
  }

  dialog.setAttribute('open', '');
  dialog.classList.add('is-fallback-open');
}

function closeConfirmDialog() {
  if (typeof elements.confirmDialog.close === 'function' && elements.confirmDialog.open) {
    elements.confirmDialog.close();
    return;
  }

  elements.confirmDialog.removeAttribute('open');
  elements.confirmDialog.classList.remove('is-fallback-open');
  clearConfirmPreview();
}

function clearConfirmPreview() {
  if (elements.confirmPreview.src) {
    URL.revokeObjectURL(elements.confirmPreview.src);
  }

  elements.confirmPreview.removeAttribute('src');
}

function isValidSupabaseKey(key) {
  return isPublishableKey(key) || isValidJwtKey(key);
}

function isPublishableKey(key) {
  return /^sb_publishable_[\w-]+$/.test(key);
}

function isValidJwtKey(key) {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
