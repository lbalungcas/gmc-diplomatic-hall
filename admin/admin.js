/**
 * YIM Admin Dashboard — Booth Manager & Integrated Analytics
 * Client-side logic for the hidden /admin panel.
 */
import boothsJsonData from '../src/data/booths.json';
import organizersData from '../src/data/organizers.json';

// ─── Config & Endpoints ──────────────────
const API_BASE = (location.origin.includes('localhost') || location.origin.includes('127.0.0.1'))
  ? '/admin-api'
  : (import.meta.env.VITE_ANALYTICS_URL ? `${import.meta.env.VITE_ANALYTICS_URL}/admin-api` : '/admin-api');

const ANALYTICS_BASE = (location.origin.includes('localhost') || location.origin.includes('127.0.0.1'))
  ? '/analytics'
  : (import.meta.env.VITE_ANALYTICS_URL ? `${import.meta.env.VITE_ANALYTICS_URL}/analytics` : '/analytics');

const SOCIAL_NETWORKS = [
  { id: 'facebook',  name: 'Facebook',   icon: 'fab fa-facebook-f',   color: '#1877f2' },
  { id: 'instagram', name: 'Instagram',  icon: 'fab fa-instagram',    color: '#e4405f' },
  { id: 'tiktok',    name: 'TikTok',     icon: 'fab fa-tiktok',       color: '#00f2fe' },
  { id: 'linkedin',  name: 'LinkedIn',   icon: 'fab fa-linkedin-in',  color: '#0a66c2' },
  { id: 'twitter',   name: 'X / Twitter',icon: 'fab fa-x-twitter',    color: '#f8fafc' },
  { id: 'youtube',   name: 'YouTube',    icon: 'fab fa-youtube',      color: '#ff0000' },
];

// ─── State ───────────────────────────────
let booths = [];
let activeView = 'booths';
let currentFilter = 'all';
let editingBooth = null;
let categories = new Set();
let analyticsData = null;
let analyticsTimer = null;

// ─── DOM Helpers ─────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dashboard   = $('#dashboard');
const boothsGrid  = $('#boothsGrid');
const boothCount  = $('#boothCount');
const filterPills = $('#filterPills');
const searchInput = $('#searchInput');
const searchBox   = $('#searchBox');
const viewTitle   = $('#viewTitle');
const statusDot   = $('#statusDot');
const statusLabel = $('#statusLabel');
const editModal   = $('#editModal');
const editForm    = $('#editForm');
const toastBox    = $('#toastContainer');

// ─── API Client ──────────────────────────
function apiUrl(path, extra = '') {
  const sep = path.includes('?') ? '&' : '?';
  const extraClean = extra ? (extra.startsWith('?') ? extra.slice(1) : extra) : '';
  const extraParam = extraClean ? `&${extraClean}` : '';
  return `${API_BASE}${path}${sep}token=gmc-dev${extraParam}`;
}

async function api(path, opts = {}) {
  const url = apiUrl(path, opts.query || '');
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': 'gmc-dev',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── 27 Booths Fallback Data ─────────────
function build27BoothsFallback() {
  // 24 youth innovator booths (1-24)
  const list = boothsJsonData.map((b) => ({
    id: b.id,
    name: b.name || '',
    category: b.category || '',
    organization: b.organization || '',
    theme: b.theme || '',
    overview: b.overview || '',
    logo: b.logo || '',
    intro_video: b.introVideo || '',
    images: b.images || [],
    stats: b.stats || [],
    links: b.links || [],
    socials: b.socials || {},
    contact: b.contact || {},
    quiz: b.quiz || {},
    placeholder: b.placeholder ?? true,
    isOrganizer: false,
  }));

  // 3 organizer stands (25: TdH, 26: KNH, 27: VEWU)
  const organizerDefaults = [
    {
      id: 25,
      name: "Terre des hommes",
      category: "Co-Convener Stand",
      organization: "Terre des hommes Netherlands",
      theme: "Ending Violence Against Children",
      overview: "Terre des hommes (Tdh) is the leading Swiss children's rights organisation. For more than 60 years it has worked hand in hand with children in over 30 countries to win protection and respect for their rights — in health, for children on the move, and in access to justice. Tdh co-organizes the Youth Innovations Marketplace; stop by to meet the team and find out how to stay involved after the summit.",
      logo: "",
      intro_video: "",
      images: [],
      stats: [
        { value: "60+", label: "Years with children" },
        { value: "30+", label: "Countries" },
        { value: "Co-Convener", label: "GMC EVAC 2026" }
      ],
      links: [{ label: "tdh.org", url: "https://www.tdh.org/en" }],
      socials: { facebook: "https://facebook.com/Tdh.ch", twitter: "https://x.com/tdh_ch", linkedin: "https://linkedin.com/company/terre-des-hommes" },
      contact: { email: "info@tdh.org" },
      quiz: {},
      placeholder: false,
      isOrganizer: true,
      orgKey: "tdh",
    },
    {
      id: 26,
      name: "Kindernothilfe",
      category: "Co-Convener Stand",
      organization: "Kindernothilfe (KNH)",
      theme: "Child Protection & Sustainable Development",
      overview: "Kindernothilfe (KNH) is a Christian children's relief organisation founded in Duisburg, Germany, in 1959. It works exclusively through local project partners to secure a better future for children — strengthening child protection, education and self-help groups, and training more than 650 organisations worldwide. At the Marketplace, KNH co-hosts the organizer area and the partner network behind the youth innovations on show.",
      logo: "",
      intro_video: "",
      images: [],
      stats: [
        { value: "1959", label: "Founded" },
        { value: "650+", label: "Organisations trained" },
        { value: "Co-Convener", label: "GMC EVAC 2026" }
      ],
      links: [{ label: "kindernothilfe.org", url: "https://www.kindernothilfe.org/en/" }],
      socials: { facebook: "https://facebook.com/kindernothilfe", twitter: "https://x.com/kindernothilfe", instagram: "https://instagram.com/kindernothilfe" },
      contact: { email: "info@kindernothilfe.de" },
      quiz: {},
      placeholder: false,
      isOrganizer: true,
      orgKey: "knh",
    },
    {
      id: 27,
      name: "Violence Ends With Us",
      category: "Co-Convener Stand",
      organization: "Violence Ends With Us Movement",
      theme: "Regional Youth-Led Movement",
      overview: "Violence Ends With Us (VEWU) is a regional youth-led movement dedicated to children, young people and survivors across the Asia-Pacific. Uniting voices from over 20 countries, VEWU turns youth ideas into action, brings lived realities into decision-making spaces, and grows a community of Lightkeepers working toward a violence-free future. Follow the lighthouse — and join the movement.",
      logo: "",
      intro_video: "",
      images: [],
      stats: [
        { value: "20+", label: "Countries" },
        { value: "500+", label: "Youth leaders" },
        { value: "53", label: "Partners" }
      ],
      links: [{ label: "violenceendswithus.com", url: "https://violenceendswithus.com/" }],
      socials: { instagram: "https://instagram.com/violenceendswithus", linkedin: "https://linkedin.com/company/violence-ends-with-us" },
      contact: { email: "movement@violenceendswithus.com" },
      quiz: {},
      placeholder: false,
      isOrganizer: true,
      orgKey: "vewu",
    },
  ];

  organizerDefaults.forEach((org) => {
    const existingOrg = Array.isArray(organizersData) ? organizersData.find(o => o.id === org.orgKey) : null;
    if (existingOrg) {
      org.overview = existingOrg.overview || org.overview;
      if (existingOrg.stats && existingOrg.stats.length) org.stats = existingOrg.stats;
      if (existingOrg.links && existingOrg.links.length) org.links = existingOrg.links;
    }
    list.push(org);
  });

  return list;
}

// ─── Load Booths ─────────────────────────
async function loadBooths() {
  setStatus('loading');
  const fallback27 = build27BoothsFallback();
  try {
    const data = await api('/booths');
    if (data.ok && Array.isArray(data.booths) && data.booths.length > 0) {
      // Merge: keep DB booths and append any organizer booths if DB only had 24
      const existingIds = new Set(data.booths.map(b => b.id));
      booths = [...data.booths];
      fallback27.forEach((fb) => {
        if (!existingIds.has(fb.id)) {
          booths.push(fb);
        }
      });
      // Sort numerically 1 to 27
      booths.sort((a, b) => a.id - b.id);
      setStatus('online');
    } else {
      throw new Error('Database returned empty');
    }
  } catch (err) {
    console.warn('API fetch failed, loading all 27 booths from local fallback:', err);
    booths = fallback27;
    setStatus('local');
  }

  categories = new Set(booths.map((b) => b.category).filter(Boolean));
  renderFilters();
  renderBooths();
}

function setStatus(state) {
  statusDot.className = 'status-dot ' + (state === 'online' ? 'online' : state === 'local' ? 'local' : 'error');
  statusLabel.textContent = state === 'online' ? 'Connected (Supabase)' : state === 'local' ? 'Active (All 27 Booths)' : 'Offline';
}

// ─── Render Booths Grid ──────────────────
function renderFilters() {
  filterPills.innerHTML = '<button class="pill active" data-filter="all">All (27)</button>';
  for (const cat of [...categories].sort()) {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.dataset.filter = cat;
    btn.textContent = cat;
    filterPills.appendChild(btn);
  }
  filterPills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    currentFilter = pill.dataset.filter;
    $$('.pill').forEach((p) => p.classList.toggle('active', p.dataset.filter === currentFilter));
    renderBooths();
  });
}

