/**
 * Main Application Logic for Pharma Production Tracker & Quarantine Inventory
 * Version 11 - Equipped with Throttled Conflict-Free Sync Engine & API Cache-Busting
 */

(function () {
  const MASTER_STORAGE_KEY = 'pharma_production_batches_master_v2';
  
  // Previous keys for automatic user data recovery
  const PREVIOUS_STORAGE_KEYS = [
    'pharma_production_batches_master_v1',
    'pharma_production_batches_cloud_v8',
    'pharma_production_batches_cloud_v7',
    'pharma_production_batches_cloud_v6',
    'pharma_production_batches_cloud_v5',
    'pharma_production_batches_cloud_v4',
    'pharma_production_batches_cloud_v3',
    'pharma_production_batches_cloud_v2',
    'pharma_production_batches_cloud_v1',
    'pharma_production_batches_v1'
  ];

  const DEFAULT_CLOUD_API = 'https://jsonblob.com/api/jsonBlob/019fc699-099e-70ee-9ccd-d6048b84646a';
  let CLOUD_API_BASE = localStorage.getItem('pharma_production_server_url') || DEFAULT_CLOUD_API;

  // Helper to generate cache-busting cloud URL
  function getCloudUrl() {
    // If it's a Firebase URL, we append ?cb=Date.now(), else we check if it already has search params
    const separator = CLOUD_API_BASE.includes('?') ? '&' : '?';
    return `${CLOUD_API_BASE}${separator}cb=${Date.now()}`;
  }

  // Application State
  let batches = [];
  let currentFormFilter = 'all';
  let searchQuery = '';
  let activeBatchId = null;
  let activeStageIndex = 0;
  let lastSyncHash = '';
  let isSavingToCloud = false;
  let isEditCorrectionMode = false;
  let currentViewMode = localStorage.getItem('pharma_view_mode') || 'grid';
  
  // Rate limit protection
  let lastAutoPushTime = 0;
  const AUTO_PUSH_COOLDOWN = 30000; // 30 seconds cooldown for automatic background uploads
  let isCloudReadable = true;

  // DOM Elements
  const elStatActiveBatches = document.getElementById('stat-active-batches');
  const elStatQuarantineWeight = document.getElementById('stat-quarantine-weight');
  const elStatPassBlisters = document.getElementById('stat-pass-blisters');
  const elStatReworkBlisters = document.getElementById('stat-rework-blisters');
  const syncText = document.getElementById('sync-text');

  // Backup & Restore Controls
  const btnExportBackup = document.getElementById('btn-export-backup');
  const btnImportBackup = document.getElementById('btn-import-backup');
  const inputBackupFile = document.getElementById('input-backup-file');
  const btnResetCache = document.getElementById('btn-reset-cache');

  // Server Settings Elements
  const btnServerSettings = document.getElementById('btn-server-settings');
  const modalServerSettings = document.getElementById('modal-server-settings');
  const closeServerSettingsModal = document.getElementById('close-server-settings-modal');
  const cancelServerSettingsModal = document.getElementById('cancel-server-settings-modal');
  const inputServerUrl = document.getElementById('input-server-url');
  const btnSaveServerUrl = document.getElementById('btn-save-server-url');
  const cloudSyncIndicator = document.getElementById('cloud-sync-indicator');

  // Auth Screen Elements
  const loginLockScreen = document.getElementById('login-lock-screen');
  const formLoginAuth = document.getElementById('form-login-auth');
  const inputLoginPasscode = document.getElementById('input-login-passcode');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const btnLogout = document.getElementById('btn-logout');

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
  const elStageCarryOverProgressContainer = document.getElementById('stage-carry-over-progress-container');

  // Correction Mode Controls
  const btnToggleEditMode = document.getElementById('btn-toggle-edit-mode');
  const editModeBtnText = document.getElementById('edit-mode-btn-text');
  const btnSubmitStageLog = document.getElementById('btn-submit-stage-log');
  const submitStageBtnText = document.getElementById('submit-stage-btn-text');
  const btnCancelEditMode = document.getElementById('btn-cancel-edit-mode');

  // QC DOM references
  const elFormAddQCRun = document.getElementById('form-add-qc-run');
  const elQCDynamicTestsContainer = document.getElementById('qc-dynamic-tests-container');
  const elInputQCSampleNo = document.getElementById('input-qc-sample-no');
  const elQCLotsCheckboxesContainer = document.getElementById('qc-lots-checkboxes-container');
  const elQCLotsClearanceTableContainer = document.getElementById('qc-lots-clearance-table-container');
  const elQCBatchStatusBadge = document.getElementById('qc-batch-status-badge');
  const elQCRunsLoggedList = document.getElementById('qc-runs-logged-list');
  const elQCGlobalConfigContainer = document.getElementById('qc-global-config-container');
  const elCoatingConfigContainer = document.getElementById('coating-config-container');
  const elCarryOverConfigContainer = document.getElementById('carry-over-config-container');

  const FORM_LABELS_MAP = {
    solid: 'أقراص صلبة',
    capsule: 'كبسول',
    suppository: 'تحاميل',
    cream: 'كريمات ومراهم'
  };

  const FORMS_TERMINOLOGY = {
    solid: {
      unitName: 'مضغوطة',
      unitPlural: 'مضغوطات',
      packName: 'ظرف',
      packPlural: 'بليسترات',
      packLabel: 'إجمالي البليسترات الكلية',
      packLabelShort: 'إجمالي البليسترات',
      weightLabel: 'وزن المضغوطة',
      weightLabelPre: 'وزن المضغوطة قبل التلبيس',
      unitsPerPackLabel: 'عدد المضغوطات بالظرف (البليستر) *'
    },
    capsule: {
      unitName: 'كبسولة',
      unitPlural: 'كبسولات',
      packName: 'ظرف',
      packPlural: 'بليسترات',
      packLabel: 'إجمالي البليسترات الكلية',
      packLabelShort: 'إجمالي البليسترات',
      weightLabel: 'وزن التعبئة للكبسولة الواحدة',
      weightLabelPre: 'وزن التعبئة للكبسولة الواحدة',
      unitsPerPackLabel: 'عدد الكبسولات بالظرف (البليستر) *'
    },
    suppository: {
      unitName: 'تحميلة',
      unitPlural: 'تحاميل',
      packName: 'ظرف',
      packPlural: 'بليسترات',
      packLabel: 'إجمالي البليسترات الكلية',
      packLabelShort: 'إجمالي البليسترات',
      weightLabel: 'وزن التحميلة',
      weightLabelPre: 'وزن التحميلة',
      unitsPerPackLabel: 'عدد التحاميل بالظرف (البليستر) *'
    },
    cream: {
      unitName: 'تيوب',
      unitPlural: 'تيوبات',
      packName: 'تيوب',
      packPlural: 'تيوبات',
      packLabel: 'إجمالي التيوبات الكلية',
      packLabelShort: 'إجمالي التيوبات',
      weightLabel: 'وزن التيوب',
      weightLabelPre: 'وزن التيوب',
      unitsPerPackLabel: 'عدد الوحدات بالتيوب *'
    }
  };

  function getTerminology(form) {
    return FORMS_TERMINOLOGY[form] || FORMS_TERMINOLOGY.solid;
  }

  function getUnitLabel(form) {
    return getTerminology(form).packName;
  }

  let correctPasscode = 'IDM@2026';

  async function checkAuthentication() {
    if (loginLockScreen) loginLockScreen.classList.add('hidden');
  }

  async function init() {
    await checkAuthentication();
    loadBatchesLocal();
    setupEventListeners();
    renderApp();

    // Start Throttled Sync Engine (Sync every 8 seconds to prevent rate limits)
    syncFromCloud();
    setInterval(syncFromCloud, 8000);

    window.addEventListener('focus', () => {
      syncFromCloud();
    });
  }

  function sanitizeBatchesCoatingName(batchesList) {
    if (!Array.isArray(batchesList)) return;
    batchesList.forEach(batch => {
      if (batch) {
        if (Array.isArray(batch.stages)) {
          batch.stages.forEach(stage => {
            if (stage && stage.name) {
              stage.name = stage.name.replace('التلبيس بالفيلم (Film Coating)', 'التلبيس (Coating)');
              stage.name = stage.name.replace('التلبيس بالفيلم', 'التلبيس');
            }
          });
        }
        if (batch.pharmaFormLabel) {
          batch.pharmaFormLabel = batch.pharmaFormLabel.replace('التلبيس بالفيلم', 'التلبيس');
        }
      }
    });
  }

  function loadBatchesLocal() {
    // 1. Try master key
    const masterSaved = localStorage.getItem(MASTER_STORAGE_KEY);
    if (masterSaved) {
      try {
        const parsed = JSON.parse(masterSaved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          batches = parsed;
          sanitizeBatchesCoatingName(batches);
          return;
        }
      } catch (e) {}
    }

    // 2. Scan and aggregate all previous version keys to prevent data loss
    const recoveredMap = new Map();
    PREVIOUS_STORAGE_KEYS.forEach(key => {
      const prevData = localStorage.getItem(key);
      if (prevData) {
        try {
          const parsedArr = JSON.parse(prevData);
          if (Array.isArray(parsedArr)) {
            parsedArr.forEach(b => {
              if (b && b.id) {
                if (!recoveredMap.has(String(b.id))) {
                  recoveredMap.set(String(b.id), b);
                }
              }
            });
          }
        } catch (e) {}
      }
    });

    if (recoveredMap.size > 0) {
      batches = Array.from(recoveredMap.values());
      sanitizeBatchesCoatingName(batches);
      localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
      return;
    }

    batches = [...window.DEFAULT_BATCHES];
    sanitizeBatchesCoatingName(batches);
  }

  function saveBatches(triggerCloudUpload = true) {
    sanitizeBatchesCoatingName(batches);
    localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
    if (triggerCloudUpload) {
      pushToCloud(true); // Force push immediately for user actions
    }
  }

  function exportBackupData() {
    const activeList = batches.filter(b => b && b.deleted !== true);
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeList, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    const dateStamp = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("download", `pharma_production_backup_${dateStamp}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function importBackupData(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const importedData = JSON.parse(evt.target.result);
        if (Array.isArray(importedData)) {
          importedData.forEach(b => {
            b.version = (b.version || 0) + 1;
            b.updatedAt = Date.now();
            b.deleted = false;
          });
          batches = mergeBatches(batches, importedData);
          saveBatches(true);
          renderApp();
          alert(`تم استرجاع النسخة الاحتياطية بنجاح! تم تحميل وتكامل (${importedData.length}) تشغيلة صيدلانية وتحديث كافة أجهزة الأفراد فوراً.`);
        } else {
          alert('تنسيق ملف النسخة الاحتياطية غير صحيح.');
        }
      } catch (err) {
        alert('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /**
   * Conflict-Free Union Merge Engine
   */
  function mergeBatches(localList, cloudList) {
    const mergedMap = new Map();

    // 1. Load cloud list
    cloudList.forEach(cb => {
      if (cb && cb.id) {
        if (cb.updatedAt === undefined) cb.updatedAt = 0;
        if (cb.deleted === undefined) cb.deleted = false;
        mergedMap.set(String(cb.id), cb);
      }
    });

    // 2. Load local list with conflict resolution
    localList.forEach(lb => {
      if (lb && lb.id) {
        if (lb.updatedAt === undefined) lb.updatedAt = 0;
        if (lb.deleted === undefined) lb.deleted = false;
        if (lb.version === undefined) lb.version = 0;

        const existing = mergedMap.get(String(lb.id));
        if (!existing) {
          mergedMap.set(String(lb.id), lb);
        } else {
          if (existing.version === undefined) existing.version = 0;

          // Compare logical versions first to bypass client clock skews
          const lbVer = lb.version || 0;
          const exVer = existing.version || 0;

          if (lbVer > exVer) {
            mergedMap.set(String(lb.id), lb);
          } else if (lbVer === exVer) {
            // Fallback to updatedAt as a tie breaker
            if ((lb.updatedAt || 0) > (existing.updatedAt || 0)) {
              mergedMap.set(String(lb.id), lb);
            } else if ((lb.updatedAt || 0) === (existing.updatedAt || 0)) {
              // Tie breaker based on production progress
              let localHasMoreProgress = false;
              if (Array.isArray(lb.stages) && Array.isArray(existing.stages)) {
                lb.stages.forEach((lst, idx) => {
                  const est = existing.stages[idx];
                  if (est && (lst.doneKg || 0) > (est.doneKg || 0)) {
                    localHasMoreProgress = true;
                  }
                });
              }
              if (localHasMoreProgress) {
                mergedMap.set(String(lb.id), lb);
              }
            }
          }
        }
      }
    });

    return Array.from(mergedMap.values());
  }

  /**
   * Realtime Synchronization Engine with API Cache-Busting
   */
  async function syncFromCloud() {
    if (isSavingToCloud) return;

    try {
      const response = await fetch(getCloudUrl(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        isCloudReadable = true;
        const cloudData = await response.json();
        if (cloudData === null) {
          if (syncText) {
            syncText.textContent = 'متصل بالسحابة 🟢 (قاعدة البيانات فارغة أو رابط السيرفر غير دقيق)';
            syncText.style.color = '#f59e0b';
          }
        } else if (Array.isArray(cloudData)) {
          const mergedList = mergeBatches(batches, cloudData);
          sanitizeBatchesCoatingName(mergedList);
          const currentLocalHash = JSON.stringify(batches);
          const currentCloudHash = JSON.stringify(cloudData);
          const mergedHash = JSON.stringify(mergedList);

          if (currentLocalHash !== mergedHash) {
            batches = mergedList;
            localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
            renderApp();

            if (activeBatchId) {
              const activeBatch = batches.find(b => b && String(b.id) === String(activeBatchId));
              if (activeBatch) {
                renderWorkflowTimeline(activeBatch);
                renderStageLogger(activeBatch);
                renderHistoryList(activeBatch);
              } else {
                closeBatchDetailModal();
              }
            }
          }

          // No auto-push on background sync to prevent HTTP 429 Rate Limits.
          // Pushes only happen when the user performs a local action (add, edit, delete, restore).

          lastSyncHash = mergedHash;
          updateSyncStatusLabel(true);
        }
      } else if (response.status === 429) {
        updateSyncStatusLabel(true);
      } else {
        isCloudReadable = false;
        updateSyncStatusLabel(false);
      }
    } catch (e) {
      isCloudReadable = false;
      updateSyncStatusLabel(false);
    }
  }

  async function pushToCloud(force = false) {
    if (isSavingToCloud) return;
    
    if (!force) {
      const now = Date.now();
      if (now - lastAutoPushTime < AUTO_PUSH_COOLDOWN) return;
      lastAutoPushTime = now;
    }

    isSavingToCloud = true;
    lastSyncHash = JSON.stringify(batches);
    if (syncText) syncText.textContent = 'جاري رفع وتكامل البيانات سحابياً... 🔄';

    try {
      const response = await fetch(CLOUD_API_BASE, {
        method: 'PUT',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(batches)
      });

      if (response.ok) {
        updateSyncStatusLabel(true);
      } else {
        if (syncText) {
          syncText.textContent = `خطأ سحابي: ${response.status} ${response.statusText} 🔴`;
          syncText.style.color = '#ef4444';
        }
      }
    } catch (e) {
      if (syncText) {
        syncText.textContent = `خطأ اتصال: ${e.message || e} 🔴`;
        syncText.style.color = '#ef4444';
      }
    } finally {
      isSavingToCloud = false;
    }
  }

  function updateSyncStatusLabel(connected) {
    if (!syncText) return;
    if (connected && isCloudReadable) {
      syncText.textContent = 'متصل بالسحابة الموحدة 🟢 (تكامل تام وتزامن دائم بين الأجهزة)';
      syncText.style.color = '';
    } else {
      syncText.textContent = 'محفوظ محلياً 🔴 (سيتم المزامنة عند الجاهزية)';
      syncText.style.color = '#f59e0b';
    }
  }

  function renderApp() {
    renderStats();
    renderBatchesGrid();
    renderQuarantineView();
    if (window.lucide) window.lucide.createIcons();
  }

  function renderStats() {
    const activeList = batches.filter(b => b && b.deleted !== true);
    let totalBatches = activeList.length;
    let quarantineWeight = 0;
    let totalPassBlisters = 0;
    let totalReworkBlisters = 0;

    activeList.forEach(b => {
      if (!b || !Array.isArray(b.stages) || b.stages.length === 0) return;
      
      const stIndex = (b.currentStageIndex !== undefined && b.currentStageIndex >= 0 && b.currentStageIndex < b.stages.length) ? b.currentStageIndex : 0;
      const currentStage = b.stages[stIndex];
      const prevDone = (stIndex > 0 && b.stages[stIndex - 1]) ? b.stages[stIndex - 1].doneKg : b.totalWeightKg;
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

    if (elStatActiveBatches) elStatActiveBatches.textContent = totalBatches;
    if (elStatQuarantineWeight) elStatQuarantineWeight.textContent = PharmaMath.formatNumber(quarantineWeight);
    if (elStatPassBlisters) elStatPassBlisters.textContent = PharmaMath.formatNumber(totalPassBlisters);
    if (elStatReworkBlisters) elStatReworkBlisters.textContent = PharmaMath.formatNumber(totalReworkBlisters);
  }

  function renderBatchesGrid() {
    const activeList = batches.filter(b => b && b.deleted !== true);
    let filtered = activeList.filter(b => {
      if (!b) return false;
      const matchForm = currentFormFilter === 'all' || b.pharmaForm === currentFormFilter;
      const matchSearch = (b.productName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (b.batchNo || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchForm && matchSearch;
    });

    if (elBatchesCount) elBatchesCount.textContent = filtered.length;
    if (!elBatchesGrid) return;
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

    if (currentViewMode === 'list') {
      // Render Horizontal Row/Table View
      let tableHtml = `
        <div class="table-responsive">
          <table class="batches-list-table">
            <thead>
              <tr>
                <th>معلومات التشغيلة (Batch)</th>
                <th>الشكل الصيدلاني</th>
                <th>التلبيس</th>
                <th>الوزن الكلي</th>
                <th>اللوتات (Lots)</th>
                <th>التواريخ</th>
                <th>مخطط خط الإنتاج والمرحلة الحالية</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
      `;

      filtered.forEach(batch => {
        const formLabel = batch.pharmaFormLabel || FORM_LABELS_MAP[batch.pharmaForm] || batch.pharmaForm;
        const lCountVal = parseFloat(batch.lotsCount) || 1;
        const lotWeightKg = (batch.totalWeightKg / lCountVal).toFixed(2);
        
        const stIndex = (batch.currentStageIndex !== undefined && batch.currentStageIndex >= 0 && batch.currentStageIndex < batch.stages.length) ? batch.currentStageIndex : 0;
        const currentStage = batch.stages[stIndex] || batch.stages[0];

        const doneKg = currentStage ? currentStage.doneKg : 0;
        const progressPercent = Math.min(100, Math.round((doneKg / batch.totalWeightKg) * 100));
        let pipelineHtml = `
          <div style="min-width: 150px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 3px;">
              <span style="color: var(--cyan); font-weight: bold;">${currentStage ? currentStage.name : '-'}</span>
              <strong style="color: var(--text-muted);">${progressPercent}%</strong>
            </div>
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
              <div style="width: ${progressPercent}%; height: 100%; background: var(--cyan); border-radius: 3px;"></div>
            </div>
          </div>
        `;

        tableHtml += `
          <tr onclick="openBatchDetail('${batch.id}')">
            <td>
              <div style="font-weight: bold; color: #ffffff; font-size: 0.95rem;">${batch.productName}</div>
              <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 2px;">رقم التشغيلة: <strong style="color: var(--amber);">${batch.batchNo}</strong></div>
            </td>
            <td><span class="pharma-badge ${batch.pharmaForm}" style="font-size: 0.75rem; padding: 2px 6px;">${formLabel}</span></td>
            <td><span style="font-size: 0.85rem; color: ${batch.isCoated ? 'var(--cyan)' : 'var(--text-dim)'};">${batch.isCoated ? 'ملبس' : 'غير ملبس'}</span></td>
            <td><strong style="color: var(--emerald); font-size: 0.88rem;">${batch.totalWeightKg} kg</strong></td>
            <td><strong style="color: var(--cyan); font-size: 0.88rem;">${lCountVal.toFixed(2)} Lots</strong><br><span style="font-size: 0.72rem; opacity: 0.7;">(${lotWeightKg} kg/Lot)</span></td>
            <td>
              <div style="font-size: 0.75rem; color: var(--text-dim);">بدء: ${batch.startDate}</div>
              <div style="font-size: 0.75rem; color: var(--rose); margin-top: 2px;">انتهاء: ${batch.expDate}</div>
            </td>
            <td>${pipelineHtml}</td>
            <td>
              <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation();">
                <button class="btn btn-secondary btn-sm" onclick="openBatchDetail('${batch.id}')" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--cyan); color: var(--cyan);">
                  <i data-lucide="eye" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
                  <span style="vertical-align: middle;">تفاصيل</span>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="deleteBatch('${batch.id}')" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--rose); color: var(--rose);">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
                  <span style="vertical-align: middle;">حذف</span>
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      tableHtml += `
            </tbody>
          </table>
        </div>
      `;

      elBatchesGrid.innerHTML = tableHtml;
      elBatchesGrid.style.display = 'block'; // Make grid container block-level in list mode
    } else {
      // Render Card Grid View (Original Mode)
      elBatchesGrid.style.display = 'grid'; // Reset to grid layout

      filtered.forEach(batch => {
        const stIndex = (batch.currentStageIndex !== undefined && batch.currentStageIndex >= 0 && batch.currentStageIndex < batch.stages.length) ? batch.currentStageIndex : 0;
        const currentStage = batch.stages[stIndex] || batch.stages[0];
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

        const lCountVal = parseFloat(batch.lotsCount) || 1;
        const lotWeightKg = (batch.totalWeightKg / lCountVal).toFixed(2);

        const card = document.createElement('div');
        card.className = 'batch-card';
        card.onclick = (e) => {
          if (e.target.closest('.btn-icon-delete') || e.target.closest('.btn-icon-detail')) return;
          openBatchDetail(batch.id);
        };

        card.innerHTML = `
          <div class="batch-card-header">
            <div class="batch-title">
              <h4>${batch.productName}</h4>
              <span class="batch-code"># ${batch.batchNo} (${lCountVal.toFixed(2)} Lot / ${lotWeightKg} kg/Lot)</span>
            </div>
            <div class="header-right-actions">
              <span class="pharma-badge ${batch.pharmaForm}">${batch.pharmaFormLabel || FORM_LABELS_MAP[batch.pharmaForm] || '-'}</span>
              <button class="btn-icon-delete" title="إلغاء وحذف الباتش" onclick="event.stopPropagation(); deleteBatch('${batch.id}');">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>

          ${batch.priorBatchNo ? `
            <div class="batch-card-weights-pill" style="background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.3); color: var(--amber);">
              <span>منقول من باتش سابق: <strong>#${batch.priorBatchNo} (${batch.carryOverKg} kg)</strong></span>
            </div>
          ` : ''}

          <div class="batch-card-weights-pill">
            <span>التلبيس: <strong>${batch.isCoated ? 'ملبس' : 'غير ملبس'}</strong></span>
            <span>وزن الوحدة: <strong>${batch.isCoated ? batch.postCoatingMg + ' mg' : batch.preCoatingMg + ' mg'}</strong></span>
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
              <span>المنجز: ${doneKg} kg (${mathDone.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(mathDone.totalBlisters)} ${getUnitLabel(batch.pharmaForm)})</span>
              <span>إجمالي الباتش: ${batch.totalWeightKg} kg</span>
            </div>
          </div>

          <div class="batch-footer-meta">
            <div>${batch.pharmaForm === 'cream' ? 'إجمالي التيوبات' : 'إجمالي البليسترات'}: <strong>${PharmaMath.formatNumber(mathTotal.totalBlisters)} ${getUnitLabel(batch.pharmaForm)}</strong></div>
            <div>الانتهاء: <strong>${batch.expDate}</strong></div>
          </div>
        `;

        elBatchesGrid.appendChild(card);
      });
    }
  }

  function renderQuarantineView() {
    if (!elQuarantineGrid) return;
    elQuarantineGrid.innerHTML = '';

    const activeList = batches.filter(b => b && b.deleted !== true);
    if (activeList.length === 0) {
      elQuarantineGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted); background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">لا توجد أصناف بالحجر حالياً.</p>
        </div>
      `;
      return;
    }

    activeList.forEach(batch => {
      if (!batch || !Array.isArray(batch.stages) || batch.stages.length === 0) return;
      const stIndex = (batch.currentStageIndex !== undefined && batch.currentStageIndex >= 0 && batch.currentStageIndex < batch.stages.length) ? batch.currentStageIndex : 0;
      const currentStage = batch.stages[stIndex];
      const prevDoneKg = (stIndex > 0 && batch.stages[stIndex - 1]) ? batch.stages[stIndex - 1].doneKg : batch.totalWeightKg;
      const currentDoneKg = currentStage ? currentStage.doneKg : 0;
      const remKgInQuarantine = Math.max(0, prevDoneKg - currentDoneKg);

      let materialState = 'مساحيق وبودرة بالحجر';
      if (batch.pharmaForm === 'solid') {
        if (currentStage.id === 'weighing') {
          materialState = 'مواد خام جاري وزنها ميدانياً';
        } else if (currentStage.id === 'preparation') {
          materialState = 'مساحيق وبودرة ممزوجة (جاهزة للضغط)';
        } else if (currentStage.id === 'compression' && batch.isCoated) {
          materialState = 'مضغوطات نواتية (بحاجة تلبيس)';
        } else if (currentStage.id === 'compression' && !batch.isCoated) {
          materialState = 'مضغوطات غير ملبسة (بحاجة بليستر/تغليف)';
        } else if (currentStage.id === 'coating') {
          materialState = 'مضغوطات ملبسة (بحاجة بليستر/تغليف)';
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
          <span class="pharma-badge ${batch.pharmaForm}">${batch.pharmaFormLabel || '-'}</span>
        </div>

        <div class="q-material-state-pill">
          <i data-lucide="box"></i> ${materialState}
        </div>

        <div class="q-item-body">
          <div class="q-info-field">
            <span>الوزن المتبقي بالحجر:</span>
            <strong>${remKgInQuarantine} kg (${qMathRem.equivalentLots.toFixed(2)} Lot)</strong>
          </div>

          <div class="q-info-field">
            <span>المرحلة القادمة:</span>
            <strong>${currentStage ? currentStage.name : '-'}</strong>
          </div>

          <div class="q-info-field" style="border-right: 3px solid var(--emerald); padding-right: 0.5rem;">
            <span style="color: var(--emerald);">الكمية المقبولة المطابقة:</span>
            <strong style="color: var(--emerald);">${accKgTotal} kg (${PharmaMath.formatNumber(qMathAcc.totalBlisters)} ${getUnitLabel(batch.pharmaForm)})</strong>
          </div>

          <div class="q-info-field" style="border-right: 3px solid var(--rose); padding-right: 0.5rem;">
            <span style="color: var(--rose);">الكمية المرفوضة/إعادة تشغيل:</span>
            <strong style="color: var(--rose);">${rejKgTotal} kg (${PharmaMath.formatNumber(qMathRej.totalBlisters)} ${getUnitLabel(batch.pharmaForm)})</strong>
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
    window.openBatchDetail = openBatchDetail;
    if (btnExportBackup) btnExportBackup.addEventListener('click', exportBackupData);
    if (btnImportBackup) btnImportBackup.addEventListener('click', () => inputBackupFile.click());
    if (inputBackupFile) inputBackupFile.addEventListener('change', importBackupData);

    if (viewTabProduction) {
      viewTabProduction.addEventListener('click', () => {
        viewTabProduction.classList.add('active');
        if (viewTabQuarantine) viewTabQuarantine.classList.remove('active');
        if (viewProductionContainer) viewProductionContainer.classList.remove('hidden');
        if (viewQuarantineContainer) viewQuarantineContainer.classList.add('hidden');
      });
    }

    if (viewTabQuarantine) {
      viewTabQuarantine.addEventListener('click', () => {
        viewTabQuarantine.classList.add('active');
        if (viewTabProduction) viewTabProduction.classList.remove('active');
        if (viewQuarantineContainer) viewQuarantineContainer.classList.remove('hidden');
        if (viewProductionContainer) viewProductionContainer.classList.add('hidden');
        renderQuarantineView();
      });
    }

    elFilterTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        elFilterTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentFormFilter = e.target.getAttribute('data-form');
        renderBatchesGrid();
      });
    });

    if (elSearchInput) {
      elSearchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderBatchesGrid();
      });
    }

    if (elBtnNewBatch) elBtnNewBatch.addEventListener('click', openNewBatchModal);
    if (elCloseNewBatchModal) elCloseNewBatchModal.addEventListener('click', closeNewBatchModal);
    if (elCancelNewBatchModal) elCancelNewBatchModal.addEventListener('click', closeNewBatchModal);

    if (inputIsCoated) inputIsCoated.addEventListener('change', toggleCoatingFields);
    if (inputPharmaForm) inputPharmaForm.addEventListener('change', toggleCoatingFields);

    [inputBatchWeight, inputLotsCount, inputPreCoatingWeight, inputPostCoatingWeight, inputUnitsPerBlister].forEach(el => {
      if (el) el.addEventListener('input', updateNewBatchMathPreview);
    });

    if (elFormNewBatch) elFormNewBatch.addEventListener('submit', handleNewBatchSubmit);

    if (elCloseBatchDetailModal) elCloseBatchDetailModal.addEventListener('click', closeBatchDetailModal);
    if (elCloseDetailBtn) elCloseDetailBtn.addEventListener('click', closeBatchDetailModal);
    
    if (btnDeleteBatch) {
      btnDeleteBatch.addEventListener('click', () => {
        if (activeBatchId) deleteBatch(activeBatchId);
      });
    }

    if (formUpdateStage) formUpdateStage.addEventListener('submit', handleUpdateStageSubmit);

    if (btnToggleEditMode) {
      btnToggleEditMode.addEventListener('click', toggleEditCorrectionMode);
    }
    if (btnCancelEditMode) {
      btnCancelEditMode.addEventListener('click', () => {
        isEditCorrectionMode = false;
        const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
        if (batch) renderStageLogger(batch);
      });
    }
    if (elFormAddQCRun) {
      elFormAddQCRun.addEventListener('submit', handleQCSubmit);
    }

    if (btnResetCache) {
      btnResetCache.addEventListener('click', handleResetCache);
    }

    // View Mode Toggle Listeners
    const btnViewGrid = document.getElementById('btn-view-grid');
    const btnViewList = document.getElementById('btn-view-list');
    
    function updateToggleButtonsUI() {
      if (!btnViewGrid || !btnViewList) return;
      if (currentViewMode === 'grid') {
        btnViewGrid.classList.remove('btn-secondary');
        btnViewGrid.classList.add('btn-primary');
        btnViewGrid.style.background = '';
        btnViewGrid.style.color = '';
        
        btnViewList.classList.remove('btn-primary');
        btnViewList.classList.add('btn-secondary');
        btnViewList.style.background = 'transparent';
        btnViewList.style.borderColor = 'transparent';
        btnViewList.style.color = 'var(--text-dim)';
      } else {
        btnViewList.classList.remove('btn-secondary');
        btnViewList.classList.add('btn-primary');
        btnViewList.style.background = '';
        btnViewList.style.color = '';
        
        btnViewGrid.classList.remove('btn-primary');
        btnViewGrid.classList.add('btn-secondary');
        btnViewGrid.style.background = 'transparent';
        btnViewGrid.style.borderColor = 'transparent';
        btnViewGrid.style.color = 'var(--text-dim)';
      }
    }
    
    if (btnViewGrid && btnViewList) {
      updateToggleButtonsUI();
      
      btnViewGrid.addEventListener('click', () => {
        currentViewMode = 'grid';
        localStorage.setItem('pharma_view_mode', 'grid');
        updateToggleButtonsUI();
        renderBatchesGrid();
      });
      
      btnViewList.addEventListener('click', () => {
        currentViewMode = 'list';
        localStorage.setItem('pharma_view_mode', 'list');
        updateToggleButtonsUI();
        renderBatchesGrid();
      });
    }

    // Server Settings Event Listeners
    if (btnServerSettings) {
      btnServerSettings.addEventListener('click', () => {
        if (inputServerUrl) inputServerUrl.value = CLOUD_API_BASE;
        if (modalServerSettings) modalServerSettings.classList.remove('hidden');
      });
    }

    if (closeServerSettingsModal) {
      closeServerSettingsModal.addEventListener('click', () => {
        if (modalServerSettings) modalServerSettings.classList.add('hidden');
      });
    }

    if (cancelServerSettingsModal) {
      cancelServerSettingsModal.addEventListener('click', () => {
        if (modalServerSettings) modalServerSettings.classList.add('hidden');
      });
    }

    if (btnSaveServerUrl) {
      btnSaveServerUrl.addEventListener('click', () => {
        const val = inputServerUrl.value.trim();
        if (!val) {
          alert('يرجى إدخال رابط سيرفر صحيح.');
          return;
        }
        localStorage.setItem('pharma_production_server_url', val);
        alert('تم حفظ رابط السيرفر الجديد بنجاح! سيتم إعادة تحميل التطبيق لتطبيق الاتصال.');
        window.location.reload();
      });
    }

    if (cloudSyncIndicator) {
      cloudSyncIndicator.addEventListener('click', () => {
        if (syncText) syncText.textContent = 'جاري المزامنة اليدوية الآن... 🔄';
        syncFromCloud().then(() => {
          pushToCloud(true);
        });
      });
    }

    // Auth Event Listeners
    if (formLoginAuth) {
      formLoginAuth.addEventListener('submit', (e) => {
        e.preventDefault();
        const val = inputLoginPasscode.value.trim();
        if (val === correctPasscode) {
          localStorage.setItem('pharma_production_entered_passcode', val);
          if (loginLockScreen) loginLockScreen.classList.add('hidden');
          if (loginErrorMsg) loginErrorMsg.style.display = 'none';
          syncFromCloud();
        } else {
          if (loginErrorMsg) loginErrorMsg.style.display = 'block';
          if (inputLoginPasscode) {
            inputLoginPasscode.value = '';
            inputLoginPasscode.focus();
          }
        }
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        if (confirm('هل تريد تسجيل الخروج وقفل الشاشة؟')) {
          localStorage.removeItem('pharma_production_entered_passcode');
          window.location.reload();
        }
      });
    }
  }

  function handleResetCache() {
    if (confirm('هل أنت متأكد من مسح الذاكرة المحلية المؤقتة بالكامل وإعادة تحميل كل البيانات من السحابة؟\n(هذا الإجراء سيقوم بحذف أي تغييرات غير متزامنة ويقوم بتحميل بيانات السحابة الموحدة فوراً)')) {
      localStorage.removeItem(MASTER_STORAGE_KEY);
      PREVIOUS_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
      batches = [];
      syncFromCloud();
      renderApp();
      alert('تم تفريغ الذاكرة المحلية بنجاح وجاري المزامنة مع السحابة الموحدة الآن...');
    }
  }

  function toggleEditCorrectionMode() {
    isEditCorrectionMode = !isEditCorrectionMode;
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch) {
      renderStageLogger(batch);
    }
  }

  function toggleCoatingFields() {
    const isCoated = inputIsCoated.value === 'true';
    const form = inputPharmaForm.value || 'solid';
    const term = getTerminology(form);

    if (labelPreCoatingWeight) {
      if (form === 'solid' && isCoated) {
        labelPreCoatingWeight.textContent = `${term.weightLabelPre} (mg) *`;
      } else {
        labelPreCoatingWeight.textContent = `${term.weightLabel} (mg) *`;
      }
    }

    const labelUnitsPerBlister = document.getElementById('label-units-per-blister');
    if (labelUnitsPerBlister) {
      labelUnitsPerBlister.textContent = term.unitsPerPackLabel;
    }

    if (form === 'solid' && isCoated) {
      if (groupPostCoatingWeight) groupPostCoatingWeight.classList.remove('hidden');
      if (inputPostCoatingWeight) inputPostCoatingWeight.required = true;
    } else {
      if (groupPostCoatingWeight) groupPostCoatingWeight.classList.add('hidden');
      if (inputPostCoatingWeight) inputPostCoatingWeight.required = false;
    }

    updateNewBatchMathPreview();
  }

  function updateNewBatchMathPreview() {
    const wKg = parseFloat(inputBatchWeight.value) || 0;
    const lCount = parseFloat(inputLotsCount.value) || 1;
    const isCoated = inputIsCoated.value === 'true';
    const preMg = parseFloat(inputPreCoatingWeight.value) || 0;
    const postMg = parseFloat(inputPostCoatingWeight.value) || 0;
    const uPerB = parseInt(inputUnitsPerBlister.value, 10) || 1;
    const form = inputPharmaForm.value || 'solid';

    const res = PharmaMath.calculateTotals(wKg, isCoated, preMg, postMg, uPerB, lCount);
    if (previewLotWeight) previewLotWeight.textContent = `${res.lotWeightKg.toFixed(2)} kg/Lot`;
    
    const term = getTerminology(form);
    if (previewTotalTablets) previewTotalTablets.textContent = `${PharmaMath.formatNumber(res.totalTablets)} ${term.unitName}`;
    if (previewTotalBlisters) previewTotalBlisters.textContent = `${PharmaMath.formatNumber(res.totalBlisters)} ${term.packName}`;

    const labelPreviewTotalUnits = document.getElementById('label-preview-total-units');
    if (labelPreviewTotalUnits) {
      labelPreviewTotalUnits.textContent = `إجمالي عدد الـ ${term.unitPlural} الكلي:`;
    }
    const labelPreviewTotalPacks = document.getElementById('label-preview-total-packs');
    if (labelPreviewTotalPacks) {
      labelPreviewTotalPacks.textContent = form === 'cream' ? 'إجمالي التيوبات المتوقعة:' : 'إجمالي البليسترات/الظروف المتوقعة:';
    }
  }

  function openNewBatchModal() {
    if (elFormNewBatch) elFormNewBatch.reset();
    if (inputIsCoated) inputIsCoated.value = 'false';
    if (inputLotsCount) inputLotsCount.value = '';
    toggleCoatingFields();

    const today = new Date().toISOString().split('T')[0];
    const threeYearsLater = new Date();
    threeYearsLater.setFullYear(threeYearsLater.getFullYear() + 3);
    if (inputStartDate) inputStartDate.value = today;
    if (inputExpDate) inputExpDate.value = threeYearsLater.toISOString().split('T')[0];

    if (elModalNewBatch) elModalNewBatch.classList.remove('hidden');
  }

  function closeNewBatchModal() {
    if (elModalNewBatch) elModalNewBatch.classList.add('hidden');
  }

  function handleNewBatchSubmit(e) {
    e.preventDefault();

    const formType = inputPharmaForm.value;
    const isCoated = inputIsCoated.value === 'true';
    
    let stagesConfig = [];
    if (formType === 'solid') {
      stagesConfig = [
        { id: 'weighing', name: 'الوزن الميداني للمواد الخام' },
        { id: 'preparation', name: 'التحضير والمزج المبدئي' },
        { id: 'compression', name: 'الضغط (Compression)' }
      ];
      if (isCoated) {
        stagesConfig.push({ id: 'coating', name: 'التلبيس (Coating)' });
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
    const lCount = parseFloat(inputLotsCount.value) || 1;
    const priorBatch = inputPriorBatchNo ? inputPriorBatchNo.value.trim() : '';
    const carryKg = inputCarryOverKg ? (parseFloat(inputCarryOverKg.value) || 0) : 0;

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
      qc_runs: [],
      updatedAt: Date.now(),
      version: 1,
      deleted: false,
      logs: [
        {
          time: new Date().toLocaleString('en-US'),
          text: `إنشاء الباتش (${inputBatchWeight.value} kg / ${lCount.toFixed(2)} Lot، ${isCoated ? 'ملبس' : 'غير ملبس'})${priorBatch ? ` - منقول من باتش سابق #${priorBatch} (${carryKg} kg).` : '.'}`
        }
      ]
    };

    batches.unshift(newBatch);
    saveBatches(true);
    closeNewBatchModal();
    renderApp();
  }

  function openBatchDetail(batchId) {
    activeBatchId = batchId;
    isEditCorrectionMode = false;
    const batch = batches.find(b => b && String(b.id) === String(batchId));
    if (!batch || !Array.isArray(batch.stages) || batch.stages.length === 0) return;

    activeStageIndex = (batch.currentStageIndex !== undefined && batch.currentStageIndex >= 0 && batch.currentStageIndex < batch.stages.length) ? batch.currentStageIndex : 0;

    if (detailProductName) detailProductName.textContent = batch.productName;
    if (detailBatchNo) detailBatchNo.textContent = batch.batchNo;
    const term = getTerminology(batch.pharmaForm);

    if (detailFormName) detailFormName.textContent = batch.pharmaFormLabel || FORM_LABELS_MAP[batch.pharmaForm] || '-';
    if (detailTotalWeight) {
      if (batch.carryOverKg > 0) {
        detailTotalWeight.innerHTML = `${batch.totalWeightKg} kg <span style="color: var(--amber); font-weight: bold; margin-right: 5px;">+ ${batch.carryOverKg} kg منقولة</span>`;
      } else {
        detailTotalWeight.textContent = `${batch.totalWeightKg} kg`;
      }
    }

    const lCountVal = parseFloat(batch.lotsCount) || 1;
    const lotWeight = (batch.totalWeightKg / lCountVal).toFixed(2);
    if (detailLotsInfo) detailLotsInfo.textContent = `${lCountVal.toFixed(2)} Lot (${lotWeight} kg/Lot)`;

    if (detailPriorBatchInfo) detailPriorBatchInfo.textContent = batch.priorBatchNo ? `#${batch.priorBatchNo} (${batch.carryOverKg} kg)` : 'لا يوجد (باتش حديث)';

    if (detailCoatingStatus) detailCoatingStatus.textContent = batch.isCoated ? 'ملبس' : 'غير ملبس';

    const labelDetailTabletWeights = document.getElementById('label-detail-tablet-weights');
    if (labelDetailTabletWeights) {
      labelDetailTabletWeights.textContent = term.weightLabel;
    }

    if (detailTabletWeights) {
      detailTabletWeights.textContent = batch.isCoated ? 
        `قبل: ${batch.preCoatingMg} mg | بعد: ${batch.postCoatingMg} mg` : 
        `${batch.preCoatingMg || batch.unitWeightMg || 0} mg`;
    }

    if (detailUnitsPerBlister) detailUnitsPerBlister.textContent = `${batch.unitsPerBlister} ${term.unitName}`;

    const mathTotal = PharmaMath.calculateTotals(
      batch.totalWeightKg,
      batch.isCoated,
      batch.preCoatingMg,
      batch.postCoatingMg,
      batch.unitsPerBlister,
      batch.lotsCount
    );

    const detailTotalBlistersLabel = document.querySelector('#detail-total-blisters') ? document.querySelector('#detail-total-blisters').previousElementSibling : null;
    if (detailTotalBlistersLabel) {
      detailTotalBlistersLabel.textContent = term.packLabel;
    }
    if (detailTotalBlisters) {
      if (batch.carryOverKg > 0) {
        const carryMath = PharmaMath.kgToBlistersAndLots(
          batch.carryOverKg,
          batch.isCoated,
          batch.preCoatingMg,
          batch.postCoatingMg,
          batch.unitsPerBlister,
          batch.totalWeightKg,
          batch.lotsCount
        );
        detailTotalBlisters.innerHTML = `
          ${PharmaMath.formatNumber(mathTotal.totalBlisters)} ${term.packName}
          <span style="color: var(--amber); font-weight: bold; margin-right: 5px;">+ ${PharmaMath.formatNumber(carryMath.totalBlisters)} ${term.packName} منقولة</span>
        `;
      } else {
        detailTotalBlisters.textContent = `${PharmaMath.formatNumber(mathTotal.totalBlisters)} ${term.packName}`;
      }
    }

    if (!Array.isArray(batch.qc_runs)) batch.qc_runs = [];
    renderWorkflowTimeline(batch);
    renderStageLogger(batch);
    renderQCLotsClearanceTable(batch);
    renderQCForm(batch);
    renderHistoryList(batch);

    if (elModalBatchDetail) elModalBatchDetail.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function closeBatchDetailModal() {
    if (elModalBatchDetail) elModalBatchDetail.classList.add('hidden');
    activeBatchId = null;
    isEditCorrectionMode = false;
  }

  window.deleteBatch = function(batchId) {
    const batch = batches.find(b => b && String(b.id) === String(batchId));
    const batchName = batch ? batch.productName : '';
    
    if (confirm(`هل أنت متأكد من إلغاء وحذف تشغيلة المنتج [${batchName}] نهائياً من خط الإنتاج والحجر؟`)) {
      if (batch) {
        batch.deleted = true;
        batch.version = (batch.version || 0) + 1;
        batch.updatedAt = Date.now();
      }
      saveBatches(true);
      if (String(activeBatchId) === String(batchId)) {
        closeBatchDetailModal();
      }
      renderApp();
    }
  };

  function renderWorkflowTimeline(batch) {
    if (!stagesTimeline || !batch || !Array.isArray(batch.stages)) return;
    stagesTimeline.innerHTML = '';

    batch.stages.forEach((stage, idx) => {
      const isSelected = idx === activeStageIndex;
      
      let maxAllowedTotal = batch.totalWeightKg;
      if (idx > 0) {
        const prevStage = batch.stages[idx - 1];
        maxAllowedTotal = prevStage ? (prevStage.acceptedKg || 0) : 0;
      }
      
      let carryAddedInPrior = false;
      for (let p = 0; p < idx; p++) {
        if (batch.stages[p].carryOverAdded) {
          carryAddedInPrior = true;
          break;
        }
      }
      
      let limitForStage = maxAllowedTotal;
      if (!carryAddedInPrior && stage.carryOverAdded) {
        limitForStage += batch.carryOverKg;
      }

      const isCompleted = stage.doneKg >= (limitForStage - 0.05) && limitForStage > 0;

      const card = document.createElement('div');
      card.className = `stage-step-card ${isSelected ? 'active' : ''} ${isCompleted ? 'completed' : ''}`;
      card.onclick = () => selectStage(idx);

      let statusWeightHtml = `${stage.doneKg} / ${limitForStage} kg`;
      if (batch.carryOverKg > 0 && !carryAddedInPrior && !stage.carryOverAdded) {
        statusWeightHtml += ` <span style="color: var(--amber); font-weight: bold;">(+ ${batch.carryOverKg} kg منقولة)</span>`;
      }
      card.innerHTML = `
        <div class="step-number">${idx + 1}</div>
        <span class="step-name">${stage.name}</span>
        <span class="step-status">${statusWeightHtml}</span>
      `;

      stagesTimeline.appendChild(card);
    });
  }

  function selectStage(index) {
    activeStageIndex = index;
    isEditCorrectionMode = false;
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch) {
      batch.currentStageIndex = index;
      saveBatches(true);
      renderWorkflowTimeline(batch);
      renderStageLogger(batch);
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
    }
  }

  function renderStageLogger(batch) {
    if (!batch || !Array.isArray(batch.stages)) return;
    const stage = batch.stages[activeStageIndex] || batch.stages[0];
    if (!stage) return;

    if (logStageName) logStageName.textContent = stage.name;
    const isBlisterStage = activeStageIndex === batch.stages.length - 1;
    const unitLabel = getUnitLabel(batch.pharmaForm);

    if (editModeBtnText) editModeBtnText.textContent = isEditCorrectionMode ? 'إلغاء وضع التصحيح' : 'تعديل وتصحيح الإنجاز المسجل';
    if (btnCancelEditMode) btnCancelEditMode.classList.toggle('hidden', !isEditCorrectionMode);
    if (submitStageBtnText) submitStageBtnText.textContent = isEditCorrectionMode ? 'حفظ وتأكيد التعديل والتصحيح' : 'تسجيل الإنجاز وتحديث الحجر';

    const stageAccKg = stage.acceptedKg || 0;
    const stageRejKg = stage.rejectedKg || 0;

    const accMath = PharmaMath.kgToBlistersAndLots(stageAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
    const rejMath = PharmaMath.kgToBlistersAndLots(stageRejKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

    if (isEditCorrectionMode) {
      if (isBlisterStage) {
        const acceptLabel = batch.pharmaForm === 'cream' ? 'تعديل وتصحيح الكلي المقبول (عدد التيوبات PASS) *' : 'تعديل وتصحيح الكلي المقبول (عدد الظروف PASS) *';
        const rejectLabel = batch.pharmaForm === 'cream' ? 'تعديل وتصحيح الكلي المرفوض (عدد التيوبات REJECTED) *' : 'تعديل وتصحيح الكلي المرفوض (عدد الظروف REJECTED) *';
        if (labelLogAccepted) labelLogAccepted.textContent = acceptLabel;
        if (labelLogRejected) labelLogRejected.textContent = rejectLabel;
        if (inputLogAcceptedKg) inputLogAcceptedKg.value = accMath.totalBlisters;
        if (inputLogRejectedKg) inputLogRejectedKg.value = rejMath.totalBlisters;
      } else {
        if (labelLogAccepted) labelLogAccepted.textContent = 'تعديل وتصحيح الإجمالي المقبول (كغ) *';
        if (labelLogRejected) labelLogRejected.textContent = 'تعديل وتصحيح الإجمالي المرفوض (كغ) *';
        if (inputLogAcceptedKg) inputLogAcceptedKg.value = stageAccKg;
        if (inputLogRejectedKg) inputLogRejectedKg.value = stageRejKg;
      }
      if (logConversionHint) logConversionHint.textContent = 'وضع التصحيح نشط: قم بتغيير القيم وتأكيد التعديل لتحديث الحجر والمراحل مباشرة.';
    } else {
      if (isBlisterStage) {
        const acceptLabel = batch.pharmaForm === 'cream' ? 'عدد التيوبات المقبولة المضافة (تيوب PASS) *' : 'عدد الظروف/البليسترات المقبولة المضافة (ظرف PASS) *';
        const rejectLabel = batch.pharmaForm === 'cream' ? 'عدد التيوبات المرفوضة/إعادة تشغيل (تيوب REJECTED) *' : 'عدد الظروف المرفوضة/إعادة تشغيل (ظرف REJECTED) *';
        if (labelLogAccepted) labelLogAccepted.textContent = acceptLabel;
        if (labelLogRejected) labelLogRejected.textContent = rejectLabel;
        if (inputLogAcceptedKg) { inputLogAcceptedKg.value = ''; inputLogAcceptedKg.placeholder = batch.pharmaForm === 'cream' ? 'مثال: 500 تيوب مقبول' : `مثال: 500 ${unitLabel} مقبول`; }
        if (inputLogRejectedKg) { inputLogRejectedKg.value = '0'; inputLogRejectedKg.placeholder = batch.pharmaForm === 'cream' ? 'مثال: 10 تيوبات مرفوضة' : `مثال: 10 ${unitLabel} مرفوضة`; }
        if (logConversionHint) logConversionHint.textContent = batch.pharmaForm === 'cream' ? 
          'مرحلة التعبئة النهائية: يتم إدخال عدد الأنابيب/التيوبات مباشرة وتقوم المنظومة بتحويلها تلقائياً إلى الوزن المقابل بالكيلوغرام وتحديث أجهزة المعمل.' : 
          `مرحلة التعبئة النهائية: يتم إدخال عدد الـ ${unitLabel} مباشرة وتقوم المنظومة بتحويلها تلقائياً إلى الوزن المقابل بالكيلوغرام وتحديث أجهزة المعمل.`;
      } else {
        if (labelLogAccepted) labelLogAccepted.textContent = 'الكمية المقبولة/المطابقة المضافة (kg) *';
        if (labelLogRejected) labelLogRejected.textContent = 'الكمية المرفوضة/إعادة تشغيل (kg) *';
        if (inputLogAcceptedKg) { inputLogAcceptedKg.value = ''; inputLogAcceptedKg.placeholder = 'مثال: 18 kg مقبول'; }
        if (inputLogRejectedKg) { inputLogRejectedKg.value = '0'; inputLogRejectedKg.placeholder = 'مثال: 2 kg مرفوض'; }
        if (logConversionHint) logConversionHint.textContent = 'يتم إدخال الوزن بالكيلوغرام وتقوم المنظومة بتحويلها تلقائياً إلى أعداد ظروف/تيوبات ولوتات وتحديث كافة أجهزة المعمل.';
      }
    }

    let maxAllowedTotal = batch.totalWeightKg;
    if (activeStageIndex > 0) {
      const prevStage = batch.stages[activeStageIndex - 1];
      maxAllowedTotal = prevStage ? (prevStage.acceptedKg || 0) : 0;
    }

    let carryOverAlreadyAdded = false;
    for (let idx = 0; idx < activeStageIndex; idx++) {
      if (batch.stages[idx].carryOverAdded) {
        carryOverAlreadyAdded = true;
        break;
      }
    }

    // First read the checkbox checked state BEFORE re-rendering (destroying) it
    const chkCarryBefore = document.getElementById('chk-add-carry-over-progress');
    const chkChecked = chkCarryBefore ? chkCarryBefore.checked : false;

    // Populate stage-carry-over-progress-container dynamically
    if (elStageCarryOverProgressContainer) {
      if (batch.carryOverKg > 0) {
        if (carryOverAlreadyAdded) {
          elStageCarryOverProgressContainer.innerHTML = `
            <div style="color: var(--emerald); font-size: 0.85rem; font-weight: bold; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="check-circle" style="width: 16px; height: 16px; color: var(--emerald);"></i>
              <span>تم إدراج إنجاز الكمية المنقولة (+ ${batch.carryOverKg} kg) في مرحلة سابقة.</span>
            </div>
          `;
        } else if (stage.carryOverAdded) {
          elStageCarryOverProgressContainer.innerHTML = `
            <div style="color: var(--emerald); font-size: 0.85rem; font-weight: bold; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="check-circle" style="width: 16px; height: 16px; color: var(--emerald);"></i>
              <span>تم إدراج الكمية المنقولة كإنجاز في هذه المرحلة الحالية (+ ${batch.carryOverKg} kg).</span>
            </div>
          `;
        } else {
          elStageCarryOverProgressContainer.innerHTML = `
            <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: bold; color: var(--amber); cursor: pointer;">
              <input type="checkbox" id="chk-add-carry-over-progress" ${chkChecked ? 'checked' : ''} onchange="window.updateStageLoggerLimit()">
              <span>إدراج الكمية المنقولة كإنجاز في هذه المرحلة (+ ${batch.carryOverKg} kg)</span>
            </label>
          `;
        }
      } else {
        elStageCarryOverProgressContainer.innerHTML = '';
      }
    }

    // Now compute the dynamic limit
    let currentLimit = maxAllowedTotal;
    if (!carryOverAlreadyAdded && (stage.carryOverAdded || chkChecked)) {
      currentLimit += batch.carryOverKg;
    }

    const totalMath = PharmaMath.kgToBlistersAndLots(currentLimit, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

    if (logStageTotalKg) {
      if (batch.carryOverKg > 0 && !carryOverAlreadyAdded && !stage.carryOverAdded && !chkChecked) {
        logStageTotalKg.innerHTML = `${currentLimit} kg <span style="color: var(--amber); font-weight: bold; margin-right: 5px;">(+ ${batch.carryOverKg} kg منقولة متوفرة)</span>`;
      } else if (batch.carryOverKg > 0 && (stage.carryOverAdded || chkChecked)) {
        logStageTotalKg.innerHTML = `${currentLimit} kg <span style="color: var(--emerald); font-weight: bold; margin-right: 5px;">(شاملة ${batch.carryOverKg} kg منقولة 🟢)</span>`;
      } else {
        logStageTotalKg.textContent = `${currentLimit} kg`;
      }
    }

    if (logStageTotalBlisters) {
      if (batch.carryOverKg > 0 && !carryOverAlreadyAdded && !stage.carryOverAdded && !chkChecked) {
        const carryMath = PharmaMath.kgToBlistersAndLots(
          batch.carryOverKg,
          batch.isCoated,
          batch.preCoatingMg,
          batch.postCoatingMg,
          batch.unitsPerBlister,
          batch.totalWeightKg,
          batch.lotsCount
        );
        logStageTotalBlisters.innerHTML = `
          (${totalMath.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ${unitLabel})
          <span style="color: var(--amber); font-weight: bold; margin-right: 5px;">(+ ${PharmaMath.formatNumber(carryMath.totalBlisters)} ${unitLabel} منقولة)</span>
        `;
      } else if (batch.carryOverKg > 0 && (stage.carryOverAdded || chkChecked)) {
        logStageTotalBlisters.innerHTML = `(${totalMath.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ${unitLabel}) <span style="color: var(--emerald); font-weight: bold;">(شامل المنقولة 🟢)</span>`;
      } else {
        logStageTotalBlisters.textContent = `(${totalMath.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ${unitLabel})`;
      }
    }

    if (logStageAcceptedKg) logStageAcceptedKg.textContent = `${stageAccKg} kg`;
    if (logStageAcceptedBlisters) logStageAcceptedBlisters.textContent = `(${PharmaMath.formatNumber(accMath.totalBlisters)} ${unitLabel} مقبول)`;

    if (logStageRejectedKg) logStageRejectedKg.textContent = `${stageRejKg} kg`;
    if (logStageRejectedBlisters) logStageRejectedBlisters.textContent = `(${PharmaMath.formatNumber(rejMath.totalBlisters)} ${unitLabel} مرفوض/إعادة تشغيل)`;
  }

  function handleUpdateStageSubmit(e) {
    e.preventDefault();
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch || !Array.isArray(batch.stages)) return;

    const stage = batch.stages[activeStageIndex];
    if (!stage) return;
    const isBlisterStage = activeStageIndex === batch.stages.length - 1;
    const term = getTerminology(batch.pharmaForm);

    // QC Gate Validation Checks
    if (!Array.isArray(batch.qc_runs)) batch.qc_runs = [];
    
    let maxAllowedTotal = batch.totalWeightKg;
    if (activeStageIndex > 0) {
      const prevStage = batch.stages[activeStageIndex - 1];
      maxAllowedTotal = prevStage ? (prevStage.acceptedKg || 0) : 0;
    }
    
    // Check 1: Compression/Filling stage needs passed Assay in Preparation
    if (stage.id === 'compression' || stage.id === 'filling') {
      const hasPassedAssay = batch.qc_runs.some(r => r.test_type === 'assay' && r.status === 'passed');
      if (!hasPassedAssay) {
        alert('يجب تسجيل فحص المعايرة الكيميائية (Assay) ومطابقته بنجاح 🟢 في مرحلة التحضير أولاً قبل إدخال إنجاز هذه المرحلة.');
        return;
      }
    }
    
    // Check 2: Blistering/Packaging stage needs passed Dissolution & Uniformity (for Tablets/Capsules)
    if (stage.id === 'blistering' || stage.id === 'packaging') {
      if (batch.pharmaForm === 'solid' || batch.pharmaForm === 'capsule') {
        if (!Array.isArray(batch.active_qc_tests)) {
          batch.active_qc_tests = ['dissolution', 'uniformity'];
        }
        const hasDiss = batch.active_qc_tests.includes('dissolution');
        const hasUnif = batch.active_qc_tests.includes('uniformity');

        const hasPassedDiss = !hasDiss || batch.qc_runs.some(r => r.test_type === 'dissolution' && r.status === 'passed');
        const hasPassedUnif = !hasUnif || batch.qc_runs.some(r => r.test_type === 'uniformity' && r.status === 'passed');
        if (!hasPassedDiss || !hasPassedUnif) {
          let alertMsg = 'يجب تسجيل فحوصات ';
          const missing = [];
          if (hasDiss && !batch.qc_runs.some(r => r.test_type === 'dissolution' && r.status === 'passed')) missing.push('الانحلالية (Dissolution)');
          if (hasUnif && !batch.qc_runs.some(r => r.test_type === 'uniformity' && r.status === 'passed')) missing.push('تجانس المحتوى (Content Uniformity)');
          alertMsg += missing.join(' و ') + ' ومطابقتها بنجاح 🟢 في مرحلة الضغط/التعبئة أولاً قبل إدخال إنجاز هذه المرحلة.';
          alert(alertMsg);
          return;
        }
      }
    }

    // Check 2.5: Coating stage optional tests (if enabled, they must pass before completing coating stage)
    if (stage.id === 'coating') {
      if (!Array.isArray(batch.active_qc_tests)) {
        batch.active_qc_tests = ['dissolution', 'uniformity'];
      }
      const globalDiss = batch.active_qc_tests.includes('dissolution');
      const globalUnif = batch.active_qc_tests.includes('uniformity');

      if (Array.isArray(batch.active_optional_tests)) {
        if (batch.active_optional_tests.includes('coating_dissolution') && globalDiss) {
          const hasPassed = batch.qc_runs.some(r => r.test_type === 'coating_dissolution' && r.status === 'passed');
          if (!hasPassed) {
            alert('فحص الانحلالية بعد التلبيس مفعل ومطلوب، يرجى تسجيل فحص مطابق ومقبول 🟢 أولاً.');
            return;
          }
        }
        if (batch.active_optional_tests.includes('coating_uniformity') && globalUnif) {
          const hasPassed = batch.qc_runs.some(r => r.test_type === 'coating_uniformity' && r.status === 'passed');
          if (!hasPassed) {
            alert('فحص تجانس المحتوى بعد التلبيس مفعل ومطلوب، يرجى تسجيل فحص مطابق ومقبول 🟢 أولاً.');
            return;
          }
        }
      }
    }

    // Check 3: Final stage completion needs passed Microbiology
    if (isBlisterStage) {
      let willBeDone = 0;
      if (isEditCorrectionMode) {
        let newAcc = 0;
        let newRej = 0;
        const newAccBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
        const newRejBlisters = parseFloat(inputLogRejectedKg.value) || 0;
        newAcc = PharmaMath.blistersToKg(newAccBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
        newRej = PharmaMath.blistersToKg(newRejBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
        willBeDone = newAcc + newRej;
      } else {
        let addAcc = 0;
        let addRej = 0;
        const addAccBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
        const addRejBlisters = parseFloat(inputLogRejectedKg.value) || 0;
        addAcc = PharmaMath.blistersToKg(addAccBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
        addRej = PharmaMath.blistersToKg(addRejBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
        willBeDone = stage.doneKg + addAcc + addRej;
      }
      
      if (willBeDone >= (maxAllowedTotal - 0.05)) {
        const hasPassedMicro = batch.qc_runs.some(r => r.test_type === 'microbiology' && r.status === 'passed');
        if (!hasPassedMicro) {
          alert(`لا يمكن إغلاق مرحلة [${stage.name}] النهائية وإفراج الباتش إلا بعد تسجيل فحص الزرع الجرثومي (Microbiology) ومطابقته بنجاح 🟢.`);
          return;
        }
      }
    }

    if (isEditCorrectionMode) {
      let newAccKg = 0;
      let newRejKg = 0;
      let newAccBlisters = 0;
      let newRejBlisters = 0;

      if (isBlisterStage) {
        newAccBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
        newRejBlisters = parseFloat(inputLogRejectedKg.value) || 0;

        newAccKg = PharmaMath.blistersToKg(newAccBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
        newRejKg = PharmaMath.blistersToKg(newRejBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
      } else {
        newAccKg = parseFloat(inputLogAcceptedKg.value) || 0;
        newRejKg = parseFloat(inputLogRejectedKg.value) || 0;

        const accMath = PharmaMath.kgToBlistersAndLots(newAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
        const rejMath = PharmaMath.kgToBlistersAndLots(newRejKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

        newAccBlisters = accMath.totalBlisters;
        newRejBlisters = rejMath.totalBlisters;
      }



      let stageLimit = maxAllowedTotal;
      let carryOverAlreadyAdded = false;
      for (let idx = 0; idx < activeStageIndex; idx++) {
        if (batch.stages[idx].carryOverAdded) {
          carryOverAlreadyAdded = true;
          break;
        }
      }
      if (!carryOverAlreadyAdded && stage.carryOverAdded) {
        stageLimit += batch.carryOverKg;
      }

      if ((newAccKg + newRejKg) > (stageLimit + 0.05)) {
        if (activeStageIndex > 0) {
          alert(`الكمية الإجمالية المصححة لا يمكن أن تتجاوز ${stageLimit.toFixed(2)} kg (المحدودة بالكمية المقبولة في المرحلة السابقة: ${maxAllowedTotal.toFixed(2)} kg + المنقولة إن وجدت).`);
        } else {
          alert(`الكمية الإجمالية المصححة لا يمكن أن تتجاوز وزن الباتش الكلي ${stageLimit.toFixed(2)} kg.`);
        }
        return;
      }

      stage.acceptedKg = newAccKg;
      stage.rejectedKg = newRejKg;
      stage.doneKg = newAccKg + newRejKg;

      if (stage.doneKg >= (stageLimit - 0.05)) {
        stage.status = 'completed';
      } else if (stage.doneKg > 0) {
        stage.status = 'in_progress';
      } else {
        stage.status = 'pending';
      }

      if (!Array.isArray(batch.logs)) batch.logs = [];
      const uLabel = getUnitLabel(batch.pharmaForm);
      batch.logs.unshift({
        time: new Date().toLocaleString('en-US'),
        text: `تعديل وتصحيح إنجاز مرحلة [${stage.name}]: (الكلي المقبول: ${newAccKg} kg = ${PharmaMath.formatNumber(newAccBlisters)} ${uLabel}) و (الكلي المرفوض: ${newRejKg} kg = ${PharmaMath.formatNumber(newRejBlisters)} ${uLabel}).`
      });

      isEditCorrectionMode = false;
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      renderWorkflowTimeline(batch);
      renderStageLogger(batch);
      renderHistoryList(batch);
      renderApp();
      return;
    }

    // NORMAL INCREMENTAL ADDITION MODE
    let addAcceptedKg = 0;
    let addRejectedKg = 0;
    let addAcceptedBlisters = 0;
    let addRejectedBlisters = 0;

    if (isBlisterStage) {
      addAcceptedBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
      addRejectedBlisters = parseFloat(inputLogRejectedKg.value) || 0;

      addAcceptedKg = PharmaMath.blistersToKg(addAcceptedBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
      addRejectedKg = PharmaMath.blistersToKg(addRejectedBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
    } else {
      addAcceptedKg = parseFloat(inputLogAcceptedKg.value) || 0;
      addRejectedKg = parseFloat(inputLogRejectedKg.value) || 0;

      const accMath = PharmaMath.kgToBlistersAndLots(addAcceptedKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
      const rejMath = PharmaMath.kgToBlistersAndLots(addRejectedKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

      addAcceptedBlisters = accMath.totalBlisters;
      addRejectedBlisters = rejMath.totalBlisters;
    }

    const chkCarryProgress = document.getElementById('chk-add-carry-over-progress');
    const shouldAddCarryOver = chkCarryProgress ? chkCarryProgress.checked : false;

    let carryOverAlreadyAdded = false;
    for (let idx = 0; idx < activeStageIndex; idx++) {
      if (batch.stages[idx].carryOverAdded) {
        carryOverAlreadyAdded = true;
        break;
      }
    }

    let stageLimit = maxAllowedTotal;
    if (!carryOverAlreadyAdded && (shouldAddCarryOver || stage.carryOverAdded)) {
      stageLimit += batch.carryOverKg;
    }

    const addTotalKg = addAcceptedKg + addRejectedKg;

    if (addTotalKg <= 0 && addAcceptedBlisters <= 0 && addRejectedBlisters <= 0 && !shouldAddCarryOver) {
      alert('يرجى إدخال كمية مقبولة أو مرفوضة أكبر من صفر أو إدراج الكمية المنقولة.');
      return;
    }

    const maxAddableKg = Math.max(0, stageLimit - stage.doneKg);

    if (addTotalKg > (maxAddableKg + 0.05)) {
      if (activeStageIndex > 0) {
        alert(`الكمية المتاحة كحد أقصى لهذه المرحلة هي ${maxAddableKg.toFixed(2)} kg (محدودة بالكمية المقبولة في المرحلة السابقة: ${maxAllowedTotal.toFixed(2)} kg + المنقولة إن وجدت).`);
      } else {
        alert(`الكمية المتاحة كحد أقصى لهذه المرحلة هي ${maxAddableKg.toFixed(2)} kg.`);
      }
      return;
    }

    let finalAddAcceptedKg = addAcceptedKg;
    if (!carryOverAlreadyAdded && shouldAddCarryOver) {
      finalAddAcceptedKg += batch.carryOverKg;
      stage.carryOverAdded = true;
    }

    stage.doneKg += (finalAddAcceptedKg - addAcceptedKg) + addTotalKg;
    stage.acceptedKg = (stage.acceptedKg || 0) + finalAddAcceptedKg;
    stage.rejectedKg = (stage.rejectedKg || 0) + addRejectedKg;

    if (stage.doneKg >= (stageLimit - 0.05)) {
      stage.status = 'completed';
    } else {
      stage.status = 'in_progress';
    }

    batch.currentStageIndex = activeStageIndex;

    if (!Array.isArray(batch.logs)) batch.logs = [];
    const uLabel = getUnitLabel(batch.pharmaForm);

    let logMsg = '';
    if (isBlisterStage) {
      if (batch.pharmaForm === 'cream') {
        logMsg = `تسجيل إنجاز بالتعبئة والتعبئة النهائية: (${addAcceptedBlisters} تيوب مقبول = ${addAcceptedKg} kg) و (${addRejectedBlisters} تيوب مرفوض = ${addRejectedKg} kg)`;
      } else {
        logMsg = `تسجيل إنجاز بالبليستر والتغليف: (${addAcceptedBlisters} ${term.packName} مقبول = ${addAcceptedKg} kg) و (${addRejectedBlisters} ${term.packName} مرفوض = ${addRejectedKg} kg)`;
      }
    } else {
      logMsg = `تسجيل إنجاز بمرحلة [${stage.name}]: (${addAcceptedKg} kg مقبول = ${PharmaMath.formatNumber(addAcceptedBlisters)} ${uLabel}) و (${addRejectedKg} kg مرفوض = ${PharmaMath.formatNumber(addRejectedBlisters)} ${uLabel})`;
    }

    if (!carryOverAlreadyAdded && shouldAddCarryOver) {
      logMsg += ` [شامل إدراج الكمية المنقولة من الباتش السابق: +${batch.carryOverKg} kg]`;
    }
    logMsg += '.';

    batch.logs.unshift({
      time: new Date().toLocaleString('en-US'),
      text: logMsg
    });

    batch.version = (batch.version || 0) + 1;
    batch.updatedAt = Date.now();
    saveBatches(true);
    renderWorkflowTimeline(batch);
    renderStageLogger(batch);
    renderHistoryList(batch);
    renderApp();
  }

  function renderHistoryList(batch) {
    if (!stageHistoryList || !batch) return;
    stageHistoryList.innerHTML = '';
    if (!Array.isArray(batch.logs) || batch.logs.length === 0) {
      stageHistoryList.innerHTML = '<p class="text-dim">لا توجد سجلات بعد.</p>';
      return;
    }

    batch.logs.forEach(log => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <span>${log.text}</span>
        <span class="time">${log.time || ''}</span>
      `;
      stageHistoryList.appendChild(item);
    });
  }

  function evaluateQCCompliance(rangeStr, resultStr) {
    if (!rangeStr || !resultStr) return true;
    
    const rangeNums = rangeStr.match(/[0-9]*\.?[0-9]+/g);
    const resultNums = resultStr.match(/[0-9]*\.?[0-9]+/g);
    
    if (!rangeNums || rangeNums.length === 0 || !resultNums || resultNums.length === 0) {
      return true;
    }
    
    const resVal = parseFloat(resultNums[0]);
    
    if (rangeNums.length >= 2) {
      const val1 = parseFloat(rangeNums[0]);
      const val2 = parseFloat(rangeNums[1]);
      const min = Math.min(val1, val2);
      const max = Math.max(val1, val2);
      return (resVal >= min && resVal <= max);
    }
    
    const limit = parseFloat(rangeNums[0]);
    const textClean = rangeStr.replace(/\s+/g, '');
    
    if (textClean.includes('>') || textClean.includes('≥') || textClean.includes('atleast') || textClean.includes('أكبر')) {
      return resVal >= limit;
    }
    if (textClean.includes('<') || textClean.includes('≤') || textClean.includes('أقل')) {
      return resVal <= limit;
    }
    
    return resVal >= limit;
  }

  function renderQCLotsClearanceTable(batch) {
    if (!elQCLotsClearanceTableContainer || !batch) return;

    const form = batch.pharmaForm || 'solid';
    const lCountVal = Math.ceil(parseFloat(batch.lotsCount) || 1);
    
    // Determine required tests
    const isTabletOrCapsule = (form === 'solid' || form === 'capsule');
    if (!Array.isArray(batch.active_qc_tests)) {
      batch.active_qc_tests = ['dissolution', 'uniformity'];
    }
    const hasDiss = batch.active_qc_tests.includes('dissolution');
    const hasUnif = batch.active_qc_tests.includes('uniformity');

    const requiredTests = [];
    requiredTests.push('assay');
    
    if (isTabletOrCapsule) {
      if (batch.isCoated && Array.isArray(batch.active_optional_tests)) {
        if (batch.active_optional_tests.includes('coating_dissolution') && hasDiss) requiredTests.push('coating_dissolution');
        if (batch.active_optional_tests.includes('coating_uniformity') && hasUnif) requiredTests.push('coating_uniformity');
      }
      if (hasDiss) requiredTests.push('dissolution');
      if (hasUnif) requiredTests.push('uniformity');
    }
    requiredTests.push('microbiology');

    const testLabels = {
      assay: 'المعايرة (Assay)',
      dissolution: 'الانحلالية بالضغط',
      uniformity: 'تجانس المحتوى بالضغط',
      coating_dissolution: 'فحص الانحلالية',
      coating_uniformity: 'فحص تجانس المحتوى',
      microbiology: 'الزرع الجرثومي (Microbiology)'
    };

    let tableHtml = `
      <table class="qc-table">
        <thead>
          <tr>
            <th>اللوت الفرعي</th>
    `;
    
    requiredTests.forEach(test => {
      tableHtml += `<th>${testLabels[test]}</th>`;
    });
    
    tableHtml += `
            <th>حالة الإفراج النهائي</th>
          </tr>
        </thead>
        <tbody>
    `;

    let allLotsReleased = true;
    let anyLotFailed = false;

    // Set of lotNames that have already been rendered in rowspan for each testType
    const skippedLotsForTest = {};
    requiredTests.forEach(test => {
      skippedLotsForTest[test] = new Set();
    });

    const lotNames = [];
    for (let i = 1; i <= lCountVal; i++) {
      lotNames.push(`Lot ${i}`);
    }
    if (batch.carryOverKg > 0) {
      lotNames.push('الكمية المنقولة');
    }

    function isTestRequiredForCarryOver(testType, b) {
      if (!b.active_carry_over_tests) return false;
      if (testType === 'assay') return b.active_carry_over_tests.includes('carry_assay');
      if (testType === 'dissolution' || testType === 'coating_dissolution') return b.active_carry_over_tests.includes('carry_dissolution');
      if (testType === 'uniformity' || testType === 'coating_uniformity') return b.active_carry_over_tests.includes('carry_uniformity');
      if (testType === 'microbiology') return b.active_carry_over_tests.includes('carry_microbiology');
      return false;
    }

    lotNames.forEach((lotName, idx) => {
      const isCarryOver = lotName === 'الكمية المنقولة';
      const cellColor = isCarryOver ? 'color: var(--amber);' : 'color: var(--cyan);';
      tableHtml += `<tr><td style="font-weight: bold; ${cellColor}">${lotName}</td>`;
      
      let lotPassedAll = true;
      let lotFailedAny = false;

      requiredTests.forEach(testType => {
        const isRequired = !isCarryOver || isTestRequiredForCarryOver(testType, batch);
        
        if (!isRequired) {
          if (skippedLotsForTest[testType].has(lotName)) return;
          tableHtml += `<td><span class="qc-badge-status pending" style="background: rgba(255,255,255,0.04); color: var(--text-dim); border-color: rgba(255,255,255,0.08); box-shadow: none;">غير مطلوب</span></td>`;
          return;
        }

        // Calculate status for this lot individually
        const runsForLot = (batch.qc_runs || []).filter(r => r.test_type === testType && Array.isArray(r.target_lots) && r.target_lots.includes(lotName));
        if (runsForLot.length > 0) {
          const hasPassed = runsForLot.some(r => r.status === 'passed');
          const hasFailed = runsForLot.some(r => r.status === 'failed');
          if (hasPassed) {
            // lot passed this test
          } else if (hasFailed) {
            lotFailedAny = true;
          } else {
            lotPassedAll = false;
          }
        } else {
          lotPassedAll = false;
        }

        // If this lot's cell is merged with a previous row, do NOT render td
        if (skippedLotsForTest[testType].has(lotName)) {
          return;
        }

        let status = 'pending';
        let detailText = '';
        let sampleText = '';
        let activeRun = null;

        if (runsForLot.length > 0) {
          activeRun = runsForLot[runsForLot.length - 1]; // latest run
          status = activeRun.status;
          if (Array.isArray(activeRun.ingredients) && activeRun.ingredients.length > 0) {
            let ingText = '';
            activeRun.ingredients.forEach(ing => {
              ingText += `<div style="margin-top: 2.5px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 2.5px;">${ing.name}: <strong>${ing.assay_val}</strong> (مجال: ${ing.qc_range})</div>`;
            });
            detailText = `<br><span style="font-size: 0.70rem; opacity: 0.85; display: inline-block; text-align: right; direction: rtl; width: 100%;">${ingText}</span>`;
          } else if (activeRun.assay_val !== undefined && activeRun.assay_val !== null && activeRun.assay_val !== '') {
            if (activeRun.qc_range) {
              detailText = `<br><span style="font-size: 0.72rem; opacity: 0.85; display: inline-block; margin-top: 3px;">النتيجة: <strong>${activeRun.assay_val}</strong><br>المجال: <strong>${activeRun.qc_range}</strong></span>`;
            } else {
              detailText = ` (${activeRun.assay_val})`;
            }
          }
          if (activeRun.sample_no) {
            sampleText = `<br><span style="font-size: 0.65rem; opacity: 0.75;">عينة: ${activeRun.sample_no}</span>`;
          }
        }

        // Calculate contiguous rowspan
        let rowspan = 1;
        if (!isCarryOver && activeRun && Array.isArray(activeRun.target_lots)) {
          let nextIdx = idx + 1;
          while (nextIdx < lCountVal) {
            const nextLotName = lotNames[nextIdx];
            const nextLotRuns = (batch.qc_runs || []).filter(r => r.test_type === testType && Array.isArray(r.target_lots) && r.target_lots.includes(nextLotName));
            const nextLotActiveRun = nextLotRuns.length > 0 ? nextLotRuns[nextLotRuns.length - 1] : null;

            if (nextLotActiveRun && nextLotActiveRun.run_id === activeRun.run_id) {
              rowspan++;
              skippedLotsForTest[testType].add(nextLotName);
              nextIdx++;
            } else {
              break;
            }
          }
        }

        const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}" style="vertical-align: middle; text-align: center;"` : '';

        if (status === 'passed') {
          tableHtml += `<td${rowspanAttr}><span class="qc-badge-status passed">مطابق 🟢${detailText}${sampleText}</span></td>`;
        } else if (status === 'failed') {
          tableHtml += `<td${rowspanAttr}><span class="qc-badge-status failed">غير مطابق 🔴${detailText}${sampleText}</span></td>`;
        } else {
          tableHtml += `<td${rowspanAttr}><span class="qc-badge-status pending">قيد الانتظار ⏳</span></td>`;
        }
      });

      let releaseStatusHtml = '';
      if (lotFailedAny) {
        releaseStatusHtml = `<span class="qc-badge-status failed" style="width: 100%;">محتجز/مرفوض 🔴</span>`;
        anyLotFailed = true;
        allLotsReleased = false;
      } else if (lotPassedAll) {
        releaseStatusHtml = `<span class="qc-badge-status passed" style="width: 100%;">مفرج عنه 🟢</span>`;
      } else {
        releaseStatusHtml = `<span class="qc-badge-status pending" style="width: 100%;">معلق ⏳</span>`;
        allLotsReleased = false;
      }

      tableHtml += `<td>${releaseStatusHtml}</td></tr>`;
    });

    tableHtml += `</tbody></table>`;
    elQCLotsClearanceTableContainer.innerHTML = tableHtml;

    // Update batch status badge
    if (elQCBatchStatusBadge) {
      if (anyLotFailed) {
        elQCBatchStatusBadge.textContent = 'مرفوض / محتجز بالكامل 🔴';
        elQCBatchStatusBadge.style.background = 'rgba(244, 63, 94, 0.2)';
        elQCBatchStatusBadge.style.color = 'var(--rose)';
      } else if (allLotsReleased) {
        elQCBatchStatusBadge.textContent = 'مفرج عنه بالكامل (Released) 🟢';
        elQCBatchStatusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        elQCBatchStatusBadge.style.color = 'var(--emerald)';
      } else {
        elQCBatchStatusBadge.textContent = 'معلق في المختبر ⏳';
        elQCBatchStatusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        elQCBatchStatusBadge.style.color = 'var(--amber)';
      }
    }

    // Update logged runs list
    renderQCRunsHistory(batch);
  }

  function renderQCForm(batch) {
    if (!elFormAddQCRun || !batch || !Array.isArray(batch.stages)) return;
    
    const stage = batch.stages[activeStageIndex];
    if (!stage) return;
    
    const stageId = stage.id;
    const form = batch.pharmaForm || 'solid';
    
    // Render dynamic Global QC Config box
    if (elQCGlobalConfigContainer) {
      if (!Array.isArray(batch.active_qc_tests)) {
        batch.active_qc_tests = ['dissolution', 'uniformity'];
      }
      const globalDiss = batch.active_qc_tests.includes('dissolution');
      const globalUnif = batch.active_qc_tests.includes('uniformity');
      const ingCount = parseInt(batch.active_ingredients_count, 10) || 1;

      let optionalTestsHtml = '';
      if (form === 'solid' || form === 'capsule') {
        optionalTestsHtml = `
          <div style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
            <span style="font-size: 0.78rem; color: var(--text-dim); display: block; margin-bottom: 5px;">خيارات الفحوصات المطلوبة للتشغيلة الأساسية:</span>
            <div style="display: flex; gap: 15px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.8rem;">
                <input type="checkbox" id="chk-qc-opt-diss" ${globalDiss ? 'checked' : ''} onchange="window.toggleQCOptionalTest('dissolution', this.checked)">
                <span>فحص الانحلالية (Dissolution)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.8rem;">
                <input type="checkbox" id="chk-qc-opt-unif" ${globalUnif ? 'checked' : ''} onchange="window.toggleQCOptionalTest('uniformity', this.checked)">
                <span>فحص تجانس المحتوى (Content Uniformity)</span>
              </label>
            </div>
          </div>
        `;
      }

      elQCGlobalConfigContainer.innerHTML = `
        <div class="coating-config-box" style="margin-bottom: 1.25rem; padding: 12px; border: 1px dashed var(--primary); border-radius: 6px; background: rgba(59, 130, 246, 0.02);">
          <h6 style="font-weight: bold; margin-bottom: 0.6rem; color: var(--primary); font-size: 0.85rem;">إعدادات تحاليل الجودة والفاعلية (QC Ingredients & Test Settings):</h6>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <label for="qc-active-ingredients-count" style="font-size: 0.82rem; color: #ffffff;">عدد المواد الفعالة في المستحضر:</label>
            <select id="qc-active-ingredients-count" onchange="window.changeIngredientsCount(this.value)" style="background: var(--bg-dark); color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; outline: none; cursor: pointer;">
              <option value="1" ${ingCount === 1 ? 'selected' : ''}>مادة فعالة واحدة (1)</option>
              <option value="2" ${ingCount === 2 ? 'selected' : ''}>مادتين (2)</option>
              <option value="3" ${ingCount === 3 ? 'selected' : ''}>ثلاث مواد (3)</option>
              <option value="4" ${ingCount === 4 ? 'selected' : ''}>أربع مواد (4)</option>
            </select>
          </div>
          ${optionalTestsHtml}
        </div>
      `;
    }

    const hasDissGlobal = Array.isArray(batch.active_qc_tests) ? batch.active_qc_tests.includes('dissolution') : true;
    const hasUnifGlobal = Array.isArray(batch.active_qc_tests) ? batch.active_qc_tests.includes('uniformity') : true;

    // Clear or Populate Coating Config Box dynamically
    if (elCoatingConfigContainer) {
      if (batch.isCoated) {
        const hasDiss = Array.isArray(batch.active_optional_tests) && batch.active_optional_tests.includes('coating_dissolution');
        const hasUnif = Array.isArray(batch.active_optional_tests) && batch.active_optional_tests.includes('coating_uniformity');
        
        let coatingCheckboxesHtml = '';
        if (hasDissGlobal) {
          coatingCheckboxesHtml += `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="chk-opt-diss" ${hasDiss ? 'checked' : ''} onchange="toggleCoatingOptionalTest('coating_dissolution', this.checked)">
              <span>إدراج فحص الانحلالية (Dissolution) بعد التلبيس</span>
            </label>
          `;
        }
        if (hasUnifGlobal) {
          coatingCheckboxesHtml += `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="chk-opt-unif" ${hasUnif ? 'checked' : ''} onchange="toggleCoatingOptionalTest('coating_uniformity', this.checked)">
              <span>إدراج فحص تجانس المحتوى (Content Uniformity) بعد التلبيس</span>
            </label>
          `;
        }

        if (coatingCheckboxesHtml) {
          elCoatingConfigContainer.innerHTML = `
            <div class="coating-config-box" style="margin-bottom: 1.25rem; padding: 12px; border: 1px dashed rgba(59, 130, 246, 0.4); border-radius: 6px; background: rgba(59, 130, 246, 0.04);">
              <h6 style="font-weight: bold; margin-bottom: 0.5rem; color: var(--cyan); font-size: 0.85rem;">تفعيل الفحوصات الاختيارية لمرحلة التلبيس (Coating Tests Checklist):</h6>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${coatingCheckboxesHtml}
              </div>
            </div>
          `;
        } else {
          elCoatingConfigContainer.innerHTML = '';
        }
      } else {
        elCoatingConfigContainer.innerHTML = '';
      }
    }

    // Clear or Populate Carry Over Config Box dynamically
    if (elCarryOverConfigContainer) {
      if (batch.carryOverKg > 0) {
        if (!Array.isArray(batch.active_carry_over_tests)) batch.active_carry_over_tests = [];
        const hasAssay = batch.active_carry_over_tests.includes('carry_assay');
        const hasDiss = batch.active_carry_over_tests.includes('carry_dissolution');
        const hasUnif = batch.active_carry_over_tests.includes('carry_uniformity');
        const hasMicro = batch.active_carry_over_tests.includes('carry_microbiology');

        let carryCheckboxesHtml = `
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
            <input type="checkbox" id="chk-carry-assay" ${hasAssay ? 'checked' : ''} onchange="toggleCarryOverOptionalTest('carry_assay', this.checked)">
            <span>إدراج فحص المعايرة (Assay) للكمية المنقولة</span>
          </label>
        `;
        if (hasDissGlobal) {
          carryCheckboxesHtml += `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="chk-carry-diss" ${hasDiss ? 'checked' : ''} onchange="toggleCarryOverOptionalTest('carry_dissolution', this.checked)">
              <span>إدراج فحص الانحلالية (Dissolution) للكمية المنقولة</span>
            </label>
          `;
        }
        if (hasUnifGlobal) {
          carryCheckboxesHtml += `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
              <input type="checkbox" id="chk-carry-unif" ${hasUnif ? 'checked' : ''} onchange="toggleCarryOverOptionalTest('carry_uniformity', this.checked)">
              <span>إدراج فحص تجانس المحتوى (Content Uniformity) للكمية المنقولة</span>
            </label>
          `;
        }
        carryCheckboxesHtml += `
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.82rem;">
            <input type="checkbox" id="chk-carry-micro" ${hasMicro ? 'checked' : ''} onchange="toggleCarryOverOptionalTest('carry_microbiology', this.checked)">
            <span>إدراج فحص الزرع الجرثومي (Microbiology) للكمية المنقولة</span>
          </label>
        `;

        elCarryOverConfigContainer.innerHTML = `
          <div class="coating-config-box" style="margin-bottom: 1.25rem; padding: 12px; border: 1px dashed rgba(245, 158, 11, 0.4); border-radius: 6px; background: rgba(245, 158, 11, 0.04);">
            <h6 style="font-weight: bold; margin-bottom: 0.5rem; color: var(--amber); font-size: 0.85rem;">تفعيل فحوصات الكمية المنقولة للـ QC (اختياري):</h6>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              ${carryCheckboxesHtml}
            </div>
          </div>
        `;
      } else {
        elCarryOverConfigContainer.innerHTML = '';
      }
    }

    let activeTests = [];
    if (stageId === 'preparation') {
      activeTests = ['assay'];
    } else if (stageId === 'compression' || stageId === 'filling') {
      if (form === 'solid' || form === 'capsule') {
        if (hasDissGlobal) activeTests.push('dissolution');
        if (hasUnifGlobal) activeTests.push('uniformity');
      } else if (form === 'suppository' || form === 'cream') {
        activeTests = ['microbiology'];
      }
    } else if (stageId === 'coating') {
      if (Array.isArray(batch.active_optional_tests)) {
        if (batch.active_optional_tests.includes('coating_dissolution') && hasDissGlobal) {
          activeTests.push('coating_dissolution');
        }
        if (batch.active_optional_tests.includes('coating_uniformity') && hasUnifGlobal) {
          activeTests.push('coating_uniformity');
        }
      }
    } else if (stageId === 'blistering' || stageId === 'packaging') {
      activeTests = ['microbiology'];
    }

    if (activeTests.length === 0) {
      elFormAddQCRun.style.display = 'none';
      if (elQCLotsCheckboxesContainer) {
        elQCLotsCheckboxesContainer.parentElement.style.display = 'none';
      }
    } else {
      elFormAddQCRun.style.display = 'block';
      if (elQCLotsCheckboxesContainer) {
        elQCLotsCheckboxesContainer.parentElement.style.display = 'block';
      }

      const testNamesMap = {
        assay: { title: 'فحص المعايرة الكيميائية (Assay)', rangePlaceholder: 'مثال: 95.0% - 105.0%', resultPlaceholder: 'مثال: 99.4%', rangeLabel: 'المجال المقبول للمعايرة (Assay Range)' },
        dissolution: { title: 'فحص الانحلالية (Dissolution)', rangePlaceholder: 'مثال: ≥ 75%', resultPlaceholder: 'مثال: 82.5%', rangeLabel: 'المجال المقبول للانحلالية (Dissolution Range)' },
        uniformity: { title: 'فحص تجانس المحتوى (Content Uniformity)', rangePlaceholder: 'مثال: 85.0% - 115.0%', resultPlaceholder: 'مثال: 101.2%', rangeLabel: 'المجال المقبول لتجانس المحتوى' },
        coating_dissolution: { title: 'فحص الانحلالية (Dissolution)', rangePlaceholder: 'مثال: ≥ 75%', resultPlaceholder: 'مثال: 82.5%', rangeLabel: 'المجال المقبول للانحلالية (Dissolution Range)' },
        coating_uniformity: { title: 'فحص تجانس المحتوى (Content Uniformity)', rangePlaceholder: 'مثال: 85.0% - 115.0%', resultPlaceholder: 'مثال: 101.2%', rangeLabel: 'المجال المقبول لتجانس المحتوى' },
        microbiology: { title: 'الزرع الجرثومي (Microbiology)' }
      };

      let containerHtml = '';
      activeTests.forEach(testType => {
        const metadata = testNamesMap[testType] || { title: testType };
        
        if (testType === 'microbiology') {
          containerHtml += `
            <div class="qc-test-row-container" style="margin-top: 1.25rem; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 1rem;">
              <h6 style="font-weight: bold; color: var(--cyan); margin-bottom: 0.5rem; font-size: 0.85rem;">${metadata.title}:</h6>
              <div class="form-group">
                <label for="input-qc-micro-status-${testType}">نتيجة فحص الزرع الجرثومي (Microbiology) *</label>
                <select id="input-qc-micro-status-${testType}" data-test-type="${testType}" class="qc-dynamic-micro-status" style="width: 100%; box-sizing: border-box;">
                  <option value="passed" selected>مطابق ومقبول (Passed) 🟢</option>
                  <option value="failed">غير مطابق / مرفوض (Failed) 🔴</option>
                </select>
              </div>
            </div>
          `;
        } else {
          const ingCount = parseInt(batch.active_ingredients_count, 10) || 1;
          containerHtml += `
            <div class="qc-test-row-container" style="margin-top: 1.25rem; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 1rem;">
              <h6 style="font-weight: bold; color: var(--cyan); margin-bottom: 0.5rem; font-size: 0.85rem;">${metadata.title}:</h6>
          `;
          for (let k = 1; k <= ingCount; k++) {
            const ingLabel = ingCount > 1 ? ` - المادة الفعالة ${k}` : '';
            containerHtml += `
              <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; display: grid; margin-bottom: 10px;">
                <div class="form-group">
                  <label for="input-qc-range-${testType}-${k}">${metadata.rangeLabel}${ingLabel} *</label>
                  <input type="text" id="input-qc-range-${testType}-${k}" data-test-type="${testType}" data-ing-idx="${k}" class="qc-dynamic-range" required placeholder="${metadata.rangePlaceholder}" style="width: 100%; box-sizing: border-box;">
                </div>
                <div class="form-group">
                  <label for="input-qc-result-${testType}-${k}">النتيجة الفعلية المكتشفة${ingLabel} *</label>
                  <input type="text" id="input-qc-result-${testType}-${k}" data-test-type="${testType}" data-ing-idx="${k}" class="qc-dynamic-result" required placeholder="${metadata.resultPlaceholder}" style="width: 100%; box-sizing: border-box;">
                </div>
              </div>
            `;
          }
          containerHtml += `</div>`;
        }
      });

      if (elQCDynamicTestsContainer) {
        elQCDynamicTestsContainer.innerHTML = containerHtml;
      }
      
      // Populate checkboxes for Lots
      if (elQCLotsCheckboxesContainer) {
        elQCLotsCheckboxesContainer.innerHTML = '';
        
        // Add "Select All" checkbox
        const selectAllLabel = document.createElement('label');
        selectAllLabel.className = 'qc-lots-checkbox-label';
        selectAllLabel.style.background = 'rgba(59, 130, 246, 0.12)';
        selectAllLabel.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        selectAllLabel.innerHTML = `
          <input type="checkbox" id="qc-select-all-lots" checked onchange="toggleSelectAllQCLots(this)">
          <span style="font-weight: bold; color: #60a5fa;">تحديد الكل (Select All)</span>
        `;
        elQCLotsCheckboxesContainer.appendChild(selectAllLabel);

        const lCountVal = Math.ceil(parseFloat(batch.lotsCount) || 1);
        for (let i = 1; i <= lCountVal; i++) {
          const lotName = `Lot ${i}`;
          const label = document.createElement('label');
          label.className = 'qc-lots-checkbox-label';
          label.innerHTML = `
            <input type="checkbox" name="qc-target-lot" value="${lotName}" checked>
            <span>${lotName}</span>
          `;
          elQCLotsCheckboxesContainer.appendChild(label);
        }

        if (batch.carryOverKg > 0) {
          const lotName = 'الكمية المنقولة';
          const label = document.createElement('label');
          label.className = 'qc-lots-checkbox-label';
          label.style.background = 'rgba(245, 158, 11, 0.12)';
          label.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          label.innerHTML = `
            <input type="checkbox" name="qc-target-lot" value="${lotName}" checked>
            <span style="color: var(--amber); font-weight: bold;">${lotName}</span>
          `;
          elQCLotsCheckboxesContainer.appendChild(label);
        }
      }
    }
  }



  async function handleQCSubmit(e) {
    e.preventDefault();
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch) return;

    const checkedBoxes = document.querySelectorAll('input[name="qc-target-lot"]:checked');
    const targetLots = Array.from(checkedBoxes).map(cb => cb.value);
    
    if (targetLots.length === 0) {
      alert('يرجى اختيار لوت واحد على الأقل لربطه بالفحص المخبري.');
      return;
    }

    const sample_no = elInputQCSampleNo ? elInputQCSampleNo.value.trim() : '';
    if (!sample_no) {
      alert('يرجى إدخال رقم عينة المختبر قبل الحفظ.');
      return;
    }

    // Get all active test types rendered in the dynamic container
    const activeTestTypes = new Set();
    document.querySelectorAll('#qc-dynamic-tests-container [data-test-type]').forEach(el => {
      activeTestTypes.add(el.getAttribute('data-test-type'));
    });

    if (activeTestTypes.size === 0) {
      alert('لا توجد فحوصات نشطة لحفظها.');
      return;
    }

    if (!Array.isArray(batch.qc_runs)) batch.qc_runs = [];
    if (!Array.isArray(batch.logs)) batch.logs = [];

    const testLabels = {
      assay: 'المعايرة (Assay)',
      dissolution: 'الانحلالية',
      uniformity: 'تجانس المحتوى',
      coating_dissolution: 'فحص الانحلالية',
      coating_uniformity: 'فحص تجانس المحتوى',
      microbiology: 'الزرع الجرثومي (Microbiology)'
    };

    let savedTestsCount = 0;
    let logSummaryParts = [];

    for (let test_type of activeTestTypes) {
      if (test_type === 'microbiology') {
        const microEl = document.getElementById(`input-qc-micro-status-${test_type}`);
        if (microEl) {
          const status = microEl.value;
          const newRun = {
            run_id: 'qc-run-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            stage_id: batch.stages[activeStageIndex].id,
            test_type,
            status,
            assay_val: null,
            qc_range: null,
            sample_no,
            timestamp: new Date().toLocaleString('ar-EG')
          };
          newRun.target_lots = targetLots;
          batch.qc_runs.push(newRun);
          savedTestsCount++;
          
          const label = testLabels[test_type] || test_type;
          logSummaryParts.push(`[${label}]: ${status === 'passed' ? 'مطابق 🟢' : 'غير مطابق 🔴'}`);
        }
      } else {
        const ingCount = parseInt(batch.active_ingredients_count, 10) || 1;
        const ingredientsData = [];
        let allPassed = true;
        let mainAssayVal = '';
        let mainQCRange = '';

        for (let k = 1; k <= ingCount; k++) {
          const rangeEl = document.getElementById(`input-qc-range-${test_type}-${k}`);
          const resultEl = document.getElementById(`input-qc-result-${test_type}-${k}`);
          if (rangeEl && resultEl) {
            const qc_range = rangeEl.value.trim();
            const assay_val = resultEl.value.trim();
            if (!qc_range || !assay_val) {
              alert(`يرجى تعبئة المجال والنتيجة للمادة الفعالة ${k} لفحص ${testLabels[test_type] || test_type}`);
              return;
            }
            const isCompliant = evaluateQCCompliance(qc_range, assay_val);
            if (!isCompliant) allPassed = false;
            ingredientsData.push({
              name: `المادة الفعالة ${k}`,
              qc_range,
              assay_val,
              status: isCompliant ? 'passed' : 'failed'
            });

            if (k === 1) {
              mainAssayVal = assay_val;
              mainQCRange = qc_range;
            }
          }
        }

        const newRun = {
          run_id: 'qc-run-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          stage_id: batch.stages[activeStageIndex].id,
          test_type,
          status: allPassed ? 'passed' : 'failed',
          assay_val: mainAssayVal,
          qc_range: mainQCRange,
          sample_no,
          timestamp: new Date().toLocaleString('ar-EG')
        };
        if (ingCount > 1) {
          newRun.ingredients = ingredientsData;
        }
        newRun.target_lots = targetLots;
        batch.qc_runs.push(newRun);
        savedTestsCount++;

        const label = testLabels[test_type] || test_type;
        if (ingCount > 1) {
          const statusText = allPassed ? 'مطابق 🟢' : 'غير مطابق 🔴';
          logSummaryParts.push(`[${label}]: ${statusText} لـ (${ingCount}) مواد فعالة`);
        } else {
          logSummaryParts.push(`[${label}]: نتيجة ${mainAssayVal} (${allPassed ? 'مطابق 🟢' : 'غير مطابق 🔴'})`);
        }
      }
    }

    if (savedTestsCount > 0) {
      batch.logs.unshift({
        time: new Date().toLocaleString('ar-EG'),
        text: `مراقبة الجودة (QC): تسجيل عينات (${sample_no}) للوتات (${targetLots.join(', ')}) بـ: ${logSummaryParts.join(' | ')}.`
      });

      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);

      // Clear dynamic inputs
      document.querySelectorAll('#qc-dynamic-tests-container input').forEach(inp => inp.value = '');
      if (elInputQCSampleNo) elInputQCSampleNo.value = '';

      // Refresh views
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
      renderHistoryList(batch);
      renderApp();

      if (window.showToast) {
        window.showToast('تم حفظ نتائج الفحوصات المخبرية بنجاح 🟢', 'success');
      } else {
        alert('تم حفظ نتائج الفحوصات المخبرية بنجاح 🟢');
      }
    }
  }

  window.toggleSelectAllQCLots = function(source) {
    const checkboxes = document.querySelectorAll('input[name="qc-target-lot"]');
    checkboxes.forEach(cb => {
      cb.checked = source.checked;
    });
  };

  window.toggleCoatingOptionalTest = function(testId, isEnabled) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch) return;
    if (!Array.isArray(batch.active_optional_tests)) batch.active_optional_tests = [];
    if (isEnabled) {
      if (!batch.active_optional_tests.includes(testId)) {
        batch.active_optional_tests.push(testId);
      }
    } else {
      batch.active_optional_tests = batch.active_optional_tests.filter(id => id !== testId);
    }
    batch.version = (batch.version || 0) + 1;
    batch.updatedAt = Date.now();
    saveBatches(true);
    renderQCLotsClearanceTable(batch);
    renderQCForm(batch);
  };

  window.changeIngredientsCount = function(count) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch) {
      batch.active_ingredients_count = parseInt(count, 10) || 1;
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      
      // Re-render QC components
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
      renderHistoryList(batch);
    }
  };

  window.toggleQCOptionalTest = function(testKey, isEnabled) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch) {
      if (!Array.isArray(batch.active_qc_tests)) {
        batch.active_qc_tests = ['dissolution', 'uniformity'];
      }
      if (isEnabled) {
        if (!batch.active_qc_tests.includes(testKey)) {
          batch.active_qc_tests.push(testKey);
        }
      } else {
        batch.active_qc_tests = batch.active_qc_tests.filter(k => k !== testKey);
      }
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      
      // Re-render QC components
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
      renderHistoryList(batch);
    }
  };

  window.toggleCarryOverOptionalTest = function(testId, isEnabled) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch) return;
    if (!Array.isArray(batch.active_carry_over_tests)) batch.active_carry_over_tests = [];
    if (isEnabled) {
      if (!batch.active_carry_over_tests.includes(testId)) {
        batch.active_carry_over_tests.push(testId);
      }
    } else {
      batch.active_carry_over_tests = batch.active_carry_over_tests.filter(id => id !== testId);
    }
    batch.version = (batch.version || 0) + 1;
    batch.updatedAt = Date.now();
    saveBatches(true);
    renderQCLotsClearanceTable(batch);
    renderQCForm(batch);
  };

  window.updateStageLoggerLimit = function() {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch) {
      renderStageLogger(batch);
    }
  };

  function renderQCRunsHistory(batch) {
    if (!elQCRunsLoggedList) return;
    elQCRunsLoggedList.innerHTML = '';
    
    if (!Array.isArray(batch.qc_runs) || batch.qc_runs.length === 0) {
      elQCRunsLoggedList.innerHTML = '<p class="text-dim" style="font-size: 0.8rem; margin: 0; padding: 5px;">لا توجد تحاليل مسجلة حالياً.</p>';
      return;
    }

    const testLabels = {
      assay: 'المعايرة (Assay)',
      dissolution: 'الانحلالية (Dissolution)',
      uniformity: 'تجانس المحتوى (Uniformity)',
      microbiology: 'الزرع الجرثومي (Microbiology)'
    };

    batch.qc_runs.forEach(run => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.style.borderRightColor = run.status === 'passed' ? 'var(--emerald)' : 'var(--rose)';
      item.style.padding = '0.5rem 0.8rem';
      item.style.marginBottom = '0.25rem';
      item.style.fontSize = '0.78rem';
      
      const testLabelsExt = {
        assay: 'المعايرة (Assay)',
        dissolution: 'الانحلالية بالضغط',
        uniformity: 'تجانس المحتوى بالضغط',
        coating_dissolution: 'فحص الانحلالية',
        coating_uniformity: 'فحص تجانس المحتوى',
        microbiology: 'الزرع الجرثومي (Microbiology)'
      };
      const testName = testLabelsExt[run.test_type] || run.test_type;
      const detailText = ((run.test_type === 'assay' || run.test_type === 'dissolution' || run.test_type === 'uniformity' || run.test_type === 'coating_dissolution' || run.test_type === 'coating_uniformity') && run.assay_val) ? ` (${run.assay_val}%)` : '';
      const sampleText = run.sample_no ? ` | عينة: ${run.sample_no}` : '';

      item.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <strong>${testName}${detailText}</strong>
          <span style="color: var(--text-dim); font-size: 0.72rem;">اللوتات: [${(run.target_lots || []).join(', ')}] | النتيجة: [${run.status === 'passed' ? 'مطابق 🟢' : 'غير مطابق 🔴'}]${sampleText}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: var(--text-dim); font-size: 0.72rem;">${run.timestamp || ''}</span>
          <button type="button" class="btn btn-secondary btn-sm" onclick="deleteQCRun('${run.run_id}')" style="color: var(--rose); border-color: rgba(244, 63, 94, 0.3); padding: 2px 6px; font-size: 0.7rem; display: flex; align-items: center; gap: 3px;">
            <i data-lucide="trash-2" style="width: 11px; height: 11px;"></i>
            <span>حذف</span>
          </button>
        </div>
      `;
      elQCRunsLoggedList.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  window.deleteQCRun = function(runId) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch || !Array.isArray(batch.qc_runs)) return;

    const runIndex = batch.qc_runs.findIndex(r => r.run_id === runId);
    if (runIndex === -1) return;

    const run = batch.qc_runs[runIndex];
    const testLabels = {
      assay: 'المعايرة (Assay)',
      dissolution: 'الانحلالية (Dissolution)',
      uniformity: 'تجانس المحتوى (Uniformity)',
      microbiology: 'الزرع الجرثومي (Microbiology)'
    };
    const testLabel = testLabels[run.test_type] || run.test_type;

    if (confirm(`هل أنت متأكد من حذف وتصحيح فحص [${testLabel}] للوتات (${run.target_lots.join(', ')})؟`)) {
      // Remove from array
      batch.qc_runs.splice(runIndex, 1);

      // Log this deletion
      if (!Array.isArray(batch.logs)) batch.logs = [];
      batch.logs.unshift({
        time: new Date().toLocaleString('en-US'),
        text: `تنبيه جودة (QC): قام المختبر بحذف وتصحيح فحص [${testLabel}] للوتات (${run.target_lots.join(', ')}).`
      });

      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);

      // Refresh views
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
      renderHistoryList(batch);
      renderApp();

      if (window.showToast) {
        window.showToast('تم حذف وتصحيح فحص المختبر بنجاح 🟢', 'success');
      }
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
