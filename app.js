const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_PUBLICA';
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

const isConfigured = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('SUA_CHAVE');

document.addEventListener('DOMContentLoaded', init);

function init() {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  renderHeader();
  bindPhotoInputs();
  bindConfirmDialog();

  elements.configWarning.hidden = isConfigured;
  elements.paramWarning.hidden = Boolean(avaliacaoId && alunoId);

  if (!avaliacaoId || !alunoId || !isConfigured) {
    return;
  }

  loadExistingPhotos();
}

function renderHeader() {
  const alunoLabel = alunoNome ? `<strong>${escapeHtml(alunoNome)}</strong>` : `<strong>Aluno ${escapeHtml(alunoId || '-')}</strong>`;
  const avaliacaoLabel = escapeHtml(avaliacaoId || '-');
  elements.studentSummary.innerHTML = `${alunoLabel} · Avaliacao ${avaliacaoLabel}`;
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

function bindConfirmDialog() {
  elements.confirmUpload.addEventListener('click', async () => {
    if (!state.pending) return;
    await uploadSelectedPhoto(state.pending.type, state.pending.file);
    resetPendingInput();
    elements.confirmDialog.close();
  });

  elements.cancelUpload.addEventListener('click', resetPendingInput);
  elements.confirmDialog.addEventListener('close', () => {
    URL.revokeObjectURL(elements.confirmPreview.src);
    elements.confirmPreview.removeAttribute('src');
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
  elements.confirmDialog.showModal();
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
    const savedPhoto = await savePhotoRecord(type, publicUrl);

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

async function savePhotoRecord(type, url) {
  const existing = state.photos.get(type);
  const payload = {
    avaliacao_id: Number(avaliacaoId),
    aluno_id: Number(alunoId),
    tipo_foto: type,
    url
  };

  const endpoint = existing
    ? `/rest/v1/${TABLE_NAME}?id=eq.${existing.id}`
    : `/rest/v1/${TABLE_NAME}`;

  const response = await supabaseFetch(endpoint, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
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
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    ...(options.headers || {})
  };

  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers
  });
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data && (data.message || data.error || data.msg);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