function renderBooths() {
  const query = searchInput.value.toLowerCase().trim();
  const filtered = booths.filter((b) => {
    if (currentFilter !== 'all' && b.category !== currentFilter) return false;
    if (query) {
      const haystack = `${b.name} ${b.organization} ${b.category} ${b.theme} ${b.overview}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  boothCount.textContent = `${filtered.length} booth${filtered.length !== 1 ? 's' : ''}`;
  boothsGrid.innerHTML = '';

  for (const booth of filtered) {
    const card = document.createElement('div');
    card.className = 'booth-card' + (booth.placeholder ? ' is-placeholder' : '');
    card.dataset.id = booth.id;

    const hasLogo = !!booth.logo;
    const hasImages = Array.isArray(booth.images) && booth.images.length > 0;
    const hasVideo = !!booth.intro_video;
    const hasQuiz = booth.quiz && booth.quiz.questions && booth.quiz.questions.length > 0;
    const isOrg = booth.id >= 25 || booth.category?.includes('Organizer') || booth.category?.includes('Co-Convener');

    card.innerHTML = `
      <div class="booth-card-header">
        <div class="booth-number" style="${isOrg ? 'background: linear-gradient(135deg, #f59e0b, #d97706);' : ''}">${booth.id}</div>
        <div class="booth-card-info">
          <div class="booth-card-name">${escHtml(booth.name || 'Untitled')}</div>
          <div class="booth-card-org">${escHtml(booth.organization || (isOrg ? 'Co-Convener' : 'Youth Innovation'))}</div>
        </div>
        <span class="badge ${isOrg ? 'badge-convener' : (booth.placeholder ? 'badge-placeholder' : 'badge-active')}">
          ${isOrg ? 'Organizer' : (booth.placeholder ? 'Draft' : 'Active')}
        </span>
      </div>

      <div class="booth-card-body">
        <p class="booth-card-desc">${escHtml(booth.overview ? booth.overview.slice(0, 110) + '…' : 'No description provided yet.')}</p>
        <div class="booth-card-meta">
          <span class="meta-tag" title="Logo">${hasLogo ? '✓' : '✗'} Logo</span>
          <span class="meta-tag" title="Images">${hasImages ? booth.images.length : 0} Images</span>
          <span class="meta-tag" title="Video">${hasVideo ? '✓' : '✗'} Video</span>
          <span class="meta-tag" title="Quiz">${hasQuiz ? '✓' : '✗'} Quiz</span>
        </div>
        <span class="booth-card-category">${escHtml(booth.category || booth.theme || (isOrg ? 'Co-Convener Stand' : 'Innovation'))}</span>
      </div>

      <div class="booth-card-actions">
        <button class="btn btn-sm btn-edit" data-id="${booth.id}">
          <i class="fas fa-pen-to-square"></i> Edit Booth
        </button>
      </div>
    `;

    boothsGrid.appendChild(card);
  }

  // Edit buttons
  $$('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const booth = booths.find((b) => b.id === id);
      if (booth) openEditor(booth);
    });
  });
}

searchInput.addEventListener('input', () => renderBooths());

// ─── Edit Modal ──────────────────────────
function openEditor(booth) {
  editingBooth = booth;
  const isOrg = booth.id >= 25 || booth.category?.includes('Organizer') || booth.category?.includes('Co-Convener');
  $('#modalTitle').textContent = `Booth #${booth.id} — ${booth.name || 'Untitled'}${isOrg ? ' (Organizer Stand)' : ''}`;
  $('#editId').value = booth.id;

  // Basic Info
  $('#editName').value = booth.name || '';
  $('#editOrg').value = booth.organization || '';
  $('#editCategory').value = booth.category || (isOrg ? 'Co-Convener Stand' : '');
  $('#editTheme').value = booth.theme || '';
  $('#editPlaceholder').checked = booth.placeholder ?? true;

  // Content
  $('#editOverview').value = booth.overview || '';
  $('#editStats').value = safeJsonStr(booth.stats);

  // Media
  $('#editLogo').value = booth.logo || '';
  updateLogoPreview();
  $('#editVideo').value = booth.intro_video || '';
  renderImageGallery(booth.images || []);

  // Quiz
  const quiz = booth.quiz || {};
  $('#editQuizTitle').value = quiz.title || '';
  $('#editPassScore').value = quiz.passScore || '';
  renderQuizQuestions(quiz.questions || []);

  // Socials
  const socials = booth.socials || {};
  SOCIAL_NETWORKS.forEach(({ id }) => {
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    const input = $(`#social${cap}`);
    if (input) {
      input.value = socials[id] || (id === 'twitter' ? (socials.x || '') : '');
      updateSocialRowState(id);
    }
  });

  // Custom Links
  renderCustomLinksList(booth.links || []);

  // Contact
  const contact = booth.contact || {};
  $('#contactEmail').value = contact.email || '';
  $('#contactPhone').value = contact.phone || '';
  $('#contactLocation').value = contact.location || contact.address || '';

  // Update Live Preview Chips
  updateSocialsLivePreview();

  // Show first tab
  switchFormTab('basic');
  editModal.hidden = false;
}

function closeEditor() {
  editModal.hidden = true;
  editingBooth = null;
}

$('#modalClose').addEventListener('click', closeEditor);
$('#modalCancel').addEventListener('click', closeEditor);

editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditor();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !editModal.hidden) closeEditor();
});

// Form Tabs
$('#formTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.form-tab');
  if (!tab) return;
  switchFormTab(tab.dataset.tab);
});

function switchFormTab(tab) {
  $$('.form-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.form-panel').forEach((p) => {
    p.hidden = p.dataset.panel !== tab;
    if (!p.hidden) p.classList.add('active');
  });
}

