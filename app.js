/**
 * Main Application Logic for Pharma Production Tracker & Quarantine Inventory
 * Multi-User Real-Time Cloud Sync Engine with Distinct Weighing/Prep & Blistering Count Input Mode
 */

(function () {
  const LOCAL_STORAGE_KEY = 'pharma_production_batches_cloud_v3';
  const CLOUD_API_ENDPOINT = 'https://jsonblob.com/api/jsonBlob/019fbc28-a28d-7950-a713-30c7bf9b6628';

  // Application State
  let batches = [];
  let currentFormFilter = 'all';
  let searchQuery = '';
  let activeBatchId = null;
  let activeStageIndex = 0;
  let lastSyncHash = '';
  let isSavingToCloud = false;

  // DOM Elements
  const elStatActiveBatches = document.getElementById('stat-active-batches');
  const elStatQuarantineWeight = document.getElementById('stat-quarantine-weight');
  const elStatPassBlisters = document.getElementById('stat-pass-blisters');
  const elStatReworkBlisters = document.getElementById('stat-rework-blisters');
  const syncText = document.getElementById('sync-text');

  // Navigation Tabs
  const viewTabProduction = document.getElementById('view-tab-production');
  const viewTabQuarantine = document.getElementById('view-tab-quarantine');
  const viewProductionContainer = document.getElementById('view-production-container');
  const viewQuarantineContainer = document.getElementById('view-quarantine-container');

  // Views
  const elBatchesGrid = document.getElementById('batches-grid');
  const elBatchesCount = document.getElementById('batches-count');
  const elSearchInput = document.getElementById('search-input');
  const elFilterTabs = document.querySelectorAll('.filter-tab');
  const elQuarantineGrid = document.getElementById('quarantine-grid');

  // New Batch Modal
  const elBtnNewBatch = document.getElementById('btn-new-batch');
  const elModalNewBatch = document.getElementById('modal-new-batch');
  const elCloseNewBatchModal = document.getElementById('close-new-batch-modal');
  const elCancelNewBatchModal = document.getElementById('cancel-new-batch-modal');
  const elFormNewBatch = document.getElementById('form-new-batch');

  // Inputs
  const inputProductName = document.getElementById('input-product-name');
  const inputBatchNo = document.getElementById('input-batch-no');
  const inputPharmaForm = document.getElementById('input-pharma-form');
  const inputIsCoated = document.getElementById('input-is-coated');
  const inputBatchWeight = document.getElementById('input-batch-weight');
  const inputLotsCount = document.getElementById('input-lots-count');
  const inputPriorBatchNo = document.getElementById('input-prior-batch-no');
  const inputCarryOverKg = document.getElementById('input-carry-over-kg');
  const inputPreCoatingWeight = document.getElementById('input-pre-coating-weight');
  const inputPostCoatingWeight = document.getElementById('input-post-coating-weight');
  const groupPostCoatingWeight = document.getElementById('group-post-coating-weight');
  const labelPreCoatingWeight = document.getElementById('label-pre-coating-weight');
  const inputUnitsPerBlister = document.getElementById('input-units-per-blister');
  const inputStartDate = document.getElementById('input-start-date');
  const inputExpDate = document.getElementById('input-exp-date');

  // Preview elements
  const previewLotWeight = document.getElementById('preview-lot-weight');
  const previewTotalTablets = document.getElementById('preview-total-tablets');
  const previewTotalBlisters = document.getElementById('preview-total-blisters');

  // Batch Detail Modal
  const elModalBatchDetail = document.getElementById('modal-batch-detail');
  const elCloseBatchDetailModal = document.getElementById('close-batch-detail-modal');
  const elCloseDetailBtn = document.getElementById('close-detail-btn');
  const btnDeleteBatch = document.getElementById('btn-delete-batch');

  const detailProductName = document.getElementById('detail-product-name');
  const detailBatchNo = document.getElementById('detail-batch-no');
  const detailFormName = document.getElementById('detail-form-name');
  const detailTotalWeight = document.getElementById('detail-total-weight');
  const detailLotsInfo = document.getElementById('detail-lots-info');
  const detailPriorBatchInfo = document.getElementById('detail-prior-batch-info');
  const detailCoatingStatus = document.getElementById('detail-coating-status');
  const detailTabletWeights = document.getElementById('detail-tablet-weights');
  const detailUnitsPerBlister = document.getElementById('detail-units-per-blister');
  const detailTotalBlisters = document.getElementById('detail-total-blisters');
  const stagesTimeline = document.getElementById('stages-timeline');

  // Stage Logger Elements
  const logStageName = document.getElementById('log-stage-name');
  const logStageTotalKg = document.getElementById('log-stage-total-kg');
  const logStageTotalBlisters = document.getElementById('log-stage-total-blisters');
  const logStageAcceptedKg = document.getElementById('log-stage-accepted-kg');
  const logStageAcceptedBlisters = document.getElementById('log-stage-accepted-blisters');
  const logStageRejectedKg = document.getElementById('log-stage-rejected-kg');
  const logStageRejectedBlisters = document.getElementById('log-stage-rejected-blisters');

  const formUpdateStage = document.getElementById('form-update-stage');
  const labelLogAccepted = document.getElementById('label-log-accepted');
  const labelLogRejected = document.getElementById('label-log-rejected');
  const inputLogAcceptedKg = document.getElementById('input-log-accepted-kg');
  const inputLogRejectedKg = document.getElementById('input-log-rejected-kg');
  const logConversionHint = document.getElementById('log-conversion-hint');
  const stageHistoryList = document.getElementById('stage-history-list');

  const FORM_LABELS_MAP = {
    solid: 'أقراص صلبة',
    capsule: 'كبسول',
    suppository: 'تحاميل',
    cream: 'كريمات ومراهم'
  };

  function init() {
    loadBatchesLocal();
    setupEventListeners();
    renderApp();

    // Start Live Multi-User Cloud Sync Engine
    syncFromCloud();
    setInterval(syncFromCloud, 2500);
  }

  function loadBatchesLocal() {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        batches = JSON.parse(saved);
      } catch (e) {
        batches = [...window.DEFAULT_BATCHES];
      }
    } else {
      batches = [...window.DEFAULT_BATCHES];
    }
  }

  function saveBatches(triggerCloudUpload = true) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(batches));
    if (triggerCloudUpload) {
      pushToCloud();
    }
  }

  async function syncFromCloud() {
    if (isSavingToCloud) return;

    try {
      const response = await fetch(CLOUD_API_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        const cloudData = await response.json();
        if (Array.isArray(cloudData)) {
          const currentHash = JSON.stringify(cloudData);
          if (currentHash !== lastSyncHash) {
            lastSyncHash = currentHash;
            batches = cloudData;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(batches));
            renderApp();
            if (activeBatchId) {
              const activeBatch = batches.find(b => b.id === activeBatchId);
              if (activeBatch) {
                renderWorkflowTimeline(activeBatch);
                renderStageLogger(activeBatch);
                renderHistoryList(activeBatch);
              } else {
                closeBatchDetailModal();
              }
            }
          }
          if (syncText) syncText.textContent = 'مزامنة لحظية مباشرة بين الأجهزة (متصل 🟢)';
        }
      }
    } catch (e) {
      if (syncText) syncText.textContent = 'مزامنة محليّة';
    }
  }

  async function pushToCloud() {
    isSavingToCloud = true;
    lastSyncHash = JSON.stringify(batches);
    if (syncText) syncText.textContent = 'جاري رفع التعديلات للسحابة...';

    try {
      const response = await fetch(CLOUD_API_ENDPOINT, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(batches)
      });

      if (response.ok) {
        if (syncText) syncText.textContent = 'مزامنة لحظية مباشرة بين الأجهزة (متصل 🟢)';
      }
    } catch (e) {
      if (syncText) syncText.textContent = 'محفوظ محلياً';
    } finally {
      isSavingToCloud = false;
    }
  }

  function renderApp() {
    renderStats();
    renderBatchesGrid();
    renderQuarantineView();
    if (window.lucide) window.lucide.createIcons();
  }

  function renderStats() {
    let totalBatches = batches.length;
    let quarantineWeight = 0;
    let totalPassBlisters = 0;
    let totalReworkBlisters = 0;

    batches.forEach(b => {
      const currentStage = b.stages[b.currentStageIndex];
      const prevDone = b.currentStageIndex > 0 ? b.stages[b.currentStageIndex - 1].doneKg : b.totalWeightKg;
      const currentDone = currentStage ? currentStage.doneKg : 0;
      quarantineWeight += Math.max(0, prevDone - currentDone);

      let bAcceptedKg = 0;
      let bRejectedKg = 0;
      b.stages.forEach(st => {
        bAcceptedKg += (st.acceptedKg || 0);
        bRejectedKg += (st.rejectedKg || 0);
      });

      const mathAccepted = PharmaMath.calculateTotals(bAcceptedKg, b.isCoated, b.preCoatingMg, b.postCoatingMg, b.unitsPerBlister, b.lotsCount);
      const mathRejected = PharmaMath.calculateTotals(bRejectedKg, b.isCoated, b.preCoatingMg, b.postCoatingMg, b.unitsPerBlister, b.lotsCount);

      totalPassBlisters += mathAccepted.totalBlisters;
      totalReworkBlisters += mathRejected.totalBlisters;
    });

    elStatActiveBatches.textContent = totalBatches;
    elStatQuarantineWeight.textContent = PharmaMath.formatNumber(quarantineWeight);
    elStatPassBlisters.textContent = PharmaMath.formatNumber(totalPassBlisters);
    elStatReworkBlisters.textContent = PharmaMath.formatNumber(totalReworkBlisters);
  }

  function renderBatchesGrid() {
    let filtered = batches.filter(b => {
      const matchForm = currentFormFilter === 'all' || b.pharmaForm === currentFormFilter;
      const matchSearch = b.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          b.batchNo.toLowerCase().includes(searchQuery.toLowerCase());
      return matchForm && matchSearch;
    });

    elBatchesCount.textContent = filtered.length;
    elBatchesGrid.innerHTML = '';

    if (filtered.length === 0) {
      elBatchesGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">لا توجد تشغيلات تطابق معايير البحث الحالية.</p>
          <small>قم بإضافة تشغيلة جديدة أو تغيير فلترة البحث.</small>
        </div>
      `;
      return;
    }

    filtered.forEach(batch => {
      const currentStage = batch.stages[batch.currentStageIndex] || batch.stages[0];
      const doneKg = currentStage ? currentStage.doneKg : 0;
      const progressPercent = Math.min(100, Math.round((doneKg / batch.totalWeightKg) * 100));

      const mathTotal = PharmaMath.calculateTotals(
        batch.totalWeightKg,
        batch.isCoated,
        batch.preCoatingMg,
        batch.postCoatingMg,
        batch.unitsPerBlister,
        batch.lotsCount
      );

      const mathDone = PharmaMath.kgToBlistersAndLots(
        doneKg,
        batch.isCoated,
        batch.preCoatingMg,
        batch.postCoatingMg,
        batch.unitsPerBlister,
        batch.totalWeightKg,
        batch.lotsCount
      );

      const lotWeightKg = (batch.totalWeightKg / (batch.lotsCount || 1)).toFixed(1);

      const card = document.createElement('div');
      card.className = 'batch-card';
      card.onclick = (e) => {
        if (e.target.closest('.btn-icon-delete')) return;
        openBatchDetail(batch.id);
      };

      card.innerHTML = `
        <div class="batch-card-header">
          <div class="batch-title">
            <h4>${batch.productName}</h4>
            <span class="batch-code"># ${batch.batchNo} (${batch.lotsCount || 1} لوت / ${lotWeightKg} كغ للوت)</span>
          </div>
          <div class="header-right-actions">
            <span class="pharma-badge ${batch.pharmaForm}">${batch.pharmaFormLabel || FORM_LABELS_MAP[batch.pharmaForm]}</span>
            <button class="btn-icon-delete" title="إلغاء وحذف الباتش" onclick="event.stopPropagation(); deleteBatch('${batch.id}');">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>

        ${batch.priorBatchNo ? `
          <div class="batch-card-weights-pill" style="background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.3); color: var(--amber);">
            <span>منقول من باتش سابق: <strong>#${batch.priorBatchNo} (${batch.carryOverKg} كغ)</strong></span>
          </div>
        ` : ''}

        <div class="batch-card-weights-pill">
          <span>التلبيس: <strong>${batch.isCoated ? 'ملبس بالفيلم' : 'غير ملبس'}</strong></span>
          <span>وزن الوحدة: <strong>${batch.isCoated ? batch.postCoatingMg + ' ملغ' : batch.preCoatingMg + ' ملغ'}</strong></span>
        </div>

        <div class="stage-indicator-box">
          <div class="stage-title-line">
            <span>المرحلة الحالية: <span class="stage-name">${currentStage ? currentStage.name : '-'}</span></span>
            <strong>${progressPercent}%</strong>
          </div>

          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
          </div>

          <div class="stage-weight-details">
            <span>المنجز: ${doneKg} كغ (${mathDone.equivalentLots} لوت | ${PharmaMath.formatNumber(mathDone.totalBlisters)} ظرف)</span>
            <span>إجمالي الباتش: ${batch.totalWeightKg} كغ</span>
          </div>
        </div>

        <div class="batch-footer-meta">
          <div>إجمالي البليسترات: <strong>${PharmaMath.formatNumber(mathTotal.totalBlisters)} ظرف</strong></div>
          <div>الانتهاء: <strong>${batch.expDate}</strong></div>
        </div>
      `;

      elBatchesGrid.appendChild(card);
    });
  }

  function renderQuarantineView() {
    elQuarantineGrid.innerHTML = '';

    if (batches.length === 0) {
      elQuarantineGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">لا توجد أصناف بالحجر حالياً.</p>
        </div>
      `;
      return;
    }

    batches.forEach(batch => {
      const currentStage = batch.stages[batch.currentStageIndex];
      const prevDoneKg = batch.currentStageIndex > 0 ? batch.stages[batch.currentStageIndex - 1].doneKg : batch.totalWeightKg;
      const currentDoneKg = currentStage ? currentStage.doneKg : 0;
      const remKgInQuarantine = Math.max(0, prevDoneKg - currentDoneKg);

      let materialState = 'مساحيق وبودرة بالحجر';
      if (batch.pharmaForm === 'solid') {
        if (currentStage.id === 'weighing') {
          materialState = 'مواد خام جاري وزنها ميدانياً';
        } else if (currentStage.id === 'preparation') {
          materialState = 'مساحيق وبودرة ممزوجة (جاهزة للضغط)';
        } else if (currentStage.id === 'compression' && batch.isCoated) {
          materialState = 'مضغوطات نواتية (بحاجة تلبيس بالفيلم)';
        } else if (currentStage.id === 'compression' && !batch.isCoated) {
          materialState = 'مضغوطات غير ملبسة (بحاجة بليستر/تغليف)';
        } else if (currentStage.id === 'coating') {
          materialState = 'مضغوطات ملبسة بالفيلم (بحاجة بليستر/تغليف)';
        } else if (currentStage.id === 'blistering') {
          materialState = 'بليسترات ومنتج شبه مكتمل بالتغليف';
        }
      } else if (batch.pharmaForm === 'capsule') {
        if (currentStage.id === 'weighing') materialState = 'مواد خام جاري وزنها للمصادقة';
        else if (currentStage.id === 'preparation') materialState = 'خليط كبسول جاف بالحجر (جاهز للتعبئة)';
        else if (currentStage.id === 'filling') materialState = 'كبسولات معبأة (بحاجة بليستر وتغليف)';
        else if (currentStage.id === 'blistering') materialState = 'بليسترات كبسول جاهزة للتعبئة النهائية';
      } else if (batch.pharmaForm === 'suppository') {
        materialState = 'تحاميل مسكوبة بالحجر (بحاجة تغليف وترميز)';
      } else if (batch.pharmaForm === 'cream') {
        materialState = 'مستحلب كريم بالحجر (بحاجة تعبئة أنابيب)';
      }

      let accKgTotal = 0;
      let rejKgTotal = 0;
      batch.stages.forEach(s => {
        accKgTotal += (s.acceptedKg || 0);
        rejKgTotal += (s.rejectedKg || 0);
      });

      const qMathRem = PharmaMath.kgToBlistersAndLots(remKgInQuarantine, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
      const qMathAcc = PharmaMath.kgToBlistersAndLots(accKgTotal, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
      const qMathRej = PharmaMath.kgToBlistersAndLots(rejKgTotal, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

      const card = document.createElement('div');
      card.className = 'quarantine-item-card';

      card.innerHTML = `
        <div class="q-item-header">
          <div class="q-item-title">
            <h4>${batch.productName}</h4>
            <span class="batch-code"># ${batch.batchNo} ${batch.priorBatchNo ? `(منقول من #${batch.priorBatchNo})` : ''}</span>
          </div>
          <span class="pharma-badge ${batch.pharmaForm}">${batch.pharmaFormLabel}</span>
        </div>

        <div class="q-material-state-pill">
          <i data-lucide="box"></i> ${materialState}
        </div>

        <div class="q-item-body">
          <div class="q-info-field">
            <span>الوزن المتبقي بالحجر:</span>
            <strong>${remKgInQuarantine} كغ (${qMathRem.equivalentLots} لوت)</strong>
          </div>

          <div class="q-info-field">
            <span>المرحلة القادمة:</span>
            <strong>${currentStage ? currentStage.name : '-'}</strong>
          </div>

          <div class="q-info-field" style="border-right: 3px solid var(--emerald); padding-right: 0.5rem;">
            <span style="color: var(--emerald);">الكمية المقبولة المطابقة:</span>
            <strong style="color: var(--emerald);">${accKgTotal} كغ (${PharmaMath.formatNumber(qMathAcc.totalBlisters)} ظرف)</strong>
          </div>

          <div class="q-info-field" style="border-right: 3px solid var(--rose); padding-right: 0.5rem;">
            <span style="color: var(--rose);">الكمية المرفوضة/إعادة تشغيل:</span>
            <strong style="color: var(--rose);">${rejKgTotal} كغ (${PharmaMath.formatNumber(qMathRej.totalBlisters)} ظرف)</strong>
          </div>
        </div>

        <div class="q-item-footer">
          <button class="btn btn-primary btn-sm" onclick="openBatchDetail('${batch.id}')">
            <i data-lucide="edit-3"></i> تحديث الإنجاز وتسجيل الظروف المقبولة/المرفوضة
          </button>
        </div>
      `;

      elQuarantineGrid.appendChild(card);
    });
  }

  function setupEventListeners() {
    viewTabProduction.addEventListener('click', () => {
      viewTabProduction.classList.add('active');
      viewTabQuarantine.classList.remove('active');
      viewProductionContainer.classList.remove('hidden');
      viewQuarantineContainer.classList.add('hidden');
    });

    viewTabQuarantine.addEventListener('click', () => {
      viewTabQuarantine.classList.add('active');
      viewTabProduction.classList.remove('active');
      viewQuarantineContainer.classList.remove('hidden');
      viewProductionContainer.classList.add('hidden');
      renderQuarantineView();
    });

    elFilterTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        elFilterTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentFormFilter = e.target.getAttribute('data-form');
        renderBatchesGrid();
      });
    });

    elSearchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderBatchesGrid();
    });

    elBtnNewBatch.addEventListener('click', openNewBatchModal);
    elCloseNewBatchModal.addEventListener('click', closeNewBatchModal);
    elCancelNewBatchModal.addEventListener('click', closeNewBatchModal);

    inputIsCoated.addEventListener('change', toggleCoatingFields);
    inputPharmaForm.addEventListener('change', toggleCoatingFields);

    [inputBatchWeight, inputLotsCount, inputPreCoatingWeight, inputPostCoatingWeight, inputUnitsPerBlister].forEach(el => {
      el.addEventListener('input', updateNewBatchMathPreview);
    });

    elFormNewBatch.addEventListener('submit', handleNewBatchSubmit);

    elCloseBatchDetailModal.addEventListener('click', closeBatchDetailModal);
    elCloseDetailBtn.addEventListener('click', closeBatchDetailModal);
    
    btnDeleteBatch.addEventListener('click', () => {
      if (activeBatchId) deleteBatch(activeBatchId);
    });

    formUpdateStage.addEventListener('submit', handleUpdateStageSubmit);
  }

  function toggleCoatingFields() {
    const isCoated = inputIsCoated.value === 'true';
    const isSolid = inputPharmaForm.value === 'solid';

    if (isSolid && isCoated) {
      groupPostCoatingWeight.classList.remove('hidden');
      inputPostCoatingWeight.required = true;
      labelPreCoatingWeight.textContent = 'وزن المضغوطة قبل التلبيس (ملغ mg) *';
    } else {
      groupPostCoatingWeight.classList.add('hidden');
      inputPostCoatingWeight.required = false;
      labelPreCoatingWeight.textContent = 'وزن المضغوطة/الوحدة (ملغ mg) *';
    }

    updateNewBatchMathPreview();
  }

  function updateNewBatchMathPreview() {
    const wKg = parseFloat(inputBatchWeight.value) || 0;
    const lCount = parseInt(inputLotsCount.value, 10) || 1;
    const isCoated = inputIsCoated.value === 'true';
    const preMg = parseFloat(inputPreCoatingWeight.value) || 0;
    const postMg = parseFloat(inputPostCoatingWeight.value) || 0;
    const uPerB = parseInt(inputUnitsPerBlister.value, 10) || 1;

    const res = PharmaMath.calculateTotals(wKg, isCoated, preMg, postMg, uPerB, lCount);
    previewLotWeight.textContent = `${res.lotWeightKg.toFixed(1)} كغ/لوت`;
    previewTotalTablets.textContent = `${PharmaMath.formatNumber(res.totalTablets)} مضغوطة`;
    previewTotalBlisters.textContent = `${PharmaMath.formatNumber(res.totalBlisters)} ظرف/بليستر`;
  }

  function openNewBatchModal() {
    elFormNewBatch.reset();
    inputIsCoated.value = 'false';
    inputLotsCount.value = '1';
    toggleCoatingFields();

    const today = new Date().toISOString().split('T')[0];
    const threeYearsLater = new Date();
    threeYearsLater.setFullYear(threeYearsLater.getFullYear() + 3);
    inputStartDate.value = today;
    inputExpDate.value = threeYearsLater.toISOString().split('T')[0];

    elModalNewBatch.classList.remove('hidden');
  }

  function closeNewBatchModal() {
    elModalNewBatch.classList.add('hidden');
  }

  function handleNewBatchSubmit(e) {
    e.preventDefault();

    const formType = inputPharmaForm.value;
    const isCoated = inputIsCoated.value === 'true';
    
    // Distinct Workflow Stages: Weighing is separated from Preparation
    let stagesConfig = [];
    if (formType === 'solid') {
      stagesConfig = [
        { id: 'weighing', name: 'الوزن الميداني للمواد الخام' },
        { id: 'preparation', name: 'التحضير والمزج المبدئي' },
        { id: 'compression', name: 'الضغط (Compression)' }
      ];
      if (isCoated) {
        stagesConfig.push({ id: 'coating', name: 'التلبيس بالفيلم (Film Coating)' });
      }
      stagesConfig.push({ id: 'blistering', name: 'البليستر والتغليف النهائي' });
    } else if (formType === 'capsule') {
      stagesConfig = [
        { id: 'weighing', name: 'الوزن الميداني للمواصفات' },
        { id: 'preparation', name: 'التحضير والمزج الجاف' },
        { id: 'filling', name: 'تعبئة الكبسول' },
        { id: 'blistering', name: 'البليستر والتغليف النهائي' }
      ];
    } else if (formType === 'suppository') {
      stagesConfig = [
        { id: 'weighing', name: 'الوزن الميداني للمواد' },
        { id: 'preparation', name: 'التحضير والتذويب' },
        { id: 'filling', name: 'تعبئة وسكب التحاميل' }
      ];
    } else {
      stagesConfig = [
        { id: 'weighing', name: 'الوزن الميداني للمواد' },
        { id: 'preparation', name: 'التحضير والمزج' },
        { id: 'filling', name: 'تعبئة الأنابيب والظروف' }
      ];
    }

    const initialStages = stagesConfig.map((s, idx) => ({
      id: s.id,
      name: s.name,
      status: idx === 0 ? 'in_progress' : 'pending',
      doneKg: 0,
      acceptedKg: 0,
      rejectedKg: 0
    }));

    const preMg = parseFloat(inputPreCoatingWeight.value);
    const postMg = isCoated ? parseFloat(inputPostCoatingWeight.value) : preMg;
    const lCount = parseInt(inputLotsCount.value, 10) || 1;
    const priorBatch = inputPriorBatchNo.value.trim();
    const carryKg = parseFloat(inputCarryOverKg.value) || 0;

    const newBatch = {
      id: 'batch-' + Date.now(),
      productName: inputProductName.value.trim(),
      batchNo: inputBatchNo.value.trim(),
      pharmaForm: formType,
      pharmaFormLabel: FORM_LABELS_MAP[formType] + (isCoated ? ' (ملبس)' : ''),
      isCoated: isCoated,
      totalWeightKg: parseFloat(inputBatchWeight.value),
      lotsCount: lCount,
      priorBatchNo: priorBatch,
      carryOverKg: carryKg,
      preCoatingMg: preMg,
      postCoatingMg: postMg,
      unitsPerBlister: parseInt(inputUnitsPerBlister.value, 10),
      startDate: inputStartDate.value,
      expDate: inputExpDate.value,
      stages: initialStages,
      currentStageIndex: 0,
      logs: [
        {
          time: new Date().toLocaleString('ar-EG'),
          text: `إنشاء الباتش (${inputBatchWeight.value} كغ / ${lCount} لوتات، ${isCoated ? 'ملبس بالفيلم' : 'غير ملبس'})${priorBatch ? ` - منقول من باتش سابق #${priorBatch} (${carryKg} كغ).` : '.'}`
        }
      ]
    };

    batches.unshift(newBatch);
    saveBatches();
    closeNewBatchModal();
    renderApp();
  }

  function openBatchDetail(batchId) {
    activeBatchId = batchId;
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;

    activeStageIndex = batch.currentStageIndex;

    detailProductName.textContent = batch.productName;
    detailBatchNo.textContent = batch.batchNo;
    detailFormName.textContent = batch.pharmaFormLabel || FORM_LABELS_MAP[batch.pharmaForm];
    detailTotalWeight.textContent = `${batch.totalWeightKg} كغ`;

    const lotWeight = (batch.totalWeightKg / (batch.lotsCount || 1)).toFixed(1);
    detailLotsInfo.textContent = `${batch.lotsCount || 1} لوت (${lotWeight} كغ/لوت)`;

    detailPriorBatchInfo.textContent = batch.priorBatchNo ? `#${batch.priorBatchNo} (${batch.carryOverKg} كغ)` : 'لا يوجد (باتش حديث)';

    detailCoatingStatus.textContent = batch.isCoated ? 'ملبس بالفيلم' : 'غير ملبس';
    detailTabletWeights.textContent = batch.isCoated ? 
      `قبل: ${batch.preCoatingMg} ملغ | بعد: ${batch.postCoatingMg} ملغ` : 
      `${batch.preCoatingMg || batch.unitWeightMg || 0} ملغ`;

    detailUnitsPerBlister.textContent = `${batch.unitsPerBlister} وحدة`;

    const mathTotal = PharmaMath.calculateTotals(
      batch.totalWeightKg,
      batch.isCoated,
      batch.preCoatingMg,
      batch.postCoatingMg,
      batch.unitsPerBlister,
      batch.lotsCount
    );

    detailTotalBlisters.textContent = `${PharmaMath.formatNumber(mathTotal.totalBlisters)} ظرف`;

    renderWorkflowTimeline(batch);
    renderStageLogger(batch);
    renderHistoryList(batch);

    elModalBatchDetail.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function closeBatchDetailModal() {
    elModalBatchDetail.classList.add('hidden');
    activeBatchId = null;
  }

  window.deleteBatch = function(batchId) {
    const batch = batches.find(b => b.id === batchId);
    const batchName = batch ? batch.productName : '';
    
    if (confirm(`هل أنت تأكد من إلغاء وحذف تشغيلة المنتج [${batchName}] نهائياً من خط الإنتاج والحجر؟`)) {
      batches = batches.filter(b => b.id !== batchId);
      saveBatches();
      if (activeBatchId === batchId) {
        closeBatchDetailModal();
      }
      renderApp();
    }
  };

  function renderWorkflowTimeline(batch) {
    stagesTimeline.innerHTML = '';

    batch.stages.forEach((stage, idx) => {
      const isSelected = idx === activeStageIndex;
      const isCompleted = stage.doneKg >= batch.totalWeightKg;

      const card = document.createElement('div');
      card.className = `stage-step-card ${isSelected ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
      card.onclick = () => selectStage(idx);

      card.innerHTML = `
        <div class="step-number">${idx + 1}</div>
        <span class="step-name">${stage.name}</span>
        <span class="step-status">${stage.doneKg} / ${batch.totalWeightKg} كغ</span>
      `;

      stagesTimeline.appendChild(card);
    });
  }

  function selectStage(index) {
    activeStageIndex = index;
    const batch = batches.find(b => b.id === activeBatchId);
    if (batch) {
      renderWorkflowTimeline(batch);
      renderStageLogger(batch);
    }
  }

  /**
   * Render Stage Logger with Dynamic Input Mode:
   * In Blistering stage specifically, inputs are direct Blisters Count!
   * In all other stages, inputs are Weight in Kg.
   */
  function renderStageLogger(batch) {
    const stage = batch.stages[activeStageIndex];
    if (!stage) return;

    logStageName.textContent = stage.name;

    const isBlisterStage = stage.id === 'blistering';

    if (isBlisterStage) {
      labelLogAccepted.textContent = 'عدد الظروف/البليسترات المقبولة المضافة (ظرف PASS) *';
      labelLogRejected.textContent = 'عدد الظروف المرفوضة/إعادة تشغيل (ظرف REJECTED) *';
      inputLogAcceptedKg.placeholder = 'مثال: 500 ظرف مقبول';
      inputLogRejectedKg.placeholder = 'مثال: 10 ظروف مرفوضة';
      logConversionHint.textContent = 'مرحلة البليستر: يتم إدخال عدد الظروف مباشرة وتقوم المنظومة بتحويلها تلقائياً إلى الوزن المقابل بالكيلوغرام وتحديث أجهزة المعمل.';
    } else {
      labelLogAccepted.textContent = 'الكمية المقبولة/المطابقة المضافة (كغ) *';
      labelLogRejected.textContent = 'الكمية المرفوضة/إعادة تشغيل (كغ) *';
      inputLogAcceptedKg.placeholder = 'مثال: 18 كغ مقبول';
      inputLogRejectedKg.placeholder = 'مثال: 2 كغ مرفوض';
      logConversionHint.textContent = 'يتم إدخال الوزن بالكيلوغرام وتقوم المنظومة بتحويلها تلقائياً إلى أعداد ظروف ولوتات وتحديث كافة أجهزة المعمل.';
    }

    const prevDoneKg = activeStageIndex > 0 ? batch.stages[activeStageIndex - 1].doneKg : batch.totalWeightKg;
    const currentDoneKg = stage.doneKg;
    const remKgInQuarantine = Math.max(0, prevDoneKg - currentDoneKg);

    const stageAccKg = stage.acceptedKg || 0;
    const stageRejKg = stage.rejectedKg || 0;

    const totalMath = PharmaMath.kgToBlistersAndLots(batch.totalWeightKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
    const accMath = PharmaMath.kgToBlistersAndLots(stageAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
    const rejMath = PharmaMath.kgToBlistersAndLots(stageRejKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

    logStageTotalKg.textContent = `${batch.totalWeightKg} كغ`;
    logStageTotalBlisters.textContent = `(${totalMath.equivalentLots} لوت | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ظرف)`;

    logStageAcceptedKg.textContent = `${stageAccKg} كغ`;
    logStageAcceptedBlisters.textContent = `(${PharmaMath.formatNumber(accMath.totalBlisters)} ظرف مقبول)`;

    logStageRejectedKg.textContent = `${stageRejKg} كغ`;
    logStageRejectedBlisters.textContent = `(${PharmaMath.formatNumber(rejMath.totalBlisters)} ظرف مرفوض/إعادة تشغيل)`;

    inputLogAcceptedKg.value = '';
    inputLogRejectedKg.value = '0';
  }

  function handleUpdateStageSubmit(e) {
    e.preventDefault();
    const batch = batches.find(b => b.id === activeBatchId);
    if (!batch) return;

    const stage = batch.stages[activeStageIndex];
    const isBlisterStage = stage.id === 'blistering';

    let addAcceptedKg = 0;
    let addRejectedKg = 0;
    let addAcceptedBlisters = 0;
    let addRejectedBlisters = 0;

    if (isBlisterStage) {
      // In Blistering stage: inputs are direct Blisters Count!
      addAcceptedBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
      addRejectedBlisters = parseFloat(inputLogRejectedKg.value) || 0;

      addAcceptedKg = PharmaMath.blistersToKg(addAcceptedBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
      addRejectedKg = PharmaMath.blistersToKg(addRejectedBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
    } else {
      // In all other stages: inputs are Weight in Kg
      addAcceptedKg = parseFloat(inputLogAcceptedKg.value) || 0;
      addRejectedKg = parseFloat(inputLogRejectedKg.value) || 0;

      const accMath = PharmaMath.kgToBlistersAndLots(addAcceptedKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
      const rejMath = PharmaMath.kgToBlistersAndLots(addRejectedKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

      addAcceptedBlisters = accMath.totalBlisters;
      addRejectedBlisters = rejMath.totalBlisters;
    }

    const addTotalKg = addAcceptedKg + addRejectedKg;

    if (addTotalKg <= 0 && addAcceptedBlisters <= 0 && addRejectedBlisters <= 0) {
      alert('يرجى إدخال كمية مقبولة أو مرفوضة أكبر من صفر.');
      return;
    }

    const prevDoneKg = activeStageIndex > 0 ? batch.stages[activeStageIndex - 1].doneKg : batch.totalWeightKg;
    const maxAddableKg = Math.max(0, prevDoneKg - stage.doneKg);

    if (addTotalKg > (maxAddableKg + 0.01)) { // Allow minor rounding float difference
      alert(`الكمية المتاحة كحد أقصى في الحجر/المرحلة السابقة هي ${maxAddableKg.toFixed(2)} كغ.`);
      return;
    }

    stage.doneKg += addTotalKg;
    stage.acceptedKg = (stage.acceptedKg || 0) + addAcceptedKg;
    stage.rejectedKg = (stage.rejectedKg || 0) + addRejectedKg;

    if (stage.doneKg >= batch.totalWeightKg) {
      stage.status = 'completed';
    } else {
      stage.status = 'in_progress';
    }

    if (stage.doneKg > 0 && batch.currentStageIndex < activeStageIndex) {
      batch.currentStageIndex = activeStageIndex;
    }

    batch.logs.unshift({
      time: new Date().toLocaleString('ar-EG'),
      text: isBlisterStage ?
        `تسجيل إنجاز بالبليستر: (${addAcceptedBlisters} ظرف مقبول = ${addAcceptedKg} كغ) و (${addRejectedBlisters} ظرف مرفوض = ${addRejectedKg} كغ).` :
        `تسجيل إنجاز بمرحلة [${stage.name}]: (${addAcceptedKg} كغ مقبول = ${PharmaMath.formatNumber(addAcceptedBlisters)} ظرف) و (${addRejectedKg} كغ مرفوض = ${PharmaMath.formatNumber(addRejectedBlisters)} ظرف).`
    });

    saveBatches();
    renderWorkflowTimeline(batch);
    renderStageLogger(batch);
    renderHistoryList(batch);
    renderApp();
  }

  function renderHistoryList(batch) {
    stageHistoryList.innerHTML = '';
    if (!batch.logs || batch.logs.length === 0) {
      stageHistoryList.innerHTML = '<p class="text-dim">لا توجد سجلات بعد.</p>';
      return;
    }

    batch.logs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <span>${log.text}</span>
        <span class="time">${log.time}</span>
      `;
      stageHistoryList.appendChild(item);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