// Save Changes
$('#modalSave').addEventListener('click', async () => {
  if (!editingBooth) return;

  const id = editingBooth.id;

  // Collect socials
  const socials = {};
  SOCIAL_NETWORKS.forEach(({ id: netId }) => {
    const cap = netId.charAt(0).toUpperCase() + netId.slice(1);
    const input = $(`#social${cap}`);
    const val = input ? input.value.trim() : '';
    if (val) socials[netId] = val;
  });

  // Collect custom links
  const links = collectCustomLinks();

  // Collect contact
  const contact = {};
  const email = $('#contactEmail')?.value.trim();
  const phone = $('#contactPhone')?.value.trim();
  const loc = $('#contactLocation')?.value.trim();
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (loc) contact.location = loc;

  const body = {
    name: $('#editName').value.trim(),
    organization: $('#editOrg').value.trim(),
    category: $('#editCategory').value.trim(),
    theme: $('#editTheme').value.trim(),
    placeholder: $('#editPlaceholder').checked,
    overview: $('#editOverview').value.trim(),
    logo: $('#editLogo').value.trim(),
    intro_video: $('#editVideo').value.trim(),
    stats: safeParse($('#editStats').value, []),
    images: collectImages(),
    links,
    socials,
    contact,
    quiz: collectQuiz(),
  };

  try {
    await api(`/booths/${id}`, { method: 'PUT', body });
    toast(`Booth #${id} saved successfully!`, 'success');
    closeEditor();
    loadBooths();
  } catch (err) {
    // If backend is local/offline, update local in-memory booth
    const idx = booths.findIndex(b => b.id === id);
    if (idx !== -1) {
      booths[idx] = { ...booths[idx], ...body, id };
      renderBooths();
      toast(`Booth #${id} saved locally (${err.message})`, 'info');
      closeEditor();
    } else {
      toast('Save failed: ' + err.message, 'error');
    }
  }
});

// ─── Logo Preview & Upload ───────────────
$('#editLogo').addEventListener('input', updateLogoPreview);

function updateLogoPreview() {
  const url = $('#editLogo').value.trim();
  const preview = $('#logoPreview');
  if (url) {
    preview.innerHTML = `<img src="${escAttr(url)}" alt="Logo preview" onerror="this.remove()">`;
  } else {
    preview.innerHTML = '';
  }
}

$('#uploadLogoBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, `booth-${editingBooth.id}/logo-${Date.now()}.${file.name.split('.').pop()}`);
      $('#editLogo').value = url;
      updateLogoPreview();
      toast('Logo uploaded!', 'success');
    } catch (err) {
      toast('Upload failed: ' + err.message, 'error');
    }
  });
  input.click();
});

// ─── Image Gallery Editor ────────────────
function renderImageGallery(images) {
  const container = $('#editImages');
  container.innerHTML = '';
  (images || []).forEach((url, i) => {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.innerHTML = `
      <img src="${escAttr(url)}" alt="Image ${i + 1}">
      <button type="button" class="remove-btn" data-index="${i}"><i class="fas fa-xmark"></i></button>
    `;
    item.querySelector('.remove-btn').addEventListener('click', () => {
      images.splice(i, 1);
      renderImageGallery(images);
    });
    container.appendChild(item);
  });
}

function collectImages() {
  return [...$$('#editImages .image-item img')].map((img) => img.src);
}

$('#addImageBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = [...input.files];
    for (const file of files) {
      try {
        const url = await uploadFile(file, `booth-${editingBooth.id}/img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${file.name.split('.').pop()}`);
        const images = collectImages();
        images.push(url);
        renderImageGallery(images);
        toast(`Image uploaded!`, 'success');
      } catch (err) {
        toast('Upload failed: ' + err.message, 'error');
      }
    }
  });
  input.click();
});

// ─── Quiz Editor ─────────────────────────
function renderQuizQuestions(questions) {
  const container = $('#quizQuestions');
  container.innerHTML = '';

  questions.forEach((q, qi) => {
    const div = document.createElement('div');
    div.className = 'quiz-question';
    div.dataset.qi = qi;

    let choicesHtml = '';
    (q.choices || []).forEach((c, ci) => {
      choicesHtml += `
        <div class="quiz-choice">
          <input type="radio" name="q${qi}_correct" value="${ci}" ${ci === q.correctIndex ? 'checked' : ''}>
          <input type="text" value="${escAttr(c)}" data-qi="${qi}" data-ci="${ci}" class="choice-text">
          <button type="button" class="remove-choice" data-qi="${qi}" data-ci="${ci}"><i class="fas fa-xmark"></i></button>
        </div>
      `;
    });

    div.innerHTML = `
      <div class="quiz-question-header">
        <span>Question ${qi + 1}</span>
        <button type="button" class="remove-question" data-qi="${qi}"><i class="fas fa-trash"></i></button>
      </div>
      <div class="form-group" style="margin-bottom:8px">
        <input type="text" class="question-prompt" value="${escAttr(q.prompt || '')}" placeholder="Question prompt">
      </div>
      <div class="choices-list">${choicesHtml}</div>
      <button type="button" class="quiz-add-choice" data-qi="${qi}">+ Add choice</button>
    `;

    container.appendChild(div);
  });

  // Remove question
  container.querySelectorAll('.remove-question').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qi = Number(btn.dataset.qi);
      const qs = collectQuizQuestions();
      qs.splice(qi, 1);
      renderQuizQuestions(qs);
    });
  });

  // Remove choice
  container.querySelectorAll('.remove-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qi = Number(btn.dataset.qi);
      const ci = Number(btn.dataset.ci);
      const qs = collectQuizQuestions();
      qs[qi].choices.splice(ci, 1);
      renderQuizQuestions(qs);
    });
  });

  // Add choice
  container.querySelectorAll('.quiz-add-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qs = collectQuizQuestions();
      qs[Number(btn.dataset.qi)].choices.push('');
      renderQuizQuestions(qs);
    });
  });
}

function collectQuizQuestions() {
  const questions = [];
  $$('.quiz-question').forEach((div) => {
    const prompt = div.querySelector('.question-prompt')?.value || '';
    const choices = [...div.querySelectorAll('.choice-text')].map((inp) => inp.value);
    const radios = div.querySelectorAll('input[type="radio"]');
    let correctIndex = 0;
    radios.forEach((r, i) => { if (r.checked) correctIndex = i; });
    questions.push({ prompt, choices, correctIndex });
  });
  return questions;
}

function collectQuiz() {
  return {
    title: $('#editQuizTitle').value.trim() || 'Quick quiz',
    passScore: Number($('#editPassScore').value) || 2,
    questions: collectQuizQuestions(),
  };
}

$('#addQuestionBtn').addEventListener('click', () => {
  const qs = collectQuizQuestions();
  qs.push({ prompt: '', choices: ['', ''], correctIndex: 0 });
  renderQuizQuestions(qs);
});

// ─── Socials & Links Helpers ─────────────
function updateSocialRowState(network) {
  const cap = network.charAt(0).toUpperCase() + network.slice(1);
  const input = $(`#social${cap}`);
  const row = $(`.social-input-row[data-network="${network}"]`);
  if (!input || !row) return;

  const val = input.value.trim();
  const testBtn = row.querySelector('.test-btn');
  const clearBtn = row.querySelector('.clear-btn');

  if (val) {
    row.classList.add('has-link');
    if (testBtn) {
      testBtn.hidden = false;
      testBtn.href = val.startsWith('http://') || val.startsWith('https://') ? val : `https://${val}`;
    }
    if (clearBtn) clearBtn.hidden = false;
  } else {
    row.classList.remove('has-link');
    if (testBtn) {
      testBtn.hidden = true;
      testBtn.removeAttribute('href');
    }
    if (clearBtn) clearBtn.hidden = true;
  }
}

function initSocialsListeners() {
  SOCIAL_NETWORKS.forEach(({ id }) => {
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    const input = $(`#social${cap}`);
    const row = $(`.social-input-row[data-network="${id}"]`);
    if (!input || !row) return;

    input.addEventListener('input', () => {
      updateSocialRowState(id);
      updateSocialsLivePreview();
    });

    const clearBtn = row.querySelector('.clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        updateSocialRowState(id);
        updateSocialsLivePreview();
        input.focus();
      });
    }
  });

  $('#addCustomLinkBtn')?.addEventListener('click', () => {
    addCustomLinkRow('', '');
    updateSocialsLivePreview();
  });

  $('#contactEmail')?.addEventListener('input', updateSocialsLivePreview);
  $('#contactPhone')?.addEventListener('input', updateSocialsLivePreview);
  $('#contactLocation')?.addEventListener('input', updateSocialsLivePreview);
}

function renderCustomLinksList(links = []) {
  const container = $('#customLinksList');
  if (!container) return;
  container.innerHTML = '';

  const arr = Array.isArray(links) ? links : [];
  if (arr.length === 0) {
    container.innerHTML = '<div class="custom-links-empty">No custom resource links added yet. Click <strong>+ Add Link</strong> above.</div>';
    return;
  }

  arr.forEach((link) => {
    addCustomLinkRow(link.label || '', link.url || link.href || '');
  });
}

function addCustomLinkRow(label = '', url = '') {
  const container = $('#customLinksList');
  if (!container) return;

  const emptyMsg = container.querySelector('.custom-links-empty');
  if (emptyMsg) emptyMsg.remove();

  const row = document.createElement('div');
  row.className = 'custom-link-row';
  const safeHref = url ? (url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`) : '#';
  row.innerHTML = `
    <input type="text" class="custom-link-label" placeholder="e.g. Website" value="${escAttr(label)}">
    <input type="url" class="custom-link-url" placeholder="https://..." value="${escAttr(url)}">
    <div class="custom-link-actions">
      <a href="${escAttr(safeHref)}" target="_blank" rel="noopener noreferrer" class="custom-link-btn test-link-btn" title="Open link in new tab" ${url ? '' : 'style="opacity:0.3;pointer-events:none;"'}>
        <i class="fas fa-arrow-up-right-from-square"></i>
      </a>
      <button type="button" class="custom-link-btn delete-btn" title="Remove link">
        <i class="fas fa-trash-can"></i>
      </button>
    </div>
  `;

  const labelInput = row.querySelector('.custom-link-label');
  const urlInput = row.querySelector('.custom-link-url');
  const testBtn = row.querySelector('.test-link-btn');
  const deleteBtn = row.querySelector('.delete-btn');

  urlInput.addEventListener('input', () => {
    const val = urlInput.value.trim();
    if (val) {
      testBtn.href = val.startsWith('http://') || val.startsWith('https://') ? val : `https://${val}`;
      testBtn.style.opacity = '1';
      testBtn.style.pointerEvents = 'auto';
    } else {
      testBtn.removeAttribute('href');
      testBtn.style.opacity = '0.3';
      testBtn.style.pointerEvents = 'none';
    }
    updateSocialsLivePreview();
  });

  labelInput.addEventListener('input', updateSocialsLivePreview);

  deleteBtn.addEventListener('click', () => {
    row.remove();
    if (container.querySelectorAll('.custom-link-row').length === 0) {
      container.innerHTML = '<div class="custom-links-empty">No custom resource links added yet. Click <strong>+ Add Link</strong> above.</div>';
    }
    updateSocialsLivePreview();
  });

  container.appendChild(row);
}

function collectCustomLinks() {
  const container = $('#customLinksList');
  if (!container) return [];
  const rows = container.querySelectorAll('.custom-link-row');
  const links = [];
  rows.forEach((row) => {
    const label = row.querySelector('.custom-link-label')?.value.trim();
    const url = row.querySelector('.custom-link-url')?.value.trim();
    if (url) {
      links.push({
        label: label || url.replace(/^https?:\/\//, ''),
        url: url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`,
      });
    }
  });
  return links;
}

function updateSocialsLivePreview() {
  const previewBox = $('#socialsLiveChips');
  if (!previewBox) return;

  const chips = [];

  // Socials
  SOCIAL_NETWORKS.forEach(({ id, name, icon }) => {
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    const input = $(`#social${cap}`);
    const url = input?.value.trim();
    if (url) {
      const fullUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
      chips.push(`<a href="${escAttr(fullUrl)}" target="_blank" rel="noopener noreferrer" class="preview-chip ${id}" title="Test ${name} link"><i class="${icon}"></i> ${name}</a>`);
    }
  });

  // Custom links
  const customLinks = collectCustomLinks();
  customLinks.forEach((l) => {
    chips.push(`<a href="${escAttr(l.url)}" target="_blank" rel="noopener noreferrer" class="preview-chip link" title="Test link"><i class="fas fa-link"></i> ${escHtml(l.label)}</a>`);
  });

  // Contact
  const email = $('#contactEmail')?.value.trim();
  if (email) {
    chips.push(`<span class="preview-chip contact"><i class="fas fa-envelope"></i> ${escHtml(email)}</span>`);
  }
  const phone = $('#contactPhone')?.value.trim();
  if (phone) {
    chips.push(`<span class="preview-chip contact"><i class="fas fa-phone"></i> ${escHtml(phone)}</span>`);
  }

  if (chips.length > 0) {
    previewBox.innerHTML = chips.join('');
  } else {
    previewBox.innerHTML = '<span class="preview-empty-hint">No links added yet. Paste links below to see icons appear here.</span>';
  }
}

// ─── File Upload ─────────────────────────
async function uploadFile(file, name) {
  const uploadUrl = `${API_BASE}/upload?name=${encodeURIComponent(name)}&token=gmc-dev`;
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Admin-Token': 'gmc-dev',
    },
    body: file,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Upload failed');
  return data.publicUrl;
}

// ─── Media Library ───────────────────────
$('#uploadMediaBtn').addEventListener('click', () => {
  $('#mediaFileInput').click();
});

$('#mediaFileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  for (const file of files) {
    try {
      const name = `media/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadFile(file, name);
      toast(`Uploaded ${file.name}`, 'success');
    } catch (err) {
      toast(`Upload failed: ${err.message}`, 'error');
    }
  }
  loadMedia();
});

async function loadMedia() {
  const grid = $('#mediaGrid');
  const empty = $('#mediaEmpty');
  try {
    const data = await api('/media');
    const files = data.files || [];
    grid.innerHTML = '';
    empty.hidden = files.length > 0;

    for (const f of files) {
      const item = document.createElement('div');
      item.className = 'media-item';
      const isVideo = /\.(mp4|webm|mov)$/i.test(f.name);
      item.innerHTML = `
        ${isVideo ? `<video src="${escAttr(f.url)}" muted loop></video>` : `<img src="${escAttr(f.url)}" alt="${escAttr(f.name)}" loading="lazy">`}
        <div class="media-item-overlay">
          <div class="media-item-name">${escHtml(f.name.split('/').pop())}</div>
          <div class="media-item-actions">
            <button class="copy-url-btn" data-url="${escAttr(f.url)}"><i class="fas fa-copy"></i> Copy</button>
            <button class="danger delete-media-btn" data-name="${escAttr(f.name)}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      `;
      grid.appendChild(item);
    }

    grid.querySelectorAll('.copy-url-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.url);
        toast('URL copied to clipboard!', 'info');
      });
    });

    grid.querySelectorAll('.delete-media-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this file?')) return;
        try {
          await api('/media', { method: 'DELETE', body: { name: btn.dataset.name } });
          toast('File deleted', 'success');
          loadMedia();
        } catch (err) {
          toast('Delete failed: ' + err.message, 'error');
        }
      });
    });
  } catch (err) {
    console.warn('Load media failed:', err);
    empty.textContent = 'Media library storage not initialized yet.';
    empty.hidden = false;
  }
}

// ─── Integrated Analytics Engine & Visual Charts ──
const CHART_METRICS = {
  score: {
    label: 'Engagement Score',
    key: 'engagementScore',
    unit: 'pts',
    colors: { from: '#38bdf8', to: '#6366f1' },
    getValue: (b) => b.engagementScore || 0,
  },
  opens: {
    label: 'Booth Impressions',
    key: 'opens',
    unit: 'opens',
    colors: { from: '#38bdf8', to: '#0284c7' },
    getValue: (b) => b.opens || 0,
  },
  hearts: {
    label: 'Reactions / Hearts',
    key: 'hearts',
    unit: 'hearts',
    colors: { from: '#f43f5e', to: '#be123c' },
    getValue: (b) => b.hearts || 0,
  },
  intros: {
    label: 'Video Plays',
    key: 'introPlays',
    unit: 'views',
    colors: { from: '#2dd4bf', to: '#0f766e' },
    getValue: (b) => b.introPlays || 0,
  },
  quizzes: {
    label: 'Quiz Attempts',
    key: 'quizPlays',
    unit: 'plays',
    colors: { from: '#fbbf24', to: '#d97706' },
    getValue: (b) => b.quizPlays || 0,
  },
  passRate: {
    label: 'Quiz Pass Rate',
    key: 'passRate',
    unit: '%',
    colors: { from: '#34d399', to: '#059669' },
    getValue: (b) => (b.quizPlays > 0 ? Math.round((b.quizPasses / b.quizPlays) * 100) : 0),
  },
  linkClicks: {
    label: 'Link & Social Clicks',
    key: 'linkClicks',
    unit: 'clicks',
    colors: { from: '#a855f7', to: '#7e22ce' },
    getValue: (b) => b.linkClicks || 0,
  },
  comments: {
    label: 'Visitor Notes',
    key: 'comments',
    unit: 'notes',
    colors: { from: '#818cf8', to: '#4f46e5' },
    getValue: (b) => b.comments || 0,
  },
};

let selectedChartMetric = 'score';
let selectedChartScope = 'top10';
let selectedCategoryFilter = 'all';
let activeDossierBoothId = null;

async function loadAnalytics() {
  const statusText = $('#analyticsStatusText');
  try {
    const res = await fetch(`${ANALYTICS_BASE}?token=gmc-dev`);
    const data = await res.json();
    if (data && data.ok) {
      analyticsData = data;
      renderAnalytics(data);
      if (statusText) statusText.innerHTML = `Live Telemetry &bull; Updated ${new Date().toLocaleTimeString()} &bull; Auto-refresh 10s`;
    }
  } catch (err) {
    console.warn('Analytics fetch error:', err);
    if (statusText) statusText.textContent = `Telemetry server connecting… (retrying in 10s)`;
  }
}

function getEnrichedBoothRows(data) {
  const rawBooths = data.booths || {};
  const serverBoothsMap = new Map();
  if (Array.isArray(rawBooths)) {
    rawBooths.forEach(b => serverBoothsMap.set(Number(b.id), b));
  } else if (typeof rawBooths === 'object') {
    Object.entries(rawBooths).forEach(([k, stats]) => serverBoothsMap.set(Number(k), stats));
  }

  const enriched = booths.map((b) => {
    const stats = serverBoothsMap.get(b.id) || {};
    const opens = stats.opens || 0;
    const intros = stats.introPlays || 0;
    const quizzes = stats.quizPlays || 0;
    const passes = stats.quizPasses || 0;
    const hearts = stats.hearts || 0;
    const comments = stats.comments || 0;
    const linkClicks = stats.linkClicks || 0;
    const engagementScore = stats.engagementScore !== undefined
      ? stats.engagementScore
      : (opens * 1) + (intros * 2) + (quizzes * 2) + (passes * 1) + (hearts * 3) + (comments * 3) + (linkClicks * 2);
    const passRate = quizzes > 0 ? `${Math.round((passes / quizzes) * 100)}%` : '—';
    const isOrg = b.id >= 25 || b.category?.includes('Organizer') || b.category?.includes('Co-Convener');

    return {
      id: b.id,
      name: b.name || `Booth #${b.id}`,
      org: b.organization || '',
      category: b.category || (isOrg ? 'Co-Convener Stand' : 'Youth Innovation'),
      isOrg,
      opens,
      introPlays: intros,
      quizPlays: quizzes,
      quizPasses: passes,
      passRate,
      hearts,
      comments,
      linkClicks,
      engagementScore,
      boothComments: stats.boothComments || [],
    };
  });

  // Assign ranks by engagementScore descending
  const sorted = [...enriched].sort((a, b) => b.engagementScore - a.engagementScore);
  sorted.forEach((item, index) => {
    item.rank = index + 1;
  });

  return enriched;
}

function renderAnalytics(data) {
  // Update KPI counters
  $('#kpiOnline').textContent = (data.onlineNow ?? 0).toLocaleString();
  $('#kpiPeak').textContent = (data.peakConcurrent ?? 0).toLocaleString();
  $('#kpiUniques').textContent = (data.uniqueVisitors ?? 0).toLocaleString();
  $('#kpiPageViews').textContent = (data.pageViews ?? 0).toLocaleString();
  $('#kpiOpens').textContent = (data.totalOpens ?? 0).toLocaleString();
  $('#kpiHearts').textContent = (data.totalHearts ?? 0).toLocaleString();
  $('#kpiComments').textContent = (data.totalComments ?? 0).toLocaleString();
  $('#kpiPassports').textContent = (data.passportCompletions ?? 0).toLocaleString();

  const quizPlays = data.totalQuizPlays ?? 0;
  const quizPasses = data.totalQuizPasses ?? 0;
  $('#kpiQuizzes').textContent = `${quizPlays} / ${quizPasses}`;

  const allRows = getEnrichedBoothRows(data);

  // Update Category Select Dropdown if needed
  const catSelect = $('#analyticsCategoryFilter');
  if (catSelect && catSelect.children.length <= 1) {
    const cats = [...new Set(allRows.map(r => r.category).filter(Boolean))].sort();
    cats.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
  }

  // Render Table
  const tbody = $('#analyticsBoothRows');
  if (tbody) {
    const searchVal = $('#analyticsBoothSearch')?.value.toLowerCase().trim() || '';
    tbody.innerHTML = '';

    const filteredRows = allRows.filter((r) => {
      if (selectedCategoryFilter !== 'all' && r.category !== selectedCategoryFilter) return false;
      if (searchVal) {
        const text = `${r.id} ${r.name} ${r.org} ${r.category}`.toLowerCase();
        if (!text.includes(searchVal)) return false;
      }
      return true;
    });

    // Sort table rows by rank
    filteredRows.sort((a, b) => a.rank - b.rank);

    filteredRows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <span class="table-rank-pill ${r.rank <= 3 ? 'top-3' : ''}">#${r.rank}</span>
        </td>
        <td>
          <div class="table-booth-name">${escHtml(r.name)}</div>
          <div class="table-booth-org">${escHtml(r.org)}</div>
        </td>
        <td>
          <span class="table-badge ${r.isOrg ? 'organizer' : 'youth'}">
            ${escHtml(r.category)}
          </span>
        </td>
        <td class="table-stat-highlight">${r.opens.toLocaleString()}</td>
        <td>${r.introPlays.toLocaleString()}</td>
        <td>${r.quizPlays.toLocaleString()} <span style="color:#94a3b8;font-size:0.75rem;">(${r.passRate})</span></td>
        <td><span style="color:#f43f5e;">❤️</span> ${r.hearts.toLocaleString()}</td>
        <td><span style="color:#818cf8;">💬</span> ${r.comments.toLocaleString()}</td>
        <td><span style="color:#a855f7;">🔗</span> ${r.linkClicks.toLocaleString()}</td>
        <td style="font-weight:700;color:#38bdf8;">${r.engagementScore.toLocaleString()} pts</td>
        <td style="text-align: right;">
          <div style="display:inline-flex;gap:6px;align-items:center;">
            <button type="button" class="deep-dive-btn" data-id="${r.id}" title="View 6-stage conversion funnel and micro breakdown">
              <i class="fas fa-chart-pie"></i> Deep Dive
            </button>
            <button type="button" class="table-action-edit" data-id="${r.id}" title="Edit Booth Content">
              <i class="fas fa-pen"></i>
            </button>
          </div>
        </td>
      `;

      tr.querySelector('.deep-dive-btn')?.addEventListener('click', () => openBoothDossier(r.id));
      tr.querySelector('.table-action-edit')?.addEventListener('click', () => {
        const b = booths.find(item => item.id === r.id);
        if (b) openEditor(b);
      });

      tbody.appendChild(tr);
    });
  }

  // Render Visual Charts Suite
  renderAnalyticsCharts(allRows);

  // Render Recent Comments Feed
  const commentsList = $('#analyticsRecentComments');
  if (commentsList) {
    const comments = data.recentComments || [];
    if (comments.length === 0) {
      commentsList.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:18px;">No visitor comments recorded yet. Comments posted in the 3D hall appear here live.</div>';
    } else {
      commentsList.innerHTML = comments.slice(0, 18).map((c) => {
        const boothObj = booths.find(b => b.id === Number(c.boothId));
        const boothName = boothObj ? boothObj.name : `Booth #${c.boothId}`;
        const timeAgo = formatTimeAgo(c.ts || c.timestamp || Date.now());
        return `
          <div class="analytics-comment-card">
            <div class="comment-avatar">${(c.name || 'V').charAt(0).toUpperCase()}</div>
            <div class="comment-body">
              <div class="comment-meta">
                <span class="comment-booth-tag">${escHtml(boothName)}</span>
                <span>&bull;</span>
                <span style="color:#f8fafc;font-weight:600;">${escHtml(c.name || 'Delegate')}</span>
                <span>&bull;</span>
                <span>${escHtml(timeAgo)}</span>
              </div>
              <div class="comment-text">${escHtml(c.text || '')}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// ─── SVG Visual Chart Suite ──────────────
function renderAnalyticsCharts(allRows) {
  const container = $('#analyticsChartContainer');
  const tooltip = $('#chartTooltip');
  if (!container) return;

  const metricConfig = CHART_METRICS[selectedChartMetric] || CHART_METRICS.score;
  let chartItems = [];

  if (selectedChartScope === 'clusters') {
    // Aggregate by category
    const clusterMap = new Map();
    allRows.forEach((r) => {
      const cat = r.category || 'General';
      if (!clusterMap.has(cat)) {
        clusterMap.set(cat, { name: cat, total: 0, count: 0, booths: [] });
      }
      const entry = clusterMap.get(cat);
      entry.total += metricConfig.getValue(r);
      entry.count += 1;
      entry.booths.push(r);
    });

    chartItems = [...clusterMap.values()].map((c) => {
      const val = selectedChartMetric === 'passRate'
        ? Math.round(c.total / Math.max(1, c.count))
        : c.total;
      return {
        id: null,
        name: c.name,
        org: `${c.count} booth${c.count > 1 ? 's' : ''}`,
        value: val,
        isCluster: true,
        clusterBooths: c.booths,
      };
    });
    chartItems.sort((a, b) => b.value - a.value);
  } else {
    // Individual Booths (Top 10 or All 27)
    chartItems = allRows.map((r) => ({
      id: r.id,
      name: r.name,
      org: r.org,
      value: metricConfig.getValue(r),
      rank: r.rank,
      isCluster: false,
    }));

    chartItems.sort((a, b) => b.value - a.value);
    if (selectedChartScope === 'top10') {
      chartItems = chartItems.slice(0, 10);
    }
  }

  // Draw pure SVG Horizontal Bar Chart
  const count = chartItems.length;
  if (count === 0) {
    container.innerHTML = '<div class="chart-loading-placeholder">No data available to display.</div>';
    return;
  }

  const barHeight = count > 15 ? 20 : 26;
  const gap = count > 15 ? 9 : 12;
  const topPad = 28;
  const bottomPad = 24;
  const leftPad = selectedChartScope === 'clusters' ? 240 : 210;
  const rightPad = 80;
  const totalWidth = 900;
  const chartHeight = topPad + bottomPad + (count * (barHeight + gap));
  const maxVal = Math.max(1, ...chartItems.map(i => i.value));
  const innerWidth = totalWidth - leftPad - rightPad;

  // Grid lines (0, 25%, 50%, 75%, 100%)
  let gridSvg = '';
  [0, 0.25, 0.5, 0.75, 1].forEach((pct) => {
    const x = leftPad + (pct * innerWidth);
    const valAtTick = selectedChartMetric === 'passRate'
      ? `${Math.round(pct * maxVal)}%`
      : Math.round(pct * maxVal).toLocaleString();
    gridSvg += `
      <line x1="${x.toFixed(1)}" y1="${topPad - 6}" x2="${x.toFixed(1)}" y2="${(chartHeight - bottomPad).toFixed(1)}" class="chart-grid-line" />
      <text x="${x.toFixed(1)}" y="${topPad - 12}" text-anchor="middle" class="chart-axis-text">${valAtTick}</text>
    `;
  });

  const barsSvg = chartItems.map((item, idx) => {
    const y = topPad + idx * (barHeight + gap);
    const barWidth = Math.max(4, (item.value / maxVal) * innerWidth);
    const truncated = item.name.length > 24 ? item.name.slice(0, 23) + '…' : item.name;
    const labelText = item.isCluster ? item.name : `#${item.id} · ${truncated}`;
    const displayVal = selectedChartMetric === 'passRate' ? `${item.value}%` : item.value.toLocaleString();

    return `
      <g class="chart-bar-group" data-booth-id="${item.id || ''}" data-idx="${idx}">
        <text x="${leftPad - 12}" y="${y + barHeight / 2 + 4}" text-anchor="end" class="chart-label-booth">${escHtml(labelText)}</text>
        <rect x="${leftPad}" y="${y}" width="${innerWidth}" height="${barHeight}" rx="4" fill="rgba(255,255,255,0.03)" />
        <rect x="${leftPad}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="4" fill="url(#chartDynamicGrad)" class="chart-bar-fill" />
        <text x="${(leftPad + barWidth + 8).toFixed(1)}" y="${y + barHeight / 2 + 4}" text-anchor="start" class="chart-label-val">${displayVal}</text>
      </g>
    `;
  }).join('');

  container.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${totalWidth} ${chartHeight}" preserveAspectRatio="xMinYMin meet">
      <defs>
        <linearGradient id="chartDynamicGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${metricConfig.colors.from}" />
          <stop offset="100%" stop-color="${metricConfig.colors.to}" />
        </linearGradient>
      </defs>
      ${gridSvg}
      ${barsSvg}
    </svg>
  `;

  // Attach hover & click listeners to bar groups
  const groups = container.querySelectorAll('.chart-bar-group');
  groups.forEach((g) => {
    const boothId = g.dataset.boothId ? Number(g.dataset.boothId) : null;
    const idx = Number(g.dataset.idx);
    const item = chartItems[idx];

    g.addEventListener('mouseenter', (e) => {
      if (!tooltip || !item) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const title = item.isCluster ? item.name : `#${item.id} · ${item.name}`;
      const metricLine = `${metricConfig.label}: <strong>${item.value.toLocaleString()} ${metricConfig.unit}</strong>`;
      const clickHint = item.id ? '<div class="chart-tooltip-hint">Click bar to open full micro-dossier &rarr;</div>' : '';

      tooltip.innerHTML = `
        <div class="chart-tooltip-title"><i class="fas fa-chart-simple"></i> ${escHtml(title)}</div>
        <div class="chart-tooltip-metric">${metricLine}</div>
        ${clickHint}
      `;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(mouseX + 15, rect.width - 200)}px`;
      tooltip.style.top = `${Math.max(10, mouseY - 40)}px`;
    });

    g.addEventListener('mousemove', (e) => {
      if (!tooltip || tooltip.hidden) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      tooltip.style.left = `${Math.min(mouseX + 15, rect.width - 200)}px`;
      tooltip.style.top = `${Math.max(10, mouseY - 40)}px`;
    });

    g.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.hidden = true;
    });

    if (boothId) {
      g.addEventListener('click', () => openBoothDossier(boothId));
    }
  });
}

// ─── Per-Booth Deep-Dive Dossier Modal ────
function openBoothDossier(boothId) {
  const booth = booths.find(b => b.id === boothId);
  if (!booth) return;
  activeDossierBoothId = boothId;

  const rawBooths = analyticsData?.booths || {};
  const stats = (Array.isArray(rawBooths) ? rawBooths.find(b => Number(b.id) === boothId) : rawBooths[boothId]) || {};

  const opens = stats.opens || 0;
  const intros = stats.introPlays || 0;
  const quizzes = stats.quizPlays || 0;
  const passes = stats.quizPasses || 0;
  const hearts = stats.hearts || 0;
  const comments = stats.comments || 0;
  const linkClicks = stats.linkClicks || 0;
  const score = stats.engagementScore !== undefined
    ? stats.engagementScore
    : (opens * 1) + (intros * 2) + (quizzes * 2) + (passes * 1) + (hearts * 3) + (comments * 3) + (linkClicks * 2);

  // Set Header Information
  $('#dossierBoothId').textContent = `Booth #${String(booth.id).padStart(2, '0')}`;
  $('#dossierCategory').textContent = booth.category || (booth.id >= 25 ? 'Co-Convener Stand' : 'Youth Innovation');
  $('#dossierRank').innerHTML = `<i class="fas fa-trophy"></i> Rank #${stats.rank || '—'} of 27`;
  $('#dossierTitle').textContent = booth.name || `Booth #${booth.id}`;
  $('#dossierOrg').textContent = [booth.organization, booth.theme].filter(Boolean).join(' · ');
  $('#dossierScore').textContent = score.toLocaleString();

  // 1. Render 6-Stage Conversion Funnel
  const funnelEl = $('#dossierFunnel');
  if (funnelEl) {
    const base = Math.max(1, opens);
    const steps = [
      { label: '1. Hall Impressions', count: opens, pct: 100, colorClass: 'step-1' },
      { label: '2. Explored Video / Media', count: intros, pct: Math.round((intros / base) * 100), colorClass: 'step-2' },
      { label: '3. Challenge Started', count: quizzes, pct: Math.round((quizzes / base) * 100), colorClass: 'step-3' },
      { label: '4. Challenge Passed', count: passes, pct: quizzes > 0 ? Math.round((passes / quizzes) * 100) : 0, sub: quizzes > 0 ? 'pass rate' : 'no attempts', colorClass: 'step-4' },
      { label: '5. Loved Exhibit (Reacted)', count: hearts, pct: Math.round((hearts / base) * 100), colorClass: 'step-5' },
      { label: '6. Active Outreach (Clicks + Notes)', count: linkClicks + comments, pct: Math.round(((linkClicks + comments) / base) * 100), colorClass: 'step-6' },
    ];

    funnelEl.innerHTML = steps.map((s) => {
      const barWidth = Math.max(4, s.pct);
      const subLabel = s.sub ? `(${s.sub})` : `${s.pct}% of visitors`;
      return `
        <div class="funnel-step">
          <div class="funnel-step-header">
            <span class="funnel-step-label">${escHtml(s.label)}</span>
            <span class="funnel-step-badge"><strong>${s.count.toLocaleString()}</strong> &bull; ${subLabel}</span>
          </div>
          <div class="funnel-track">
            <div class="funnel-fill ${s.colorClass}" style="width: ${barWidth}%;">
              ${s.pct > 12 ? `${s.pct}%` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Render Micro-Metrics Tiles
  $('#dossierHeartCount').textContent = hearts.toLocaleString();
  $('#dossierHeartRate').textContent = opens > 0 ? `${((hearts / opens) * 100).toFixed(1)}% reaction rate` : '0% reaction rate';

  $('#dossierVideoCount').textContent = intros.toLocaleString();
  $('#dossierVideoRate').textContent = opens > 0 ? `${((intros / opens) * 100).toFixed(1)}% media exploration` : '0% media exploration';

  const passPct = quizzes > 0 ? Math.round((passes / quizzes) * 100) : 0;
  $('#dossierQuizPassRate').textContent = `${passPct}%`;
  $('#dossierQuizRatio').textContent = `${passes.toLocaleString()} passed / ${quizzes.toLocaleString()} taken`;

  $('#dossierClickCount').textContent = linkClicks.toLocaleString();
  $('#dossierClickRate').textContent = opens > 0 ? `${((linkClicks / opens) * 100).toFixed(1)}% click-through` : '0% click-through';

  // 3. Render SVG Donut Chart
  renderDonutChart(hearts, intros, quizzes, linkClicks, comments);

  // 4. Render Booth-Specific Comments
  const commentsContainer = $('#dossierCommentsList');
  if (commentsContainer) {
    // Get comments for this booth
    let boothComments = Array.isArray(stats.boothComments) ? stats.boothComments : [];
    if (boothComments.length === 0 && Array.isArray(analyticsData?.recentComments)) {
      boothComments = analyticsData.recentComments.filter(c => Number(c.boothId) === boothId);
    }

    if (boothComments.length === 0) {
      commentsContainer.innerHTML = '<div class="dossier-comments-empty"><i class="fas fa-comment-slash" style="font-size:1.5rem;margin-bottom:6px;opacity:0.4;display:block;"></i>No delegate notes posted at this booth yet. Messages left in the 3D hall appear here.</div>';
    } else {
      commentsContainer.innerHTML = boothComments.map((c) => {
        const timeAgo = formatTimeAgo(c.ts || c.timestamp || Date.now());
        return `
          <div class="dossier-comment-item">
            <div class="dossier-comment-header">
              <span class="dossier-comment-author"><i class="fas fa-user-circle"></i> ${escHtml(c.name || 'Delegate')}</span>
              <span class="dossier-comment-time">${escHtml(timeAgo)}</span>
            </div>
            <div class="dossier-comment-body">${escHtml(c.text || '')}</div>
          </div>
        `;
      }).join('');
    }
  }

  // Open Dossier Modal
  const modal = $('#boothDossierModal');
  if (modal) modal.hidden = false;
}

function closeBoothDossier() {
  const modal = $('#boothDossierModal');
  if (modal) modal.hidden = true;
  activeDossierBoothId = null;
}

function renderDonutChart(hearts, intros, quizzes, clicks, comments) {
  const chartEl = $('#dossierDonutChart');
  const legendEl = $('#dossierDonutLegend');
  if (!chartEl || !legendEl) return;

  const slices = [
    { label: 'Hearts', value: hearts, color: '#f43f5e' },
    { label: 'Video Plays', value: intros, color: '#2dd4bf' },
    { label: 'Quiz Challenges', value: quizzes, color: '#fbbf24' },
    { label: 'Link Clicks', value: clicks, color: '#a855f7' },
    { label: 'Visitor Notes', value: comments, color: '#818cf8' },
  ];

  const total = slices.reduce((acc, s) => acc + s.value, 0);

  if (total === 0) {
    chartEl.innerHTML = `
      <svg viewBox="0 0 100 100" style="width:100%;height:100%;">
        <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="14" />
        <text x="50" y="54" text-anchor="middle" fill="#64748b" font-size="11" font-family="Inter, sans-serif">0</text>
      </svg>
    `;
    legendEl.innerHTML = '<span style="color:#64748b;font-size:0.75rem;">No interactions recorded yet.</span>';
    return;
  }

  const cx = 50, cy = 50, r = 38, strokeWidth = 14;
  const circumference = 2 * Math.PI * r;
  let accumulatedAngle = 0;

  const paths = slices.map((s) => {
    if (s.value <= 0) return '';
    const fraction = s.value / total;
    const strokeDasharray = `${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
    const strokeDashoffset = (-accumulatedAngle * circumference).toFixed(2);
    accumulatedAngle += fraction;

    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }).join('');

  chartEl.innerHTML = `
    <svg viewBox="0 0 100 100" style="width:100%;height:100%;">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="${strokeWidth}" />
      ${paths}
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" font-family="Inter, sans-serif">${total}</text>
    </svg>
  `;

  legendEl.innerHTML = slices.map(s => `
    <div class="legend-row">
      <div class="legend-label">
        <span class="legend-dot" style="background:${s.color};"></span>
        <span>${escHtml(s.label)}</span>
      </div>
      <span class="legend-val">${s.value.toLocaleString()}</span>
    </div>
  `).join('');
}

// ─── CSV Export Functionality ────────────
function exportBoothMetricsCsv() {
  if (!analyticsData) {
    toast('No analytics data available yet', 'error');
    return;
  }

  const rows = getEnrichedBoothRows(analyticsData);
  rows.sort((a, b) => a.rank - b.rank);

  const headers = [
    'Rank', 'Booth ID', 'Booth Name', 'Organization', 'Category',
    'Impressions', 'Video Plays', 'Quiz Plays', 'Quiz Passes', 'Pass Rate %',
    'Reactions (Hearts)', 'Visitor Notes', 'Link Clicks', 'Engagement Score'
  ];

  const csvRows = [headers.join(',')];

  rows.forEach((r) => {
    const sanitizeCsv = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
    const row = [
      r.rank,
      r.id,
      sanitizeCsv(r.name),
      sanitizeCsv(r.org),
      sanitizeCsv(r.category),
      r.opens,
      r.introPlays,
      r.quizPlays,
      r.quizPasses,
      r.passRate.replace('%', ''),
      r.hearts,
      r.comments,
      r.linkClicks,
      r.engagementScore,
    ];
    csvRows.push(row.join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `yim-booth-analytics-matrix-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Booth metrics exported to CSV!', 'success');
}

function initAnalyticsListeners() {
  $('#analyticsRefreshBtn')?.addEventListener('click', () => {
    toast('Refreshing telemetry…', 'info');
    loadAnalytics();
  });

  $('#analyticsExportCsv')?.addEventListener('click', exportBoothMetricsCsv);

  $('#analyticsExportJson')?.addEventListener('click', () => {
    if (!analyticsData) {
      toast('No telemetry data available to export yet', 'error');
      return;
    }
    const json = JSON.stringify(analyticsData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yim-marketplace-analytics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Analytics report exported as JSON', 'success');
  });

  // Category filter select
  $('#analyticsCategoryFilter')?.addEventListener('change', (e) => {
    selectedCategoryFilter = e.target.value;
    if (analyticsData) renderAnalytics(analyticsData);
  });

  // Table search filter
  $('#analyticsBoothSearch')?.addEventListener('input', () => {
    if (analyticsData) renderAnalytics(analyticsData);
  });

  // Metric Switcher Pills
  $('#chartMetricPills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.metric-pill');
    if (!btn) return;
    selectedChartMetric = btn.dataset.metric;
    $$('.metric-pill').forEach(b => b.classList.toggle('active', b === btn));
    if (analyticsData) {
      const allRows = getEnrichedBoothRows(analyticsData);
      renderAnalyticsCharts(allRows);
    }
  });

  // Scope Switcher Pills (Top 10 / All 27 / Clusters)
  $('#chartScopePills')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    selectedChartScope = btn.dataset.scope;
    $$('#chartScopePills .pill').forEach(b => b.classList.toggle('active', b === btn));
    if (analyticsData) {
      const allRows = getEnrichedBoothRows(analyticsData);
      renderAnalyticsCharts(allRows);
    }
  });

  // Dossier Close Buttons
  $('#dossierClose')?.addEventListener('click', closeBoothDossier);
  $('#dossierCloseBtn')?.addEventListener('click', closeBoothDossier);

  const dossierModal = $('#boothDossierModal');
  if (dossierModal) {
    dossierModal.addEventListener('click', (e) => {
      if (e.target === dossierModal) closeBoothDossier();
    });
  }

  // Dossier Edit Booth Button
  $('#dossierEditBoothBtn')?.addEventListener('click', () => {
    if (!activeDossierBoothId) return;
    const b = booths.find(item => item.id === activeDossierBoothId);
    closeBoothDossier();
    if (b) openEditor(b);
  });
}

function formatTimeAgo(ts) {
  const diffSec = Math.floor((Date.now() - Number(ts)) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ─── Import / Export View ────────────────
$('#importJsonBtn').addEventListener('click', async () => {
  const status = $('#importStatus');
  status.textContent = 'Importing all 27 booths…';
  status.className = 'sync-status';
  try {
    const list27 = build27BoothsFallback();
    await api('/booths/import', { method: 'POST', body: { booths: list27 } });
    status.textContent = `✓ Successfully imported all ${list27.length} booths into database!`;
    status.className = 'sync-status success';
    toast('Database populated with all 27 booths!', 'success');
    loadBooths();
  } catch (err) {
    status.textContent = `✗ Import failed: ${err.message}`;
    status.className = 'sync-status error';
  }
});

$('#exportJsonBtn').addEventListener('click', async () => {
  const status = $('#exportStatus');
  status.textContent = 'Exporting…';
  status.className = 'sync-status';
  try {
    const json = JSON.stringify(booths, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'booths.json';
    a.click();
    URL.revokeObjectURL(a.href);
    status.textContent = `✓ Downloaded booths.json (${booths.length} booths) — drop into src/data/ to update build.`;
    status.className = 'sync-status success';
  } catch (err) {
    status.textContent = `✗ Export failed: ${err.message}`;
    status.className = 'sync-status error';
  }
});

// ─── Navigation & Views ──────────────────
function initNav() {
  $$('.nav-item[data-view]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(el.dataset.view);
      $('.sidebar').classList.remove('open');
    });
  });

  $('#mobileMenu').addEventListener('click', () => {
    $('.sidebar').classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    const sb = $('.sidebar');
    if (sb.classList.contains('open') && !sb.contains(e.target) && e.target !== $('#mobileMenu')) {
      sb.classList.remove('open');
    }
  });
}

function switchView(view) {
  activeView = view;
  $$('.nav-item[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
  $$('.view').forEach((el) => {
    el.hidden = el.id !== `${view}View`;
    if (!el.hidden) el.classList.add('active');
  });

  const titles = {
    booths: 'All Booths (27)',
    analytics: 'Marketplace Analytics',
    media: 'Media Library',
    sync: 'Import / Export'
  };
  viewTitle.textContent = titles[view] || 'Dashboard';
  searchBox.style.display = view === 'booths' ? '' : 'none';

  if (analyticsTimer) {
    clearInterval(analyticsTimer);
    analyticsTimer = null;
  }

  if (view === 'media') loadMedia();
  if (view === 'analytics') {
    loadAnalytics();
    analyticsTimer = setInterval(loadAnalytics, 10000);
  }
}

// ─── Toast Notifications ─────────────────
function toast(message, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${escHtml(message)}</span>`;
  toastBox.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// ─── Utilities ───────────────────────────
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

function escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeJsonStr(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try {
    const s = JSON.stringify(val, null, 2);
    return s === '[]' || s === '{}' ? '' : s;
  } catch {
    return '';
  }
}

function safeParse(str, fallback) {
  if (!str || !str.trim()) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ─── Bootstrap ───────────────────────────
initNav();
initSocialsListeners();
initAnalyticsListeners();
loadBooths();
