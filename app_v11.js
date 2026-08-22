/**
 * Main Application Logic for Pharma Production Tracker & Quarantine Inventory
 * Version 11 - Equipped with Throttled Conflict-Free Sync Engine & API Cache-Busting
 */

(function () {
  // Global override for parseFloat and parseInt to transparently support Arabic/Persian digits and decimals
  const _originalParseFloat = window.parseFloat;
  window.parseFloat = function(val) {
    if (typeof val === 'string') {
      val = val.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
               .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
               .replace(/،/g, '.')
               .replace(/,/g, '.');
    }
    return _originalParseFloat(val);
  };

  const _originalParseInt = window.parseInt;
  window.parseInt = function(val, radix) {
    if (typeof val === 'string') {
      val = val.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
               .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
               .replace(/،/g, '.')
               .replace(/,/g, '.');
    }
    return _originalParseInt(val, radix);
  };

  const MASTER_STORAGE_KEY = 'pharma_production_batches_master_v2';
  const WMS_STOCK_LOTS_KEY = 'pharma_wms_stock_lots_v1';
  const WMS_TRANSACTIONS_KEY = 'pharma_wms_transactions_v1';
  
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

  const DEFAULT_CLOUD_API = 'https://idm-production-c5174-default-rtdb.firebaseio.com/batches.json';
  let CLOUD_API_BASE = localStorage.getItem('pharma_production_server_url') || DEFAULT_CLOUD_API;

  // Helper to generate cache-busting cloud URL
  function getCloudUrl() {
    // If it's a Firebase URL, we append ?cb=Date.now(), else we check if it already has search params
    const separator = CLOUD_API_BASE.includes('?') ? '&' : '?';
    return `${CLOUD_API_BASE}${separator}cb=${Date.now()}`;
  }

  // Application State
  let batches = [];
  let stockLots = [];
  let wmsTransactions = [];
  let currentFormFilter = 'all';
  let searchQuery = '';
  let activeBatchId = null;
  let activeStageIndex = 0;
  let lastSyncHash = '';
  let isSavingToCloud = false;
  let isEditCorrectionMode = false;
  let currentViewMode = localStorage.getItem('pharma_view_mode') || 'grid';
  let currentUserRole = localStorage.getItem('current_user_role') || 'admin';
  let notificationsHistory = JSON.parse(localStorage.getItem('notifications_history') || '[]');
  
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
  const viewTabWarehouse = document.getElementById('view-tab-warehouse');
  const viewTabQC = document.getElementById('view-tab-qc');
  const viewTabActivity = document.getElementById('view-tab-activity');
  const viewProductionContainer = document.getElementById('view-production-container');
  const viewWarehouseContainer = document.getElementById('view-warehouse-container');
  const viewQCContainer = document.getElementById('view-qc-container');
  const viewActivityContainer = document.getElementById('view-activity-container');

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
  const inputSecondaryPackQty = document.getElementById('input-secondary-pack-qty');
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
  const detailTotalBoxes = document.getElementById('detail-total-boxes');
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

  // Role Switcher Controls
  const btnRoleSwitcher = document.getElementById('btn-role-switcher');
  const roleSwitcherText = document.getElementById('role-switcher-text');
  const modalRoleSwitcher = document.getElementById('modal-role-switcher');
  const closeRoleSwitcherModal = document.getElementById('close-role-switcher-modal');
  const cancelRoleSwitcherModal = document.getElementById('cancel-role-switcher-modal');
  const selectUserRole = document.getElementById('select-user-role');
  const inputRolePin = document.getElementById('input-role-pin');
  const btnSaveRoleSelection = document.getElementById('btn-save-role-selection');

  // Notifications Drawer Controls
  const btnNotificationsDrawer = document.getElementById('btn-notifications-drawer');
  const notificationsBadge = document.getElementById('notifications-badge');
  const drawerNotifications = document.getElementById('drawer-notifications');
  const closeNotificationsDrawer = document.getElementById('close-notifications-drawer');
  const notificationsDrawerList = document.getElementById('notifications-drawer-list');
  const btnClearNotifications = document.getElementById('btn-clear-notifications');
  const notificationsHistoryCount = document.getElementById('notifications-history-count');

  // Weighing Formulation elements
  const elWeighingFormulationContainer = document.getElementById('weighing-formulation-container');
  const elWeighingFormulationTbody = document.getElementById('weighing-formulation-tbody');
  const btnAddFormulationRow = document.getElementById('btn-add-formulation-row');

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
    loadWMSLocal();
    userActivityLogs = JSON.parse(localStorage.getItem('pharma_user_activity_logs')) || [];
    setupEventListeners();
    setupQCEventListeners();
    setupTraceEventListeners();
    renderApp();

    // Start Throttled Sync Engine (Sync every 8 seconds to prevent rate limits)
    syncFromCloud();
    setInterval(syncFromCloud, 8000);

    window.addEventListener('focus', () => {
      syncFromCloud();
    });

    startQCUnreleasedNotifier();


  }

  function startQCUnreleasedNotifier() {
    function checkAndNotify() {
      if (currentUserRole !== 'qc' && currentUserRole !== 'admin') return;
      if (!Array.isArray(stockLots)) return;

      const unreleased = stockLots.filter(l => l && l.Status === 'Quarantine');
      if (unreleased.length === 0) return;

      unreleased.forEach(lot => {
        const msg = `تنبيه الجودة (QC) 🔒: لوت المواد الخام [${lot.Lot_Number}] للمادة [${lot.Material_Name}] غير مفرج عنه (محجور) وبانتظار التخليص!`;
        
        notificationsHistory.unshift({
          text: msg,
          timestamp: new Date().toLocaleTimeString('en-US'),
          unread: true
        });

        if (window.showToast) {
          window.showToast(msg, 'warning', 10000);
        }
      });

      playNotificationSound();
    }

    setTimeout(checkAndNotify, 4000);
    setInterval(checkAndNotify, 15 * 60 * 1000);
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
          migrateBatchesVisualInspection();
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
      migrateBatchesVisualInspection();
      localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
      return;
    }

    batches = [...window.DEFAULT_BATCHES];
    sanitizeBatchesCoatingName(batches);
    migrateBatchesVisualInspection();
  }

  function migrateBatchesVisualInspection() {
    let modified = false;
    batches.forEach(batch => {
      if (!batch || !Array.isArray(batch.stages)) return;
      const hasVisual = batch.stages.some(s => s && s.id === 'visual_inspection');
      if (!hasVisual) {
        batch.stages.push({
          id: 'visual_inspection',
          name: 'الفحص العيني',
          status: 'pending',
          doneKg: 0,
          acceptedKg: 0,
          rejectedKg: 0,
          acceptedBlisters: 0,
          rejectedBlisters: 0,
          yieldPercent: 0
        });
        modified = true;
      }
    });
    if (modified) {
      localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
    }
  }

  function saveBatches(triggerCloudUpload = true) {
    sanitizeBatchesCoatingName(batches);
    localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
    if (triggerCloudUpload) {
      pushToCloud(true); // Force push immediately for user actions
    }
  }

  function loadWMSLocal() {
    const savedLots = localStorage.getItem(WMS_STOCK_LOTS_KEY);
    if (savedLots) {
      try {
        stockLots = JSON.parse(savedLots);
      } catch (e) {}
    }
    const savedTx = localStorage.getItem(WMS_TRANSACTIONS_KEY);
    if (savedTx) {
      try {
        wmsTransactions = JSON.parse(savedTx);
      } catch (e) {}
    }
  }

  function saveWMS(triggerCloudUpload = true) {
    localStorage.setItem(WMS_STOCK_LOTS_KEY, JSON.stringify(stockLots));
    localStorage.setItem(WMS_TRANSACTIONS_KEY, JSON.stringify(wmsTransactions));
    if (triggerCloudUpload) {
      pushToCloud(true);
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

  function mergeStockLots(localLots, cloudLots) {
    const mergedMap = new Map();
    cloudLots.forEach(lot => {
      if (lot && lot.Lot_ID) {
        mergedMap.set(String(lot.Lot_ID), lot);
      }
    });
    localLots.forEach(lot => {
      if (lot && lot.Lot_ID) {
        const existing = mergedMap.get(String(lot.Lot_ID));
        if (!existing || (lot.updatedAt || 0) > (existing.updatedAt || 0)) {
          mergedMap.set(String(lot.Lot_ID), lot);
        }
      }
    });
    return Array.from(mergedMap.values());
  }

  function mergeTransactions(localTx, cloudTx) {
    const mergedMap = new Map();
    cloudTx.forEach(tx => {
      if (tx && tx.Tx_ID) {
        mergedMap.set(String(tx.Tx_ID), tx);
      }
    });
    localTx.forEach(tx => {
      if (tx && tx.Tx_ID) {
        mergedMap.set(String(tx.Tx_ID), tx);
      }
    });
    return Array.from(mergedMap.values()).sort((a, b) => (a.Timestamp || 0) - (b.Timestamp || 0));
  }

  function mergeNotifications(local, cloud) {
    if (!Array.isArray(local)) local = [];
    if (!Array.isArray(cloud)) cloud = [];

    const map = new Map();
    cloud.forEach(n => {
      if (n && n.text && n.timestamp) map.set(`${n.text}-${n.timestamp}`, n);
    });
    local.forEach(n => {
      if (n && n.text && n.timestamp) map.set(`${n.text}-${n.timestamp}`, n);
    });
    return Array.from(map.values());
  }

  function mergeActivityLogs(localLogs, cloudLogs) {
    if (!Array.isArray(localLogs)) localLogs = [];
    if (!Array.isArray(cloudLogs)) cloudLogs = [];
    const seen = new Set();
    const merged = [];

    const addLog = log => {
      if (!log) return;
      const key = `${log.timestamp}-${log.actionType}-${log.details}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(log);
      }
    };

    localLogs.forEach(addLog);
    cloudLogs.forEach(addLog);

    merged.sort((a, b) => {
      const da = new Date(a.timestamp);
      const db = new Date(b.timestamp);
      if (!isNaN(da) && !isNaN(db)) {
        return db - da;
      }
      return 0;
    });

    return merged.slice(0, 1000);
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
        } else {
          let cloudBatches = [];
          let cloudLots = [];
          let cloudTx = [];
          let cloudNotifications = [];
          let cloudActivityLogs = [];

          if (Array.isArray(cloudData)) {
            cloudBatches = cloudData;
          } else if (cloudData && typeof cloudData === 'object') {
            cloudBatches = cloudData.batches || [];
            cloudLots = cloudData.stock_lots || [];
            cloudTx = cloudData.transactions || [];
            cloudNotifications = cloudData.notifications || [];
            cloudActivityLogs = cloudData.activity_logs || [];
          }

          if (Array.isArray(cloudBatches)) {
            const mergedList = mergeBatches(batches, cloudBatches);
            sanitizeBatchesCoatingName(mergedList);

            const mergedLots = mergeStockLots(stockLots, cloudLots);
            const mergedTx = mergeTransactions(wmsTransactions, cloudTx);
            const mergedNotifications = mergeNotifications(notificationsHistory, cloudNotifications);
            const mergedLogs = mergeActivityLogs(userActivityLogs, cloudActivityLogs);

            const currentLocalHash = JSON.stringify({ batches, stockLots, wmsTransactions, notifications: notificationsHistory, activity_logs: userActivityLogs });
            const mergedHash = JSON.stringify({ batches: mergedList, stock_lots: mergedLots, transactions: mergedTx, notifications: mergedNotifications, activity_logs: mergedLogs });

            if (currentLocalHash !== mergedHash) {
              // Find what changed to show notification toast messages
              const oldBatchesMap = new Map();
              batches.forEach(b => {
                if (b && b.id) oldBatchesMap.set(String(b.id), b);
              });

              const notificationsToShow = [];

              mergedList.forEach(nb => {
                if (!nb || nb.deleted === true) return;
                const ob = oldBatchesMap.get(String(nb.id));
                if (!ob) {
                  // New batch added
                  notificationsToShow.push(`🆕 تم إضافة تشغيلة جديدة: ${nb.productName} (رقم ${nb.batchNo})`);
                } else if ((nb.version || 0) > (ob.version || 0)) {
                  // Batch updated. Let's look at new logs
                  const newLogsCount = (nb.logs || []).length - (ob.logs || []).length;
                  if (newLogsCount > 0) {
                    for (let i = 0; i < newLogsCount; i++) {
                      const log = nb.logs[i];
                      if (log && log.text) {
                        notificationsToShow.push(`🔔 ${log.text}`);
                      }
                    }
                  } else {
                    // General update
                    notificationsToShow.push(`🔄 تم تحديث بيانات التشغيلة: ${nb.productName} (رقم ${nb.batchNo})`);
                  }
                }
              });

              // Check for deleted batches
              batches.forEach(ob => {
                if (!ob || ob.deleted === true) return;
                const nb = mergedList.find(b => b && String(b.id) === String(ob.id));
                if (!nb || nb.deleted === true) {
                  notificationsToShow.push(`🗑️ تم حذف/إلغاء التشغيلة: ${ob.productName} (رقم ${ob.batchNo})`);
                }
              });

              const oldNotificationKeys = new Set(notificationsHistory.map(n => `${n.text}-${n.timestamp}`));
              let playNewNotifSound = false;

              mergedNotifications.forEach(n => {
                const key = `${n.text}-${n.timestamp}`;
                if (!oldNotificationKeys.has(key)) {
                  // Only show toast and play sound for notifications not generated by this device
                  if (window.showToast) {
                    window.showToast(n.text, 'warning', 8000);
                  }
                  playNewNotifSound = true;
                }
              });

              batches = mergedList;
              stockLots = mergedLots;
              wmsTransactions = mergedTx;
              notificationsHistory = mergedNotifications;
              userActivityLogs = mergedLogs;

              localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
              localStorage.setItem(WMS_STOCK_LOTS_KEY, JSON.stringify(stockLots));
              localStorage.setItem(WMS_TRANSACTIONS_KEY, JSON.stringify(wmsTransactions));
              localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
              localStorage.setItem('pharma_user_activity_logs', JSON.stringify(userActivityLogs));
              updateNotificationsBadge();

              if (playNewNotifSound) {
                playNotificationSound();
              }

              renderApp();

              if (typeof renderWMSViews === 'function') {
                renderWMSViews();
              }

              if (activeBatchId) {
                const activeBatch = batches.find(b => b && String(b.id) === String(activeBatchId));
                if (activeBatch) {
                  renderWorkflowTimeline(activeBatch);
                  const isEditingForm = formUpdateStage && formUpdateStage.contains(document.activeElement);
                  if (!isEditingForm) {
                    renderStageLogger(activeBatch);
                  }
                  renderHistoryList(activeBatch);
                } else {
                  closeBatchDetailModal();
                }
              }

              // Show toast notifications
              let soundPlayed = false;
              notificationsToShow.reverse().forEach(msg => {
                // Push to history
                notificationsHistory.unshift({
                  text: msg,
                  timestamp: new Date().toLocaleTimeString('en-US'),
                  unread: true
                });

                if (window.showToast) {
                  window.showToast(msg, 'info', 6000);
                }
                
                if (!soundPlayed) {
                  playNotificationSound();
                  soundPlayed = true; // only play sound once per sync cycle to avoid noise
                }
              });

              if (notificationsToShow.length > 0) {
                localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
                updateNotificationsBadge();
                if (drawerNotifications && !drawerNotifications.classList.contains('hidden')) {
                  renderNotificationsDrawer();
                }
              }
            }

            // No auto-push on background sync to prevent HTTP 429 Rate Limits.
            // Pushes only happen when the user performs a local action (add, edit, delete, restore).

            lastSyncHash = mergedHash;
            updateSyncStatusLabel(true);
          }
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
    const payload = { batches: batches, stock_lots: stockLots, transactions: wmsTransactions, notifications: notificationsHistory, activity_logs: userActivityLogs };
    lastSyncHash = JSON.stringify({ batches: batches, stock_lots: stockLots, transactions: wmsTransactions, notifications: notificationsHistory, activity_logs: userActivityLogs });
    if (syncText) syncText.textContent = 'جاري رفع وتكامل البيانات سحابياً... 🔄';

    try {
      const response = await fetch(CLOUD_API_BASE, {
        method: 'PUT',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
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
    updateRoleSwitcherButtonText();
    updateNotificationsBadge();

    // Toggle add batch button visibility
    const btnNewBatch = document.getElementById('btn-new-batch');
    if (btnNewBatch) {
      if (currentUserRole === 'admin' || currentUserRole === 'production') {
        btnNewBatch.classList.remove('hidden');
      } else {
        btnNewBatch.classList.add('hidden');
      }
    }

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
                ${(currentUserRole === 'admin' || currentUserRole === 'production') ? `
                <button class="btn btn-secondary btn-sm" onclick="deleteBatch('${batch.id}')" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--rose); color: var(--rose);">
                  <i data-lucide="trash-2" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
                  <span style="vertical-align: middle;">حذف</span>
                </button>
                ` : ''}
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
              ${(currentUserRole === 'admin' || currentUserRole === 'production') ? `
              <button class="btn-icon-delete" title="إلغاء وحذف الباتش" onclick="event.stopPropagation(); deleteBatch('${batch.id}');">
                <i data-lucide="trash-2"></i>
              </button>
              ` : ''}
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
    // System settings dropdown toggle
    const btnSettingsDropdown = document.getElementById('btn-settings-dropdown');
    const settingsDropdownMenu = document.getElementById('settings-dropdown-menu');
    if (btnSettingsDropdown && settingsDropdownMenu) {
      btnSettingsDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdownMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', () => {
        settingsDropdownMenu.classList.add('hidden');
      });
    }

    window.openBatchDetail = openBatchDetail;
    if (btnExportBackup) btnExportBackup.addEventListener('click', exportBackupData);
    if (btnImportBackup) btnImportBackup.addEventListener('click', () => inputBackupFile.click());
    if (inputBackupFile) inputBackupFile.addEventListener('change', importBackupData);

    function switchViewTab(activeTabId) {
      const tabsInfo = [
        { id: 'view-tab-production', btn: viewTabProduction, container: viewProductionContainer },
        { id: 'view-tab-warehouse', btn: viewTabWarehouse, container: viewWarehouseContainer },
        { id: 'view-tab-qc', btn: viewTabQC, container: viewQCContainer },
        { id: 'view-tab-activity', btn: viewTabActivity, container: viewActivityContainer }
      ];

      tabsInfo.forEach(t => {
        if (!t.btn) return;
        if (t.id === activeTabId) {
          t.btn.style.background = 'var(--primary)';
          t.btn.style.borderColor = 'var(--primary)';
          t.btn.style.color = '#fff';
          if (t.container) t.container.classList.remove('hidden');
        } else {
          t.btn.style.background = 'transparent';
          t.btn.style.borderColor = 'rgba(255,255,255,0.15)';
          t.btn.style.color = 'var(--text-dim)';
          if (t.container) t.container.classList.add('hidden');
        }
      });

      // Show production stats cards only in production view
      const prodStats = document.querySelector('.stats-grid');
      if (prodStats) {
        if (activeTabId === 'view-tab-production') {
          prodStats.classList.remove('hidden');
        } else {
          prodStats.classList.add('hidden');
        }
      }

      if (activeTabId === 'view-tab-warehouse') {
        renderWMSViews();
      } else if (activeTabId === 'view-tab-qc') {
        renderQCViews();
      } else if (activeTabId === 'view-tab-activity') {
        renderActivityLogsView();
      }
    }

    if (viewTabProduction) viewTabProduction.addEventListener('click', () => switchViewTab('view-tab-production'));
    if (viewTabWarehouse) viewTabWarehouse.addEventListener('click', () => switchViewTab('view-tab-warehouse'));
    if (viewTabQC) viewTabQC.addEventListener('click', () => switchViewTab('view-tab-qc'));
    if (viewTabActivity) viewTabActivity.addEventListener('click', () => switchViewTab('view-tab-activity'));

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

    const btnWeightAddendum = document.getElementById('btn-weight-addendum');
    const modalWeightAddendum = document.getElementById('modal-weight-addendum');
    const closeWeightAddendumModal = document.getElementById('close-weight-addendum-modal');
    const btnCancelWeightAddendum = document.getElementById('btn-cancel-weight-addendum');
    const formWeightAddendum = document.getElementById('form-weight-addendum');
    const addendumProductName = document.getElementById('addendum-product-name');
    const addendumBatchNo = document.getElementById('addendum-batch-no');
    const addendumLotSearch = document.getElementById('addendum-lot-search');
    const addendumLotId = document.getElementById('addendum-lot-id');
    const addendumLotDropdown = document.getElementById('addendum-lot-dropdown');
    const addendumQty = document.getElementById('addendum-qty');
    const addendumUnit = document.getElementById('addendum-unit');

    if (btnWeightAddendum && modalWeightAddendum) {
      btnWeightAddendum.addEventListener('click', () => {
        if (currentUserRole !== 'admin') {
          alert('عذراً، هذا الإجراء مخصص لمدير النظام فقط.');
          return;
        }
        const batch = batches.find(b => String(b.id) === String(activeBatchId));
        if (!batch) return;

        // Set batch info
        if (addendumProductName) addendumProductName.textContent = batch.productName;
        if (addendumBatchNo) addendumBatchNo.textContent = batch.batchNo;

        // Reset inputs
        if (addendumLotSearch) addendumLotSearch.value = '';
        if (addendumLotId) addendumLotId.value = '';
        if (addendumQty) addendumQty.value = '';
        if (addendumUnit) addendumUnit.value = 'kg';
        if (addendumLotDropdown) addendumLotDropdown.classList.add('hidden');

        // Show modal
        modalWeightAddendum.classList.remove('hidden');
      });
    }

    // Close listeners
    const hideWeightAddendumModal = () => {
      if (modalWeightAddendum) modalWeightAddendum.classList.add('hidden');
    };
    if (closeWeightAddendumModal) closeWeightAddendumModal.addEventListener('click', hideWeightAddendumModal);
    if (btnCancelWeightAddendum) btnCancelWeightAddendum.addEventListener('click', hideWeightAddendumModal);

    // Searchable lot selection logic for weight addendum modal
    if (addendumLotSearch && addendumLotDropdown) {
      const isRawMaterial = lot => {
        if (!lot || !lot.Unit) return false;
        const u = lot.Unit.toLowerCase();
        return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
      };

      function populateAddendumDropdown(query = '') {
        addendumLotDropdown.innerHTML = '';
        const releasedRawLots = stockLots.filter(lot => {
          if (!lot) return false;
          if (lot.Status !== 'Released') return false;
          if (lot.Current_Qty <= 0) return false;
          const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
          return type === 'raw';
        });

        const filtered = releasedRawLots.filter(lot => {
          const text = `${lot.Material_Name} ${lot.Material_Code} ${lot.Lot_Number}`.toLowerCase();
          return text.includes(query.toLowerCase());
        });

        if (filtered.length === 0) {
          addendumLotDropdown.innerHTML = '<div style="padding: 8px; color: var(--text-dim); text-align: center; font-size: 0.8rem;">لا توجد لوتات مفرجة مطابقة للبحث</div>';
          return;
        }

        filtered.forEach(lot => {
          const item = document.createElement('div');
          item.style.padding = '8px';
          item.style.cursor = 'pointer';
          item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
          item.style.fontSize = '0.78rem';
          item.style.transition = 'background 0.2s';
          item.innerHTML = `<strong>${lot.Material_Name}</strong> <span style="color: var(--text-dim);">[Code: ${lot.Material_Code}]</span><br><span style="color: var(--amber);">Lot: ${lot.Lot_Number}</span> <span style="color: var(--emerald); float: left;">الرصيد: ${lot.Current_Qty} ${lot.Unit}</span>`;
          
          item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(6, 182, 212, 0.15)';
          });
          item.addEventListener('mouseleave', () => {
            item.style.background = '';
          });

          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            addendumLotSearch.value = `${lot.Material_Name} [Code: ${lot.Material_Code}] - L: ${lot.Lot_Number} (الرصيد: ${lot.Current_Qty} ${lot.Unit})`;
            if (addendumLotId) addendumLotId.value = lot.Lot_ID;
            addendumLotDropdown.classList.add('hidden');
          });

          addendumLotDropdown.appendChild(item);
        });
      }

      addendumLotSearch.addEventListener('focus', () => {
        addendumLotDropdown.classList.remove('hidden');
        populateAddendumDropdown(addendumLotSearch.value);
      });

      addendumLotSearch.addEventListener('blur', () => {
        setTimeout(() => {
          addendumLotDropdown.classList.add('hidden');
        }, 200);
      });

      addendumLotSearch.addEventListener('input', (e) => {
        if (addendumLotId) addendumLotId.value = '';
        addendumLotDropdown.classList.remove('hidden');
        populateAddendumDropdown(e.target.value);
      });
    }

    // Submit handler for weight addendum modal
    if (formWeightAddendum) {
      formWeightAddendum.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const lotId = addendumLotId ? addendumLotId.value : '';
        const qtyVal = parseFloat(addendumQty.value) || 0;
        const unitVal = addendumUnit.value || 'kg';

        if (!lotId || qtyVal <= 0) {
          alert('يرجى اختيار مادة صالحة وتحديد كمية أكبر من الصفر!');
          return;
        }

        const batch = batches.find(b => String(b.id) === String(activeBatchId));
        if (!batch) return;
        const weighingStage = batch.stages && batch.stages[0];
        if (!weighingStage) return;

        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
        if (!lot) {
          alert('اللوت المرتبط بهذه المادة غير موجود بالمستودع!');
          return;
        }

        const addedQtyInKg = unitVal === 'g' ? (qtyVal / 1000) : qtyVal;
        const isLotInGrams = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
        const lotQtyInKg = isLotInGrams ? (lot.Current_Qty / 1000) : lot.Current_Qty;

        if (addedQtyInKg > lotQtyInKg) {
          const displayMax = lotQtyInKg * (unitVal === 'g' ? 1000 : 1);
          alert(`الرصيد المتاح في المخزن لهذه المادة هو ${displayMax.toFixed(3)} ${unitVal} فقط. لا يمكن صرف ${qtyVal} ${unitVal}!`);
          return;
        }

        // Deduct stock
        const dispenseQty = isLotInGrams ? (addedQtyInKg * 1000) : addedQtyInKg;
        lot.Current_Qty = parseFloat((lot.Current_Qty - dispenseQty).toFixed(3));
        lot.updatedAt = Date.now();

        // Update formulation
        if (!Array.isArray(weighingStage.formulation)) weighingStage.formulation = [];
        const existingRow = weighingStage.formulation.find(row => String(row.Lot_ID || row.lotId) === String(lot.Lot_ID));
        if (existingRow) {
          const oldQty = existingRow.Quantity || existingRow.qty || 0;
          existingRow.Quantity = parseFloat((oldQty + addedQtyInKg).toFixed(3));
          existingRow.qty = existingRow.Quantity;
          existingRow.userQty = existingRow.Quantity * (existingRow.userUnit === 'g' ? 1000 : 1);
        } else {
          weighingStage.formulation.push({
            Lot_ID: lot.Lot_ID,
            lotId: lot.Lot_ID,
            Quantity: addedQtyInKg,
            qty: addedQtyInKg,
            userQty: qtyVal,
            userUnit: unitVal
          });
        }

        weighingStage.acceptedKg = parseFloat(((weighingStage.acceptedKg || 0) + addedQtyInKg).toFixed(3));
        weighingStage.doneKg = weighingStage.acceptedKg;
        if (weighingStage.doneKg > 0 && weighingStage.status === 'pending') {
          weighingStage.status = 'in_progress';
        }

        // Transaction log
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: lot.Lot_ID,
          Tx_Type: 'Dispense_Production',
          Quantity: -addedQtyInKg,
          Reference_ID: `ملحق صرف إضافي (Admin) لتشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });

        if (!Array.isArray(batch.logs)) batch.logs = [];
        batch.logs.unshift({
          time: new Date().toLocaleString('en-US'),
          text: `صرف ملحق وزن إضافي (بواسطة المشرف 👑): إضافة ${qtyVal} ${unitVal} للمادة [${lot.Material_Name}] (الباتش: ${lot.Lot_Number}).`
        });

        saveWMS();
        batch.version = (batch.version || 0) + 1;
        batch.updatedAt = Date.now();
        saveBatches(true);

        hideWeightAddendumModal();
        renderWorkflowTimeline(batch);
        renderStageLogger(batch);
        renderHistoryList(batch);
        renderWeighingInvoice(batch);
        renderApp();

        if (window.showToast) {
          window.showToast('تمت إضافة ملحق الوزن بنجاح وخصم الرصيد من المستودع ⚖️🟢', 'success');
        } else {
          alert('تمت إضافة ملحق الوزن بنجاح وخصم الرصيد من المستودع ⚖️🟢');
        }
      });
    }

    // Visual Inspection Attachment change listener
    const visualReleaseFileInput = document.getElementById('visual-release-attachment-file');
    if (visualReleaseFileInput) {
      visualReleaseFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 1024 * 1024) {
          alert('حجم الملف المرفق أكبر من 1MB! يرجى اختيار ملف أصغر حجماً لتفادي امتلاء الذاكرة.');
          visualReleaseFileInput.value = '';
          return;
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
          const batch = batches.find(b => String(b.id) === String(activeBatchId));
          if (!batch || !batch.stages) return;
          const stage = batch.stages[activeStageIndex];
          if (stage && stage.id === 'visual_inspection') {
            stage.releaseCertificate = {
              name: file.name,
              type: file.type,
              size: (file.size / 1024).toFixed(1) + ' KB',
              data: evt.target.result
            };
            batch.version = (batch.version || 0) + 1;
            batch.updatedAt = Date.now();
            saveBatches(true);
            renderStageLogger(batch);
          }
        };
        reader.readAsDataURL(file);
      });
    }

    // Admin Edit Batch Modal listeners
    const btnEditBatch = document.getElementById('btn-edit-batch');
    const modalEditBatch = document.getElementById('modal-edit-batch');
    const closeEditBatchModalBtn = document.getElementById('close-edit-batch-modal');
    const cancelEditBatchBtn = document.getElementById('btn-cancel-edit-batch');
    const formEditBatch = document.getElementById('form-edit-batch');

    const closeEditBatchModal = () => {
      if (modalEditBatch) modalEditBatch.classList.add('hidden');
    };

    if (btnEditBatch) {
      btnEditBatch.addEventListener('click', () => {
        const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
        if (!batch) return;

        // Populate form
        document.getElementById('edit-batch-id').value = batch.id;
        document.getElementById('edit-batch-product-name').value = batch.productName || '';
        document.getElementById('edit-batch-number').value = batch.batchNo || '';
        document.getElementById('edit-batch-pharma-form').value = batch.pharmaForm || 'solid';
        document.getElementById('edit-batch-total-weight').value = batch.totalWeightKg || '';
        document.getElementById('edit-batch-prior-no').value = batch.priorBatchNo || '';
        document.getElementById('edit-batch-carry-over').value = batch.carryOverKg || 0;
        document.getElementById('edit-batch-units-per-blister').value = batch.unitsPerBlister || '';
        document.getElementById('edit-batch-secondary-pack').value = batch.secondaryPackQty || '';
        document.getElementById('edit-batch-exp-date').value = batch.expDate || '';

        // Dynamically adjust labels for pharma form
        const adjustEditLabels = () => {
          const form = document.getElementById('edit-batch-pharma-form').value;
          const term = getTerminology(form);
          document.getElementById('edit-label-units-per-blister').textContent = `عدد الحبات بـ ${term.unitName} (${term.packName}) *`;
          document.getElementById('edit-label-secondary-pack').textContent = `التغليف الثانوي (${term.packPlural} بالكرتونة) *`;
        };
        adjustEditLabels();
        document.getElementById('edit-batch-pharma-form').addEventListener('change', adjustEditLabels);

        if (modalEditBatch) modalEditBatch.classList.remove('hidden');
      });
    }

    if (closeEditBatchModalBtn) closeEditBatchModalBtn.addEventListener('click', closeEditBatchModal);
    if (cancelEditBatchBtn) cancelEditBatchBtn.addEventListener('click', closeEditBatchModal);

    if (formEditBatch) {
      formEditBatch.addEventListener('submit', (e) => {
        e.preventDefault();
        const batchId = document.getElementById('edit-batch-id').value;
        const batch = batches.find(b => b && String(b.id) === String(batchId));
        if (!batch) return;

        const oldName = batch.productName;
        const oldNo = batch.batchNo;

        // Save properties
        batch.productName = document.getElementById('edit-batch-product-name').value.trim();
        batch.batchNo = document.getElementById('edit-batch-number').value.trim();
        batch.pharmaForm = document.getElementById('edit-batch-pharma-form').value;
        batch.totalWeightKg = parseFloat(document.getElementById('edit-batch-total-weight').value) || 0;
        batch.priorBatchNo = document.getElementById('edit-batch-prior-no').value.trim();
        batch.carryOverKg = parseFloat(document.getElementById('edit-batch-carry-over').value) || 0;
        batch.unitsPerBlister = parseInt(document.getElementById('edit-batch-units-per-blister').value, 10) || 1;
        batch.secondaryPackQty = parseInt(document.getElementById('edit-batch-secondary-pack').value, 10) || 1;
        batch.expDate = document.getElementById('edit-batch-exp-date').value.trim();
        batch.updatedAt = Date.now();
        batch.version = (batch.version || 0) + 1;

        // Save
        localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));

        // Create broadcast notification
        if (!Array.isArray(notificationsHistory)) notificationsHistory = [];
        notificationsHistory.unshift({
          id: 'notif-' + Date.now(),
          title: 'تعديل مواصفات تشغيلة 📢',
          body: `قام الأدمن بتعديل إعدادات ومواصفات التشغيلة [${batch.productName}] (رقم الباتش: ${batch.batchNo}). يرجى أخذ العلم بكافة الدوائر.`,
          timestamp: Date.now(),
          isRead: false
        });
        localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notificationsHistory));
        if (typeof updateNotificationsUI === 'function') updateNotificationsUI();

        // Log user activity
        logUserActivity('تعديل إضبارة', `قام الأدمن بتعديل مواصفات التشغيلة [${batch.productName}] (رقم الباتش: ${batch.batchNo}) من المسميات السابقة (${oldName} - #${oldNo}).`);

        closeEditBatchModal();
        closeBatchDetailModal();
        renderApp();

        if (window.showToast) {
          window.showToast(`تم تعديل التشغيلة بنجاح وبث التنبيه 📢`, 'success');
        }
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

    // Role Switcher Modal Event Listeners
    if (btnRoleSwitcher) {
      btnRoleSwitcher.addEventListener('click', () => {
        if (modalRoleSwitcher) {
          if (selectUserRole) selectUserRole.value = currentUserRole;
          if (inputRolePin) inputRolePin.value = '';
          modalRoleSwitcher.classList.remove('hidden');
        }
      });
    }

    if (closeRoleSwitcherModal) {
      closeRoleSwitcherModal.addEventListener('click', () => {
        if (modalRoleSwitcher) modalRoleSwitcher.classList.add('hidden');
      });
    }

    if (cancelRoleSwitcherModal) {
      cancelRoleSwitcherModal.addEventListener('click', () => {
        if (modalRoleSwitcher) modalRoleSwitcher.classList.add('hidden');
      });
    }

    if (btnSaveRoleSelection) {
      btnSaveRoleSelection.addEventListener('click', handleSaveRoleSelection);
    }

    // Notifications Drawer Event Listeners
    if (btnNotificationsDrawer) {
      btnNotificationsDrawer.addEventListener('click', () => {
        if (drawerNotifications) {
          // Mark all notifications as read when drawer is opened
          notificationsHistory.forEach(n => n.unread = false);
          localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
          updateNotificationsBadge();
          renderNotificationsDrawer();
          drawerNotifications.classList.remove('hidden');
        }
      });
    }

    if (closeNotificationsDrawer) {
      closeNotificationsDrawer.addEventListener('click', () => {
        if (drawerNotifications) drawerNotifications.classList.add('hidden');
      });
    }

    if (btnClearNotifications) {
      btnClearNotifications.addEventListener('click', () => {
        if (confirm('هل أنت متأكد من مسح جميع سجلات الإشعارات؟')) {
          notificationsHistory = [];
          localStorage.removeItem('notifications_history');
          updateNotificationsBadge();
          renderNotificationsDrawer();
        }
      });
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

    setupWMSEventListeners();
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

    const labelSecondaryPackQty = document.getElementById('label-secondary-pack-qty');
    if (labelSecondaryPackQty) {
      if (form === 'cream') {
        labelSecondaryPackQty.textContent = 'التغليف الثانوي (عدد التيوبات/العلب في الكرتونة) *';
      } else {
        labelSecondaryPackQty.textContent = 'التغليف الثانوي (عدد الظروف/البلسترات في الكرتونة) *';
      }
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
    if (inputSecondaryPackQty) inputSecondaryPackQty.value = '20';
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

    stagesConfig.push({ id: 'visual_inspection', name: 'الفحص العيني' });

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
      secondaryPackQty: parseInt(inputSecondaryPackQty.value, 10) || 1,
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
    logUserActivity('إصدار إضبارة جديدة', `تم إنشاء إضبارة جديدة للمنتج: ${newBatch.productName} (البատش: ${newBatch.batchNo}) بوزن إجمالي ${newBatch.totalWeightKg} kg.`);
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
        const totalBlisters = mathTotal.totalBlisters + carryMath.totalBlisters;
        const boxes = Math.floor(totalBlisters / (batch.secondaryPackQty || 1));
        if (detailTotalBoxes) {
          detailTotalBoxes.textContent = `${PharmaMath.formatNumber(boxes)} علبة`;
        }
      } else {
        detailTotalBlisters.textContent = `${PharmaMath.formatNumber(mathTotal.totalBlisters)} ${term.packName}`;
        const boxes = Math.floor(mathTotal.totalBlisters / (batch.secondaryPackQty || 1));
        if (detailTotalBoxes) {
          detailTotalBoxes.textContent = `${PharmaMath.formatNumber(boxes)} علبة`;
        }
      }
    }

    if (!Array.isArray(batch.qc_runs)) batch.qc_runs = [];
    renderWorkflowTimeline(batch);
    renderStageLogger(batch);
    renderQCLotsClearanceTable(batch);
    renderQCForm(batch);
    renderHistoryList(batch);
    renderWeighingInvoice(batch);

    if (btnDeleteBatch) {
      if (currentUserRole === 'admin' || currentUserRole === 'production') {
        btnDeleteBatch.classList.remove('hidden');
      } else {
        btnDeleteBatch.classList.add('hidden');
      }
    }

    const btnWeightAddendum = document.getElementById('btn-weight-addendum');
    if (btnWeightAddendum) {
      if (currentUserRole === 'admin') {
        btnWeightAddendum.classList.remove('hidden');
      } else {
        btnWeightAddendum.classList.add('hidden');
      }
    }

    const btnEditBatch = document.getElementById('btn-edit-batch');
    if (btnEditBatch) {
      if (currentUserRole === 'admin') {
        btnEditBatch.classList.remove('hidden');
      } else {
        btnEditBatch.classList.add('hidden');
      }
    }

    if (elModalBatchDetail) elModalBatchDetail.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function closeBatchDetailModal() {
    if (elModalBatchDetail) elModalBatchDetail.classList.add('hidden');
    activeBatchId = null;
    isEditCorrectionMode = false;
  }

  window.deleteBatch = function(batchId) {
    if (currentUserRole !== 'admin' && currentUserRole !== 'production') {
      alert('عذراً، لا تملك الصلاحية لحذف التشغيلات/الأضابير التصنيعية.');
      return;
    }
    const batch = batches.find(b => b && String(b.id) === String(batchId));
    const batchName = batch ? batch.productName : '';
    
    if (confirm(`هل أنت متأكد من إلغاء وحذف تشغيلة المنتج [${batchName}] نهائياً من خط الإنتاج والحجر؟`)) {
      if (batch) {
        // Revert weighed materials to Raw Materials Stock
        const weighingStage = batch.stages[0];
        if (weighingStage && Array.isArray(weighingStage.formulation)) {
          weighingStage.formulation.forEach(row => {
            const lotId = row.Lot_ID || row.lotId;
            const qty = row.Quantity || row.qty;
            const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
            if (lot) {
              const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
              const revertQty = isGram ? (qty * 1000) : qty;
              lot.Current_Qty = parseFloat((lot.Current_Qty + revertQty).toFixed(3));
              lot.updatedAt = Date.now();
            }
          });
          wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));
        }

        // Revert packaging materials to stock
        batch.stages.forEach(stage => {
          if (stage && Array.isArray(stage.packaging_materials)) {
            stage.packaging_materials.forEach(row => {
              const lotId = row.Lot_ID || row.lotId;
              const qty = row.Quantity || row.qty;
              const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
              if (lot) {
                lot.Current_Qty = parseFloat((lot.Current_Qty + qty).toFixed(3));
                lot.updatedAt = Date.now();
              }
            });
          }
        });
        wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

        saveWMS();

        batch.deleted = true;
        batch.version = (batch.version || 0) + 1;
        batch.updatedAt = Date.now();
      }
      saveBatches(true);
      logUserActivity('حذف وإلغاء إضبارة', `تم حذف وإلغاء إضبارة المنتج [${batchName}] (الباتش: ${batch ? batch.batchNo : ''}) وإرجاع المواد الخام الموزونة للمخزن.`);
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

      let statusWeightHtml = `<span dir="ltr">${stage.doneKg} / ${limitForStage}</span> kg`;
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
    const isBlisterStage = stage.id === 'blistering' || stage.id === 'packaging' || stage.id === 'visual_inspection';
    const isVisualInspection = stage.id === 'visual_inspection';
    const unitLabel = getUnitLabel(batch.pharmaForm);

    // Compute dynamic limit early for UI restrictions
    let maxAllowedTotal = batch.totalWeightKg;
    if (activeStageIndex > 0) {
      const prevStage = batch.stages[activeStageIndex - 1];
      maxAllowedTotal = prevStage ? (prevStage.acceptedKg || 0) : 0;
    }
    let carryOverAlreadyAdded = false;
    for (let p = 0; p < activeStageIndex; p++) {
      if (batch.stages[p].carryOverAdded) {
        carryOverAlreadyAdded = true;
        break;
      }
    }
    const chkCarryBefore = document.getElementById('chk-add-carry-over-progress');
    const chkChecked = chkCarryBefore ? chkCarryBefore.checked : false;
    let currentLimit = maxAllowedTotal;
    if (!carryOverAlreadyAdded && (stage.carryOverAdded || chkChecked)) {
      currentLimit += batch.carryOverKg;
    }

    const isReadOnlyLogger = currentUserRole === 'qc' || currentUserRole === 'wms' || currentUserRole === 'observer';
    const isCompleted = stage.status === 'completed' || (stage.doneKg || 0) >= (currentLimit - 0.05);
    const isReadOnlyView = isReadOnlyLogger || (!isEditCorrectionMode && isCompleted);

    if (editModeBtnText) editModeBtnText.textContent = isEditCorrectionMode ? 'إلغاء وضع التصحيح' : 'تعديل وتصحيح الإنجاز المسجل';
    if (btnCancelEditMode) btnCancelEditMode.classList.toggle('hidden', !isEditCorrectionMode);
    if (submitStageBtnText) submitStageBtnText.textContent = isEditCorrectionMode ? 'حفظ وتأكيد التعديل والتصحيح' : 'تسجيل الإنجاز وتحديث الحجر';

    const stageAccKg = stage.acceptedKg || 0;
    const stageRejKg = stage.rejectedKg || 0;

    const accMath = PharmaMath.kgToBlistersAndLots(stageAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
    const rejMath = PharmaMath.kgToBlistersAndLots(stageRejKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);

    if (isEditCorrectionMode) {
      if (isVisualInspection) {
        const acceptLabel = batch.pharmaForm === 'cream' ? 'تعديل وتصحيح المقبول الكلي للفحص (عدد العلب/التيوبات PASS) *' : 'تعديل وتصحيح المقبول الكلي للفحص (عدد البلسترات PASS) *';
        const rejectLabel = batch.pharmaForm === 'cream' ? 'تعديل وتصحيح المرفوض الكلي للفحص (عدد العلب/التيوبات REJECTED) *' : 'تعديل وتصحيح المرفوض الكلي للفحص (عدد البلسترات REJECTED) *';
        if (labelLogAccepted) labelLogAccepted.textContent = acceptLabel;
        if (labelLogRejected) labelLogRejected.textContent = rejectLabel;
        if (inputLogAcceptedKg) inputLogAcceptedKg.value = stage.acceptedBlisters || accMath.totalBlisters;
        if (inputLogRejectedKg) inputLogRejectedKg.value = stage.rejectedBlisters || rejMath.totalBlisters;
      } else if (isBlisterStage) {
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
      if (isVisualInspection) {
        const acceptLabel = batch.pharmaForm === 'cream' ? 'عدد العلب/التيوبات المقبولة بالفحص العيني (PASS) *' : 'عدد الظروف/البلسترات المقبولة بالفحص العيني (PASS) *';
        const rejectLabel = batch.pharmaForm === 'cream' ? 'عدد العلب/التيوبات المرفوضة بالفحص العيني (REJECTED) *' : 'عدد الظروف/البلسترات المرفوضة بالفحص العيني (REJECTED) *';
        if (labelLogAccepted) labelLogAccepted.textContent = acceptLabel;
        if (labelLogRejected) labelLogRejected.textContent = rejectLabel;
        if (inputLogAcceptedKg) { inputLogAcceptedKg.value = ''; inputLogAcceptedKg.placeholder = 'مثال: 5000 مقبول'; }
        if (inputLogRejectedKg) { inputLogRejectedKg.value = '0'; inputLogRejectedKg.placeholder = 'مثال: 20 مرفوض'; }
        if (logConversionHint) logConversionHint.textContent = 'مرحلة الفحص العيني: يرجى إدخال أعداد العلب/البلسترات المقبولة والمرفوضة مباشرة لحساب مردود الإنتاج Yield % والوزن المقابل بالكيلوغرام.';
      } else if (isBlisterStage) {
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

    // Weighing Formulation Dynamic View toggle (Runs in both Edit and Normal Modes)
    const formGrid = inputLogAcceptedKg ? inputLogAcceptedKg.closest('.form-grid') : null;

    if (activeStageIndex === 0) {
      if (elWeighingFormulationContainer) elWeighingFormulationContainer.classList.remove('hidden');
      if (inputLogAcceptedKg) {
        inputLogAcceptedKg.readOnly = true;
        inputLogAcceptedKg.style.background = 'rgba(255,255,255,0.05)';
        inputLogAcceptedKg.style.cursor = 'not-allowed';
        inputLogAcceptedKg.required = false;
      }
      if (inputLogRejectedKg) {
        inputLogRejectedKg.required = false;
        inputLogRejectedKg.value = '0';
      }
      if (formGrid) {
        formGrid.classList.add('hidden');
      }
      
      if (btnAddFormulationRow) {
        btnAddFormulationRow.style.display = isReadOnlyView ? 'none' : 'flex';
      }

      if (elWeighingFormulationTbody) {
        elWeighingFormulationTbody.innerHTML = '';
        if (stage.formulation && stage.formulation.length > 0) {
          stage.formulation.forEach(row => {
            addWeighingFormulationRow(row.Lot_ID || row.lotId, row.userQty || row.Quantity || row.qty, row.userUnit || 'kg', isReadOnlyView);
          });
        } else {
          addWeighingFormulationRow('', 0, 'kg', isReadOnlyView);
        }
      }
      updateWeighingFormulationTotal();
    } else {
      if (elWeighingFormulationContainer) elWeighingFormulationContainer.classList.add('hidden');
      if (inputLogAcceptedKg) {
        inputLogAcceptedKg.required = true;
        inputLogAcceptedKg.readOnly = false;
        inputLogAcceptedKg.style.background = '';
        inputLogAcceptedKg.style.cursor = '';
      }
      if (inputLogRejectedKg) {
        inputLogRejectedKg.required = true;
        inputLogRejectedKg.readOnly = false;
        inputLogRejectedKg.style.background = '';
        inputLogRejectedKg.style.cursor = '';
      }
      if (formGrid) formGrid.classList.remove('hidden');
    }

    // Primary Packaging consumption Dynamic View toggle (Runs in both Edit and Normal Modes)
    const isPackagingStage = (batch.pharmaForm === 'solid' || batch.pharmaForm === 'capsule') ? (stage.id === 'blistering') : (stage.id === 'filling');
    const elPackagingMaterialsContainer = document.getElementById('packaging-materials-container');
    const elPackagingMaterialsTbody = document.getElementById('packaging-materials-tbody');
    if (isPackagingStage) {
      if (elPackagingMaterialsContainer) elPackagingMaterialsContainer.classList.remove('hidden');
      if (elPackagingMaterialsTbody) {
        elPackagingMaterialsTbody.innerHTML = '';
        if (stage.packaging_materials && stage.packaging_materials.length > 0) {
          stage.packaging_materials.forEach(row => {
            addPackagingMaterialRow(row.Lot_ID || row.lotId, row.Quantity || row.qty);
          });
        } else {
          addPackagingMaterialRow('', 0);
        }
      }
    } else {
      if (elPackagingMaterialsContainer) elPackagingMaterialsContainer.classList.add('hidden');
    }

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
        logStageTotalBlisters.textContent = `(${totalMath.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ${unitLabel})`;;
      }
    }

    if (logStageAcceptedKg) logStageAcceptedKg.textContent = `${stageAccKg} kg`;
    if (logStageAcceptedBlisters) logStageAcceptedBlisters.textContent = `(${PharmaMath.formatNumber(accMath.totalBlisters)} ${unitLabel} مقبول)`;

    if (logStageRejectedKg) logStageRejectedKg.textContent = `${stageRejKg} kg`;
    if (logStageRejectedBlisters) logStageRejectedBlisters.textContent = `(${PharmaMath.formatNumber(rejMath.totalBlisters)} ${unitLabel} مرفوض/إعادة تشغيل)`;

    if (inputLogAcceptedKg) inputLogAcceptedKg.disabled = isReadOnlyView;
    if (inputLogRejectedKg) inputLogRejectedKg.disabled = isReadOnlyView;
    
    // disable carry over progress checkbox if present
    const chkCarry = document.getElementById('chk-add-carry-over-progress');
    if (chkCarry) chkCarry.disabled = isReadOnlyView;

    if (btnSubmitStageLog) {
      if (isReadOnlyLogger) {
        btnSubmitStageLog.disabled = true;
        btnSubmitStageLog.style.opacity = '0.5';
        btnSubmitStageLog.title = 'تتطلب صلاحية إدارة الإنتاج أو المشرف';
      } else if (!isEditCorrectionMode && isCompleted) {
        btnSubmitStageLog.disabled = true;
        btnSubmitStageLog.style.opacity = '0.5';
        btnSubmitStageLog.title = 'هذه المرحلة مكتملة. يرجى الضغط على زر التعديل والتصحيح الأصفر للتعديل.';
      } else {
        btnSubmitStageLog.disabled = false;
        btnSubmitStageLog.style.opacity = '1';
        btnSubmitStageLog.title = '';
      }
    }

    if (btnToggleEditMode) {
      if (isReadOnlyLogger) {
        btnToggleEditMode.disabled = true;
        btnToggleEditMode.style.opacity = '0.5';
        btnToggleEditMode.title = 'تتطلب صلاحية إدارة الإنتاج أو المشرف';
      } else {
        btnToggleEditMode.disabled = false;
        btnToggleEditMode.style.opacity = '1';
        btnToggleEditMode.title = '';
      }
    }

    // Render QC Lab notification triggers in the logger box based on active stage
    const notifyContainer = document.getElementById('stage-qc-notification-container');
    if (notifyContainer) {
      if (activeStageIndex === 1) { // Preparation (التحضير)
        notifyContainer.style.display = 'block';
        notifyContainer.innerHTML = `
          <button type="button" class="btn btn-secondary btn-sm" style="width: 100%; border-color: var(--cyan); color: var(--cyan); background: rgba(6, 182, 212, 0.05); font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; font-size: 0.82rem;" onclick="window.notifyQCAssay('${batch.id}')">
            <i data-lucide="beaker" style="width: 14px; height: 14px;"></i> 🧪 إرسال إشعار للمخبر لتحليل مادة (التحضير Assay)
          </button>
        `;
      } else if (activeStageIndex === 2) { // Compression/Filling (الضغط / التعبئة)
        notifyContainer.style.display = 'block';
        notifyContainer.innerHTML = `
          <button type="button" class="btn btn-secondary btn-sm" style="width: 100%; border-color: var(--cyan); color: var(--cyan); background: rgba(6, 182, 212, 0.05); font-weight: bold; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; font-size: 0.82rem;" onclick="window.notifyQCDissUnif('${batch.id}')">
            <i data-lucide="beaker" style="width: 14px; height: 14px;"></i> 🧪 إرسال إشعار للمخبر لتحليل الانحلالية وتجانس المحتوى (Dissolution & Uniformity)
          </button>
        `;
      } else if (stage.id === 'visual_inspection') {
        const yieldVal = stage.yieldPercent !== undefined ? stage.yieldPercent.toFixed(2) : '100.00';
        const acceptedB = stage.acceptedBlisters || 0;
        const rejectedB = stage.rejectedBlisters || 0;
        notifyContainer.style.display = 'block';
        notifyContainer.innerHTML = `
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 12px; font-size: 0.9rem; color: #fff; direction: rtl;">
            <div style="font-weight: bold; color: var(--emerald); display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <i data-lucide="percent" style="width: 18px; height: 18px;"></i>
              <span>تقرير مردود الإنتاج الكلي (Yield %): ${yieldVal}%</span>
            </div>
            <div style="display: flex; gap: 15px; font-size: 0.8rem; color: var(--text-dim);">
              <span>مقبول: <strong>${PharmaMath.formatNumber(acceptedB)}</strong> وحدة</span>
              <span>مرفوض: <strong>${PharmaMath.formatNumber(rejectedB)}</strong> وحدة</span>
              <span>إجمالي المفحوص: <strong>${PharmaMath.formatNumber(acceptedB + rejectedB)}</strong> وحدة</span>
            </div>
          </div>
        `;
      } else {
        notifyContainer.style.display = 'none';
        notifyContainer.innerHTML = '';
      }

      // Render Visual Inspection Release Certificate Attachment UI
      const visualAttachmentContainer = document.getElementById('visual-inspection-attachment-container');
      const visualAttachmentStatus = document.getElementById('visual-release-attachment-status');
      const visualAttachmentFile = document.getElementById('visual-release-attachment-file');

      if (visualAttachmentContainer) {
        if (stage.id === 'visual_inspection') {
          visualAttachmentContainer.classList.remove('hidden');
          if (stage.releaseCertificate) {
            if (visualAttachmentStatus) {
              visualAttachmentStatus.innerHTML = `المستند المرفق لشهادة التحرير: <a href="#" onclick="downloadBatchStageReleaseCertificate('${batch.id}'); return false;" style="color: var(--cyan); text-decoration: underline;">${stage.releaseCertificate.name}</a> (${stage.releaseCertificate.size}) ${isReadOnlyView ? '' : ` | <span style="color: var(--rose); cursor: pointer; margin-right: 10px;" onclick="removeBatchStageReleaseCertificate('${batch.id}')">حذف المرفق ❌</span>`}`;
            }
            if (visualAttachmentFile) {
              visualAttachmentFile.style.display = 'none';
            }
          } else {
            if (visualAttachmentStatus) visualAttachmentStatus.innerHTML = '';
            if (visualAttachmentFile) {
              visualAttachmentFile.style.display = 'block';
              visualAttachmentFile.value = '';
              visualAttachmentFile.disabled = isReadOnlyView;
            }
          }
        } else {
          visualAttachmentContainer.classList.add('hidden');
        }
      }

      if (window.lucide) window.lucide.createIcons();
    }
  }

  function handleUpdateStageSubmit(e) {
    e.preventDefault();
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch || !Array.isArray(batch.stages)) return;

    const stage = batch.stages[activeStageIndex];
    if (!stage) return;
    const isBlisterStage = activeStageIndex === batch.stages.length - 1;
    const isVisualInspection = stage.id === 'visual_inspection';
    const term = getTerminology(batch.pharmaForm);

    if (currentUserRole === 'qc' || currentUserRole === 'wms' || currentUserRole === 'observer') {
      alert('عذراً، لا تملك صلاحيات إدارة الإنتاج لتسجيل الإنجاز.');
      return;
    }

        let formulationRows = [];
    if (activeStageIndex === 0) {
      const rows = elWeighingFormulationTbody.querySelectorAll('tr');
      let isValid = true;
      for (let i = 0; i < rows.length; i++) {
        const lotEl = rows[i].querySelector('.wms-lot-id-hidden') || rows[i].querySelector('.wms-lot-select');
        const input = rows[i].querySelector('.wms-qty-input');
        const lotId = lotEl ? lotEl.value : '';
        const qty = parseFloat(input.value) || 0;
        
        const rowUnitSelect = rows[i].querySelector('.wms-row-unit-select');
        const rowUnit = rowUnitSelect ? rowUnitSelect.value : 'kg';

        if (!lotId || qty <= 0) {
          alert('يرجى اختيار لوت صالح وتحديد الكمية الموزونة لجميع أسطر المواد الخام!');
          isValid = false;
          break;
        }

        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
        if (!lot) {
          alert('اللوت المحدد غير موجود بالمستودع!');
          isValid = false;
          break;
        }

        if (lot.Status !== 'Released') {
          alert(`لا يمكن وزن أو استخدام اللوت [${lot.Lot_Number}] للمادة [${lot.Material_Name}] لأنه غير مفرج عنه (الحالة الحالية: ${lot.Status})! يجب أن تكون حالة المادة "مقبول ومفرج عنه (Released)" قبل وزنها.`);
          isValid = false;
          break;
        }

        let oldQtyForLot = 0;
        if (Array.isArray(stage.formulation)) {
          const oldRow = stage.formulation.find(or => String(or.Lot_ID || or.lotId) === String(lotId));
          if (oldRow) {
            oldQtyForLot = oldRow.Quantity || oldRow.qty || 0; // stored in kg
          }
        }

        const isLotInGrams = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
        const lotQtyInKg = isLotInGrams ? (lot.Current_Qty / 1000) : lot.Current_Qty;

        const qtyInKg = rowUnit === 'g' ? (qty / 1000) : qty;

        if (qtyInKg > (lotQtyInKg + oldQtyForLot)) {
          const displayMax = (lotQtyInKg + oldQtyForLot) * (rowUnit === 'g' ? 1000 : 1);
          alert(`الكمية المطلوبة للمادة [${lot.Material_Name}] (${qty} ${rowUnit}) أكبر من الرصيد المتوفر باللوت [${lot.Lot_Number}] مضافاً إليه الكمية المصروفة سابقاً (${displayMax.toFixed(3)} ${rowUnit})!`);
          isValid = false;
          break;
        }

        formulationRows.push({
          lotId,
          qty: qtyInKg,
          userQty: qty,
          userUnit: rowUnit,
          lotName: lot.Material_Name,
          lotNumber: lot.Lot_Number,
          unit: lot.Unit
        });
      }

      if (!isValid) return;
    }

    let packagingRows = [];
    const isPackagingStage = (batch.pharmaForm === 'solid' || batch.pharmaForm === 'capsule') ? (stage.id === 'blistering') : (stage.id === 'filling');
    if (isPackagingStage) {
      const elPackagingMaterialsTbody = document.getElementById('packaging-materials-tbody');
      if (elPackagingMaterialsTbody) {
        const rows = elPackagingMaterialsTbody.querySelectorAll('tr');
        let isValid = true;
        for (let i = 0; i < rows.length; i++) {
          const lotEl = rows[i].querySelector('.wms-lot-id-hidden');
          const input = rows[i].querySelector('.wms-qty-input');
          const lotId = lotEl ? lotEl.value : '';
          const qty = parseFloat(input.value) || 0;

          if (!lotId || qty <= 0) {
            alert('يرجى اختيار مادة تغليف صالحة وتحديد الكمية المستهلكة لجميع الأسطر!');
            isValid = false;
            break;
          }

          const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
          if (!lot) {
            alert('المادة المحددة غير موجودة بالمستودع!');
            isValid = false;
            break;
          }

          if (lot.Status !== 'Released') {
            alert(`لا يمكن استخدام اللوت [${lot.Lot_Number}] للمادة [${lot.Material_Name}] لأنه غير مفرج عنه (الحالة الحالية: ${lot.Status})! يجب أن تكون حالة المادة "Released" قبل استهلاكها.`);
            isValid = false;
            break;
          }

          let oldQtyForLot = 0;
          if (Array.isArray(stage.packaging_materials)) {
            const oldRow = stage.packaging_materials.find(or => String(or.Lot_ID || or.lotId) === String(lotId));
            if (oldRow) {
              oldQtyForLot = oldRow.Quantity || oldRow.qty || 0;
            }
          }

          if (qty > (lot.Current_Qty + oldQtyForLot)) {
            alert(`الكمية المطلوبة لمادة التغليف [${lot.Material_Name}] (${qty}) أكبر من الرصيد المتوفر باللوت [${lot.Lot_Number}] مضافاً إليه الكمية المستهلكة سابقاً (${(lot.Current_Qty + oldQtyForLot).toFixed(3)})!`);
            isValid = false;
            break;
          }

          packagingRows.push({ lotId, qty, lotName: lot.Material_Name, lotNumber: lot.Lot_Number, unit: lot.Unit });
        }

        if (!isValid) return;
      }
    }

    // ----------------------------------------------------
    // Overwrite/Replacement Mode for Weighing and Packaging
    // ----------------------------------------------------
    if (activeStageIndex === 0) {
      const totalFormulationKg = formulationRows.reduce((sum, r) => sum + r.qty, 0);
      const chkCarryProgress = document.getElementById('chk-add-carry-over-progress');
      const shouldAddCarryOver = chkCarryProgress ? chkCarryProgress.checked : false;
      
      let newAccKg = totalFormulationKg;
      if (shouldAddCarryOver || stage.carryOverAdded) {
        newAccKg += (batch.carryOverKg || 0);
        stage.carryOverAdded = true;
      }
      
      const stageLimit = batch.totalWeightKg + (stage.carryOverAdded ? (batch.carryOverKg || 0) : 0);
      
      if (newAccKg > (stageLimit + 0.05)) {
        alert(`الكمية الإجمالية للمواد الموزونة المصححة (${newAccKg.toFixed(2)} kg) لا يمكن أن تتجاوز وزن الباتش الكلي المسموح به (${stageLimit.toFixed(2)} kg).`);
        return;
      }
      
      // Revert old WMS stock deductions
      if (stage.formulation && stage.formulation.length > 0) {
        stage.formulation.forEach(oldRow => {
          const lotId = oldRow.Lot_ID || oldRow.lotId;
          const qty = oldRow.Quantity || oldRow.qty;
          const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
          if (lot) {
            const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
            const revertQty = isGram ? (qty * 1000) : qty;
            lot.Current_Qty = parseFloat((lot.Current_Qty + revertQty).toFixed(3));
            lot.updatedAt = Date.now();
          }
        });
      }
      
      // Delete old transactions
      wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

      // Save new formulation array
      stage.formulation = formulationRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty, userQty: r.userQty, userUnit: r.userUnit }));

      // Deduct new stock and log transactions
      formulationRows.forEach(row => {
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
        if (lot) {
          const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
          const dispenseQty = isGram ? (row.qty * 1000) : row.qty;
          lot.Current_Qty = parseFloat((lot.Current_Qty - dispenseQty).toFixed(3));
          lot.updatedAt = Date.now();
        }

        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: row.lotId,
          Tx_Type: 'Dispense_Production',
          Quantity: -row.qty,
          Reference_ID: `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      });
      saveWMS();

      // Update stage state
      stage.acceptedKg = newAccKg;
      stage.rejectedKg = 0;
      stage.doneKg = newAccKg;
      
      if (stage.doneKg >= (stageLimit - 0.05)) {
        stage.status = 'completed';
      } else if (stage.doneKg > 0) {
        stage.status = 'in_progress';
      } else {
        stage.status = 'pending';
      }

      if (!Array.isArray(batch.logs)) batch.logs = [];
      const uLabel = getUnitLabel(batch.pharmaForm);
      const accBlisters = PharmaMath.kgToBlistersAndLots(newAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount).totalBlisters;
      
      batch.logs.unshift({
        time: new Date().toLocaleString('en-US'),
        text: `تسجيل وزنات خلطة المواد الخام لإنتاج الباتش: (إجمالي الوزن المقبول: ${newAccKg.toFixed(2)} kg = ${PharmaMath.formatNumber(accBlisters)} ${uLabel}).`
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

    if (isPackagingStage) {
      const newAccBlisters = parseFloat(inputLogAcceptedKg.value) || 0;
      const newRejBlisters = parseFloat(inputLogRejectedKg.value) || 0;

      const newAccKg = PharmaMath.blistersToKg(newAccBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);
      const newRejKg = PharmaMath.blistersToKg(newRejBlisters, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister);

      const chkCarryProgress = document.getElementById('chk-add-carry-over-progress');
      const shouldAddCarryOver = chkCarryProgress ? chkCarryProgress.checked : false;
      
      let carryOverAlreadyAdded = false;
      for (let idx = 0; idx < activeStageIndex; idx++) {
        if (batch.stages[idx].carryOverAdded) {
          carryOverAlreadyAdded = true;
          break;
        }
      }
      
      let finalAccKg = newAccKg;
      if (!carryOverAlreadyAdded && (shouldAddCarryOver || stage.carryOverAdded)) {
        finalAccKg += (batch.carryOverKg || 0);
        stage.carryOverAdded = true;
      }
      
      let maxAllowedTotal = batch.totalWeightKg;
      if (activeStageIndex > 0) {
        const prevStage = batch.stages[activeStageIndex - 1];
        maxAllowedTotal = prevStage ? (prevStage.acceptedKg || 0) : 0;
      }
      const stageLimit = maxAllowedTotal + (stage.carryOverAdded ? (batch.carryOverKg || 0) : 0);
      
      if ((finalAccKg + newRejKg) > (stageLimit + 0.05)) {
        alert(`الكمية الإجمالية المحسوبة للمرحلة (${(finalAccKg + newRejKg).toFixed(2)} kg) لا يمكن أن تتجاوز الكمية المقبولة في المرحلة السابقة (${stageLimit.toFixed(2)} kg).`);
        return;
      }
      
      // Revert old WMS stock deductions
      if (stage.packaging_materials && stage.packaging_materials.length > 0) {
        stage.packaging_materials.forEach(oldRow => {
          const lotId = oldRow.Lot_ID || oldRow.lotId;
          const qty = oldRow.Quantity || oldRow.qty;
          const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
          if (lot) {
            lot.Current_Qty = parseFloat((lot.Current_Qty + qty).toFixed(3));
            lot.updatedAt = Date.now();
          }
        });
      }
      
      // Delete old transactions
      wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

      // Save new packaging array (Documentation/Traceability only)
      stage.packaging_materials = packagingRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty }));

      // Deduct new stock and log transactions
      packagingRows.forEach(row => {
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
        if (lot) {
          lot.Current_Qty = parseFloat((lot.Current_Qty - row.qty).toFixed(3));
          lot.updatedAt = Date.now();
        }

        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: row.lotId,
          Tx_Type: 'Dispense_Production',
          Quantity: -row.qty,
          Reference_ID: `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      });
      saveWMS();

      // Update stage state
      stage.acceptedKg = finalAccKg;
      stage.rejectedKg = newRejKg;
      stage.doneKg = finalAccKg + newRejKg;
      stage.acceptedBlisters = newAccBlisters;
      stage.rejectedBlisters = newRejBlisters;
      stage.yieldPercent = (newAccBlisters + newRejBlisters) > 0 ? (newAccBlisters / (newAccBlisters + newRejBlisters)) * 100 : 100;
      
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
        text: `تسجيل إنتاج مرحلة التعبئة النهائية: (إجمالي المقبول: ${newAccBlisters} ${uLabel} = ${finalAccKg.toFixed(2)} kg).`
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
      } else if (activeStageIndex === 0) {
        // Weighing stage edit mode: calculate sum of formulationRows
        newAccKg = formulationRows.reduce((sum, r) => sum + r.qty, 0);
        newRejKg = 0;
        
        const accMath = PharmaMath.kgToBlistersAndLots(newAccKg, batch.isCoated, batch.preCoatingMg, batch.postCoatingMg, batch.unitsPerBlister, batch.totalWeightKg, batch.lotsCount);
        newAccBlisters = accMath.totalBlisters;
        newRejBlisters = 0;

        // WMS Revert & Apply logic for Weighing Correction
        // 1. Revert old stock deductions
        if (stage.formulation && stage.formulation.length > 0) {
          stage.formulation.forEach(oldRow => {
            const lotId = oldRow.Lot_ID || oldRow.lotId;
            const qty = oldRow.Quantity || oldRow.qty;
            const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
            if (lot) {
              const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
              const revertQty = isGram ? (qty * 1000) : qty;
              lot.Current_Qty = parseFloat((lot.Current_Qty + revertQty).toFixed(3));
              lot.updatedAt = Date.now();
            }
          });
        }
        // 2. Delete previous WMS transactions for this batch
        wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

        // 3. Save new formulation array
        stage.formulation = formulationRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty, userQty: r.userQty, userUnit: r.userUnit }));
        
        // 4. Deduct new quantities and log transactions
        formulationRows.forEach(row => {
          const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
          if (lot) {
            const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
            const dispenseQty = isGram ? (row.qty * 1000) : row.qty;
            lot.Current_Qty = parseFloat((lot.Current_Qty - dispenseQty).toFixed(3));
            lot.updatedAt = Date.now();
          }

          wmsTransactions.unshift({
            Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            Lot_ID: row.lotId,
            Tx_Type: 'Dispense_Production',
            Quantity: -row.qty,
            Reference_ID: `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
            Performed_By: currentUserRole,
            Timestamp: Date.now()
          });
        });
        saveWMS();
      } else if (isPackagingStage) {
        // WMS Revert & Apply logic for Packaging Correction
        // 1. Revert old stock deductions
        if (stage.packaging_materials && stage.packaging_materials.length > 0) {
          stage.packaging_materials.forEach(oldRow => {
            const lotId = oldRow.Lot_ID || oldRow.lotId;
            const qty = oldRow.Quantity || oldRow.qty;
            const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
            if (lot) {
              lot.Current_Qty = parseFloat((lot.Current_Qty + qty).toFixed(3));
              lot.updatedAt = Date.now();
            }
          });
        }
        // 2. Delete previous WMS transactions for this batch's packaging
        wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

        // 3. Save new packaging array
        stage.packaging_materials = packagingRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty }));
        
        // 4. Deduct new quantities and log transactions
        packagingRows.forEach(row => {
          const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
          if (lot) {
            lot.Current_Qty = parseFloat((lot.Current_Qty - row.qty).toFixed(3));
            lot.updatedAt = Date.now();
          }

          wmsTransactions.unshift({
            Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
            Lot_ID: row.lotId,
            Tx_Type: 'Dispense_Production',
            Quantity: -row.qty,
            Reference_ID: `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
            Performed_By: currentUserRole,
            Timestamp: Date.now()
          });
        });
        saveWMS();
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
      if (isVisualInspection) {
        stage.acceptedBlisters = newAccBlisters;
        stage.rejectedBlisters = newRejBlisters;
        stage.yieldPercent = (newAccBlisters + newRejBlisters) > 0 ? (newAccBlisters / (newAccBlisters + newRejBlisters)) * 100 : 100;
      }

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
      if (activeStageIndex === 0) {
        addAcceptedKg = formulationRows.reduce((sum, r) => sum + r.qty, 0);
        addRejectedKg = 0;
      } else {
        addAcceptedKg = parseFloat(inputLogAcceptedKg.value) || 0;
        addRejectedKg = parseFloat(inputLogRejectedKg.value) || 0;
      }

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
    if (isVisualInspection) {
      stage.acceptedBlisters = (stage.acceptedBlisters || 0) + addAcceptedBlisters;
      stage.rejectedBlisters = (stage.rejectedBlisters || 0) + addRejectedBlisters;
      stage.yieldPercent = (stage.acceptedBlisters + stage.rejectedBlisters) > 0 ? (stage.acceptedBlisters / (stage.acceptedBlisters + stage.rejectedBlisters)) * 100 : 100;
    }

    // If Weighing stage, execute WMS stock deductions
    if (activeStageIndex === 0) {
      stage.formulation = formulationRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty, userQty: r.userQty, userUnit: r.userUnit }));
      formulationRows.forEach(row => {
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
        if (lot) {
          const isGram = lot.Unit === 'g' || lot.Unit === 'غ' || lot.Unit === 'جرام';
          const dispenseQty = isGram ? (row.qty * 1000) : row.qty;
          lot.Current_Qty = parseFloat((lot.Current_Qty - dispenseQty).toFixed(3));
          lot.updatedAt = Date.now();
        }

        // Log transaction in WMS history
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: row.lotId,
          Tx_Type: 'Dispense_Production',
          Quantity: -row.qty,
          Reference_ID: `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      });
      saveWMS();
    }

    // If Packaging stage, execute WMS packaging stock deductions
    if (isPackagingStage) {
      stage.packaging_materials = packagingRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty }));
      packagingRows.forEach(row => {
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(row.lotId));
        if (lot) {
          lot.Current_Qty = parseFloat((lot.Current_Qty - row.qty).toFixed(3));
          lot.updatedAt = Date.now();
        }

        // Log transaction in WMS history
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: row.lotId,
          Tx_Type: 'Dispense_Production',
          Quantity: -row.qty,
          Reference_ID: `صرف للتعبئة والتغليف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      });
      saveWMS();
    }

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
    } else if (activeStageIndex === 0) {
      const detailsStr = formulationRows.map(r => `${r.lotName} (لوت: ${r.lotNumber}) بوزن ${r.userQty} ${r.userUnit === 'g' ? 'غ' : 'كغ'}`).join('، ');
      logMsg = `تسجيل إنجاز بالوزن الميداني للمواد الخام: إجمالي مقبول ${addAcceptedKg} kg. تفاصيل المواد الموزونة المصروفة: [ ${detailsStr} ]`;
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
    logUserActivity('تسجيل إنجاز مرحلة', `تم تسجيل إنجاز في الإضبارة (${batch.productName} باتش: ${batch.batchNo}) في مرحلة [${stage.name}]: ${logMsg}`);
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

  function renderWeighingInvoice(batch) {
    const section = document.getElementById('weighing-invoice-section');
    const tbody = document.getElementById('weighing-invoice-tbody');
    const invoiceDate = document.getElementById('weighing-invoice-date');
    const invoiceBatchNo = document.getElementById('weighing-invoice-batch-no');
    const invoiceProductName = document.getElementById('weighing-invoice-product-name');
    const invoiceTotal = document.getElementById('weighing-invoice-total');

    if (!section || !tbody) return;

    const weighingStage = batch.stages && batch.stages[0];
    const formulation = weighingStage && weighingStage.formulation;

    // Check if there are packaging materials
    const packagingStage = batch.stages && batch.stages.find(s => s && (s.id === 'blistering' || s.id === 'filling' || s.id === 'packaging'));
    const packagingMaterials = packagingStage && packagingStage.packaging_materials;

    const hasFormulation = Array.isArray(formulation) && formulation.length > 0;
    const hasPackaging = Array.isArray(packagingMaterials) && packagingMaterials.length > 0;

    if (!hasFormulation && !hasPackaging) {
      section.classList.add('hidden');
      return;
    }

    // Populate header info
    invoiceBatchNo.textContent = batch.batchNo || '-';
    invoiceProductName.textContent = batch.productName || '-';
    
    let dateStr = 'قيد التحضير';
    if (batch.logs && batch.logs.length > 0) {
      const wLog = batch.logs.find(l => l && l.text && (l.text.includes('مرحلة [الوزن]') || l.text.includes('مرحلة [Weighing]') || l.text.includes('مرحلة [وزن]')));
      if (wLog) {
        dateStr = wLog.time;
      } else {
        dateStr = batch.logs[batch.logs.length - 1].time;
      }
    }
    invoiceDate.textContent = `التاريخ: ${dateStr}`;

    // Populate rows
    tbody.innerHTML = '';
    let totalQty = 0;

    // 1. Raw Materials (Formulation)
    if (hasFormulation) {
      formulation.forEach(row => {
        const lotId = row.Lot_ID || row.lotId;
        const qtyVal = row.Quantity || row.qty || 0;
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
        const materialName = lot ? lot.Material_Name : 'مادة محذوفة/غير معروفة';
        const lotNumber = lot ? lot.Lot_Number : '-';
        const supplier = lot ? (lot.Supplier || '-') : '-';
        
        let displayQty = qtyVal;
        let displayUnit = lot ? lot.Unit : 'kg';
        
        if (row.userQty !== undefined && row.userUnit !== undefined) {
          displayQty = row.userQty;
          displayUnit = row.userUnit;
        } else {
          const isGram = displayUnit === 'g' || displayUnit === 'غ' || displayUnit === 'جرام';
          if (isGram) {
            displayQty = qtyVal * 1000;
          }
        }

        totalQty += qtyVal;

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
        tr.innerHTML = `
          <td style="padding: 8px; color: var(--text-dim); text-align: right; font-size: 0.78rem;">مواد خام 🧪</td>
          <td style="padding: 8px; font-weight: bold; color: var(--cyan); text-align: right;">${materialName}</td>
          <td style="padding: 8px; text-align: center; color: var(--text-dim); font-size: 0.78rem;">${supplier}</td>
          <td style="padding: 8px; text-align: center; color: var(--amber); font-family: monospace;">${lotNumber}</td>
          <td style="padding: 8px; text-align: left; font-weight: bold; color: var(--emerald);">${displayQty.toFixed(3)} ${displayUnit}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // 2. Packaging Materials
    if (hasPackaging) {
      packagingMaterials.forEach(row => {
        const lotId = row.Lot_ID || row.lotId;
        const qtyVal = row.Quantity || row.qty || 0;
        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
        const materialName = lot ? lot.Material_Name : 'مادة تغليف محذوفة';
        const lotNumber = lot ? lot.Lot_Number : '-';
        const supplier = lot ? (lot.Supplier || '-') : '-';
        
        let displayQty = qtyVal;
        let displayUnit = lot ? lot.Unit : 'kg';
        
        if (row.userQty !== undefined && row.userUnit !== undefined) {
          displayQty = row.userQty;
          displayUnit = row.userUnit;
        } else {
          const isGram = displayUnit === 'g' || displayUnit === 'غ' || displayUnit === 'جرام';
          if (isGram) {
            displayQty = qtyVal * 1000;
          }
        }

        const isWeight = displayUnit.toLowerCase() === 'kg' || displayUnit.toLowerCase() === 'g' || displayUnit === 'كغ' || displayUnit === 'غ';
        if (isWeight) {
          totalQty += (displayUnit.toLowerCase() === 'g' || displayUnit === 'غ') ? (displayQty / 1000) : displayQty;
        }

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
        tr.innerHTML = `
          <td style="padding: 8px; color: var(--cyan); text-align: right; font-size: 0.78rem;">مواد تغليف 📦</td>
          <td style="padding: 8px; font-weight: bold; color: var(--cyan); text-align: right;">${materialName}</td>
          <td style="padding: 8px; text-align: center; color: var(--text-dim); font-size: 0.78rem;">${supplier}</td>
          <td style="padding: 8px; text-align: center; color: var(--amber); font-family: monospace;">${lotNumber}</td>
          <td style="padding: 8px; text-align: left; font-weight: bold; color: var(--emerald);">${displayQty.toFixed(3)} ${displayUnit}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    invoiceTotal.textContent = `${totalQty.toFixed(3)} kg`;
    section.classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
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
    
    if (!Array.isArray(batch.active_ingredients_config)) {
      const count = parseInt(batch.active_ingredients_count, 10) || 1;
      batch.active_ingredients_config = [];
      for (let i = 0; i < count; i++) {
        batch.active_ingredients_config.push({
          name: `المادة الفعالة ${i + 1}`,
          has_diss: true,
          has_unif: true
        });
      }
    }

    const hasDiss = batch.active_ingredients_config.some(ing => ing.has_diss);
    const hasUnif = batch.active_ingredients_config.some(ing => ing.has_unif);

    // Determine required tests
    const isTabletOrCapsule = (form === 'solid' || form === 'capsule');
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
      if (!Array.isArray(batch.active_ingredients_config)) {
        const count = parseInt(batch.active_ingredients_count, 10) || 1;
        batch.active_ingredients_config = [];
        for (let i = 0; i < count; i++) {
          batch.active_ingredients_config.push({
            name: `المادة الفعالة ${i + 1}`,
            has_diss: true,
            has_unif: true
          });
        }
      }
      const ingCount = batch.active_ingredients_config.length;

      let ingredientsConfigHtml = '';
      batch.active_ingredients_config.forEach((ing, i) => {
        ingredientsConfigHtml += `
          <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; background: rgba(255,255,255,0.02); padding: 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.04);">
            <div style="flex: 1; min-width: 150px;">
              <label style="font-size: 0.75rem; color: var(--text-dim); display: block; margin-bottom: 2px;">اسم المادة الفعالة ${i + 1}:</label>
              <input type="text" value="${ing.name}" onchange="window.updateIngredientName(${i}, this.value)" placeholder="مثال: باراسيتامول" style="background: var(--bg-dark); color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; width: 100%; box-sizing: border-box;">
            </div>
            ${(form === 'solid' || form === 'capsule') ? `
              <div style="display: flex; gap: 15px; margin-top: 12px;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.78rem; color: var(--text-dim);">
                  <input type="checkbox" ${ing.has_diss ? 'checked' : ''} onchange="window.toggleIngredientTest(${i}, 'diss', this.checked)">
                  <span>فحص الانحلالية</span>
                </label>
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.78rem; color: var(--text-dim);">
                  <input type="checkbox" ${ing.has_unif ? 'checked' : ''} onchange="window.toggleIngredientTest(${i}, 'unif', this.checked)">
                  <span>تجانس المحتوى</span>
                </label>
              </div>
            ` : ''}
          </div>
        `;
      });

      elQCGlobalConfigContainer.innerHTML = `
        <div class="coating-config-box" style="margin-bottom: 1.25rem; padding: 12px; border: 1px dashed var(--primary); border-radius: 6px; background: rgba(59, 130, 246, 0.02);">
          <h6 style="font-weight: bold; margin-bottom: 0.6rem; color: var(--primary); font-size: 0.85rem;">إعدادات تحاليل الجودة والفاعلية (QC Ingredients & Test Settings):</h6>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
            <label for="qc-active-ingredients-count" style="font-size: 0.82rem; color: #ffffff;">عدد المواد الفعالة في المستحضر:</label>
            <select id="qc-active-ingredients-count" onchange="window.changeIngredientsCount(this.value)" style="background: var(--bg-dark); color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; outline: none; cursor: pointer;">
              <option value="1" ${ingCount === 1 ? 'selected' : ''}>مادة فعالة واحدة (1)</option>
              <option value="2" ${ingCount === 2 ? 'selected' : ''}>مادتين (2)</option>
              <option value="3" ${ingCount === 3 ? 'selected' : ''}>ثلاث مواد (3)</option>
              <option value="4" ${ingCount === 4 ? 'selected' : ''}>أربع مواد (4)</option>
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${ingredientsConfigHtml}
          </div>
        </div>
      `;
    }

    const hasDissGlobal = batch.active_ingredients_config.some(ing => ing.has_diss);
    const hasUnifGlobal = batch.active_ingredients_config.some(ing => ing.has_unif);

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
          containerHtml += `
            <div class="qc-test-row-container" style="margin-top: 1.25rem; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 1rem;">
              <h6 style="font-weight: bold; color: var(--cyan); margin-bottom: 0.5rem; font-size: 0.85rem;">${metadata.title}:</h6>
          `;
          
          batch.active_ingredients_config.forEach((ing, k) => {
            // Check if this test is active for this specific ingredient
            let isTestActiveForIng = false;
            if (testType === 'assay') isTestActiveForIng = true;
            else if (testType === 'dissolution' || testType === 'coating_dissolution') isTestActiveForIng = ing.has_diss;
            else if (testType === 'uniformity' || testType === 'coating_uniformity') isTestActiveForIng = ing.has_unif;

            if (isTestActiveForIng) {
              containerHtml += `
                <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; display: grid; margin-bottom: 10px;">
                  <div class="form-group">
                    <label for="input-qc-range-${testType}-${k}">${metadata.rangeLabel} - (${ing.name}) *</label>
                    <input type="text" id="input-qc-range-${testType}-${k}" data-test-type="${testType}" data-ing-idx="${k}" class="qc-dynamic-range" required placeholder="${metadata.rangePlaceholder}" style="width: 100%; box-sizing: border-box;">
                  </div>
                  <div class="form-group">
                    <label for="input-qc-result-${testType}-${k}">النتيجة الفعلية المكتشفة - (${ing.name}) *</label>
                    <input type="text" id="input-qc-result-${testType}-${k}" data-test-type="${testType}" data-ing-idx="${k}" class="qc-dynamic-result" required placeholder="${metadata.resultPlaceholder}" style="width: 100%; box-sizing: border-box;">
                  </div>
                </div>
              `;
            }
          });
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

    // Role Authorization for QC Form and Configs
    const isProduction = currentUserRole === 'production';
    if (isProduction) {
      // Disable inputs and select elements inside form-add-qc-run
      if (elFormAddQCRun) {
        elFormAddQCRun.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
        const btnSubmitQC = document.getElementById('btn-submit-qc-run');
        if (btnSubmitQC) {
          btnSubmitQC.disabled = true;
          btnSubmitQC.style.opacity = '0.5';
          btnSubmitQC.title = 'تتطلب صلاحية إدارة الجودة أو المشرف';
        }
      }
      
      // Also disable editing the QC configs (ingredient names, checkboxes, etc.)
      if (elQCGlobalConfigContainer) {
        elQCGlobalConfigContainer.querySelectorAll('input, select').forEach(el => el.disabled = true);
      }
      if (elCoatingConfigContainer) {
        elCoatingConfigContainer.querySelectorAll('input').forEach(el => el.disabled = true);
      }
      if (elCarryOverConfigContainer) {
        elCarryOverConfigContainer.querySelectorAll('input').forEach(el => el.disabled = true);
      }
    } else {
      if (elFormAddQCRun) {
        elFormAddQCRun.querySelectorAll('input, select, button').forEach(el => el.disabled = false);
        const btnSubmitQC = document.getElementById('btn-submit-qc-run');
        if (btnSubmitQC) {
          btnSubmitQC.disabled = false;
          btnSubmitQC.style.opacity = '1';
          btnSubmitQC.title = '';
        }
      }
      if (elQCGlobalConfigContainer) {
        elQCGlobalConfigContainer.querySelectorAll('input, select').forEach(el => el.disabled = false);
      }
      if (elCoatingConfigContainer) {
        elCoatingConfigContainer.querySelectorAll('input').forEach(el => el.disabled = false);
      }
      if (elCarryOverConfigContainer) {
        elCarryOverConfigContainer.querySelectorAll('input').forEach(el => el.disabled = false);
      }
    }
  }



  async function handleQCSubmit(e) {
    e.preventDefault();
    try {
      if (currentUserRole === 'production') {
        alert('عذراً، لا تملك صلاحيات إدارة الجودة لتسجيل الفحوصات المخبرية.');
        return;
      }

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

      if (!Array.isArray(batch.active_ingredients_config)) {
        const count = parseInt(batch.active_ingredients_count, 10) || 1;
        batch.active_ingredients_config = [];
        for (let i = 0; i < count; i++) {
          batch.active_ingredients_config.push({
            name: `المادة الفعالة ${i + 1}`,
            has_diss: true,
            has_unif: true
          });
        }
      }

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
              timestamp: new Date().toLocaleString('en-US')
            };
            newRun.target_lots = targetLots;
            batch.qc_runs.push(newRun);
            savedTestsCount++;
            
            const label = testLabels[test_type] || test_type;
            logSummaryParts.push(`[${label}]: ${status === 'passed' ? 'مطابق 🟢' : 'غير مطابق 🔴'}`);
          }
        } else {
          const ingredientsData = [];
          let allPassed = true;
          let mainAssayVal = '';
          let mainQCRange = '';
          let firstActiveIng = true;

          for (let k = 0; k < batch.active_ingredients_config.length; k++) {
            const ing = batch.active_ingredients_config[k];
            
            let isTestActiveForIng = false;
            if (test_type === 'assay') isTestActiveForIng = true;
            else if (test_type === 'dissolution' || test_type === 'coating_dissolution') isTestActiveForIng = ing.has_diss;
            else if (test_type === 'uniformity' || test_type === 'coating_uniformity') isTestActiveForIng = ing.has_unif;

            if (isTestActiveForIng) {
              const rangeEl = document.getElementById(`input-qc-range-${test_type}-${k}`);
              const resultEl = document.getElementById(`input-qc-result-${test_type}-${k}`);
              if (rangeEl && resultEl) {
                const qc_range = rangeEl.value.trim();
                const assay_val = resultEl.value.trim();
                if (!qc_range || !assay_val) {
                  alert(`يرجى تعبئة المجال والنتيجة للمادة (${ing.name}) لفحص ${testLabels[test_type] || test_type}`);
                  return;
                }
                const isCompliant = evaluateQCCompliance(qc_range, assay_val);
                if (!isCompliant) allPassed = false;
                ingredientsData.push({
                  name: ing.name,
                  qc_range,
                  assay_val,
                  status: isCompliant ? 'passed' : 'failed'
                });

                if (firstActiveIng) {
                  mainAssayVal = assay_val;
                  mainQCRange = qc_range;
                  firstActiveIng = false;
                }
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
            ingredients: ingredientsData,
            sample_no,
            timestamp: new Date().toLocaleString('en-US')
          };
          newRun.target_lots = targetLots;
          batch.qc_runs.push(newRun);
          savedTestsCount++;

          const label = testLabels[test_type] || test_type;
          if (ingredientsData.length > 1) {
            const statusText = allPassed ? 'مطابق 🟢' : 'غير مطابق 🔴';
            logSummaryParts.push(`[${label}]: ${statusText} لـ (${ingredientsData.length}) مواد فعالة`);
          } else {
            logSummaryParts.push(`[${label}]: نتيجة ${mainAssayVal} (${allPassed ? 'مطابق 🟢' : 'غير مطابق 🔴'})`);
          }
        }
      }

      if (savedTestsCount > 0) {
        batch.logs.unshift({
          time: new Date().toLocaleString('en-US'),
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
    } catch (error) {
      console.error("Error in handleQCSubmit:", error);
      alert("حدث خطأ أثناء حفظ الفحص المخبري: " + error.message);
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
      const newCount = parseInt(count, 10) || 1;
      batch.active_ingredients_count = newCount;
      if (!Array.isArray(batch.active_ingredients_config)) {
        batch.active_ingredients_config = [];
      }
      // Adjust configuration size
      if (batch.active_ingredients_config.length < newCount) {
        for (let i = batch.active_ingredients_config.length; i < newCount; i++) {
          batch.active_ingredients_config.push({
            name: `المادة الفعالة ${i + 1}`,
            has_diss: true,
            has_unif: true
          });
        }
      } else if (batch.active_ingredients_config.length > newCount) {
        batch.active_ingredients_config = batch.active_ingredients_config.slice(0, newCount);
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

  window.updateIngredientName = function(index, nameVal) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch && batch.active_ingredients_config && batch.active_ingredients_config[index]) {
      batch.active_ingredients_config[index].name = nameVal.trim() || `المادة الفعالة ${index + 1}`;
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      
      // Re-render
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
    }
  };

  window.toggleIngredientTest = function(index, testKey, isChecked) {
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (batch && batch.active_ingredients_config && batch.active_ingredients_config[index]) {
      if (testKey === 'diss') {
        batch.active_ingredients_config[index].has_diss = isChecked;
      } else if (testKey === 'unif') {
        batch.active_ingredients_config[index].has_unif = isChecked;
      }
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      
      // Re-render
      renderQCLotsClearanceTable(batch);
      renderQCForm(batch);
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
    if (currentUserRole === 'production') {
      alert('عذراً، لا تملك صلاحيات إدارة الجودة لحذف الفحوصات المخبرية.');
      return;
    }
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

  function handleSaveRoleSelection() {
    const selectedRole = selectUserRole.value;
    const pin = inputRolePin.value.trim();
    
    // PIN Validation Map
    const rolePinMap = {
      admin: '9999',
      production: '1234',
      qc: '5555',
      wms: '8888',
      observer: '0000'
    };
    
    if (rolePinMap[selectedRole] && pin !== rolePinMap[selectedRole]) {
      alert('رمز المرور (PIN) غير صحيح لهذا الدور، يرجى المحاولة مجدداً.');
      return;
    }
    
    currentUserRole = selectedRole;
    localStorage.setItem('current_user_role', currentUserRole);
    
    if (modalRoleSwitcher) {
      modalRoleSwitcher.classList.add('hidden');
    }
    
    // Update the button text with current role name
    updateRoleSwitcherButtonText();
    
    // Re-render everything to apply permissions
    renderApp();
    if (activeBatchId) {
      const activeBatch = batches.find(b => b && String(b.id) === String(activeBatchId));
      if (activeBatch) {
        renderWorkflowTimeline(activeBatch);
        renderStageLogger(activeBatch);
        renderQCForm(activeBatch);
        renderQCLotsClearanceTable(activeBatch);
      }
    }
    
    if (window.showToast) {
      window.showToast('تم تطبيق الصلاحيات والدور الجديد بنجاح 🟢', 'success');
    } else {
      alert('تم تطبيق الصلاحيات والدور الجديد بنجاح 🟢');
    }
  }

  function updateRoleSwitcherButtonText() {
    if (!roleSwitcherText) return;
    const roleNames = {
      admin: 'الصلاحية: مشرف 👑',
      production: 'الصلاحية: الإنتاج ⚙️',
      qc: 'الصلاحية: الرقابة النوعية QC 🧪',
      wms: 'الصلاحية: المستودع 📦',
      observer: 'الصلاحية: مراقب 👁️'
    };
    roleSwitcherText.textContent = roleNames[currentUserRole] || 'الصلاحية: مشرف 👑';
  }

  window.notifyQCAssay = function(batchId) {
    if (currentUserRole !== 'production' && currentUserRole !== 'admin') {
      alert('عذراً، هذا الإجراء خاص بإدارة الإنتاج أو مشرف النظام.');
      return;
    }
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch) return;

    const msg = `طلب فحص ومعايرة كيميائية (Assay) 🧪 للتشغيلة [${batch.productName}] (رقم الباتش: ${batch.batchNo}) - يرجى سحب العينات وتحليل مادة التحضير.`;
    notificationsHistory.unshift({
      text: msg,
      timestamp: new Date().toLocaleTimeString('en-US'),
      unread: true
    });
    localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
    updateNotificationsBadge();
    playNotificationSound();

    if (window.showToast) {
      window.showToast(`تم إرسال إشعار للمخبر بنجاح لتحليل التحضير (Assay) للباتش [${batch.batchNo}]! 🟢`, 'success');
    }
    pushToCloud(true);
  };

  window.notifyQCDissUnif = function(batchId) {
    if (currentUserRole !== 'production' && currentUserRole !== 'admin') {
      alert('عذراً، هذا الإجراء خاص بإدارة الإنتاج أو مشرف النظام.');
      return;
    }
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch) return;

    const msg = `طلب تحليل الانحلالية وتجانس المحتوى 🧪 للتشغيلة [${batch.productName}] (رقم الباتش: ${batch.batchNo}) - يرجى سحب عينات الضغط والتعبئة.`;
    notificationsHistory.unshift({
      text: msg,
      timestamp: new Date().toLocaleTimeString('en-US'),
      unread: true
    });
    localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
    updateNotificationsBadge();
    playNotificationSound();

    if (window.showToast) {
      window.showToast(`تم إرسال إشعار للمخبر بنجاح لتحليل الانحلالية والتجانس للباتش [${batch.batchNo}]! 🟢`, 'success');
    }
    pushToCloud(true);
  };

  window.notifyQCToReleaseLot = function(lotId) {
    if (currentUserRole !== 'wms' && currentUserRole !== 'admin') {
      alert('عذراً، هذا الإجراء خاص بقسم المستودعات أو مشرف النظام.');
      return;
    }
    const lot = stockLots.find(l => String(l.Lot_ID) === String(lotId));
    if (!lot) return;

    const msg = `طلب تحليل وإفراج 🔒: قسم المستودعات يطلب من المختبر تحليل وإفراج المادة [${lot.Material_Name}] (اللوت: ${lot.Lot_Number}) واردة حديثاً.`;
    notificationsHistory.unshift({
      text: msg,
      timestamp: new Date().toLocaleTimeString('en-US'),
      unread: true
    });
    localStorage.setItem('notifications_history', JSON.stringify(notificationsHistory));
    updateNotificationsBadge();
    playNotificationSound();

    if (window.showToast) {
      window.showToast(`تم إرسال إشعار للمخبر بنجاح لتحليل وإفراج اللوت [${lot.Lot_Number}]! 🟢`, 'success');
    }
    pushToCloud(true);
  };

  window.showToast = function(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.pointerEvents = 'auto';
    toast.style.background = 'rgba(30, 41, 59, 0.95)';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    toast.style.marginBottom = '8px';
    
    // Customize border color based on type
    if (type === 'success') {
      toast.style.borderRight = '4px solid var(--emerald)';
    } else if (type === 'error') {
      toast.style.borderRight = '4px solid var(--rose)';
    } else if (type === 'warning') {
      toast.style.borderRight = '4px solid var(--amber)';
    } else {
      toast.style.borderRight = '4px solid var(--cyan)';
    }

    toast.style.color = '#fff';
    toast.style.padding = '12px 16px';
    toast.style.borderRadius = '6px';
    toast.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.15)';
    toast.style.fontSize = '0.85rem';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50px)';
    toast.style.transition = 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)';

    let iconHtml = '';
    if (type === 'success') {
      iconHtml = '<i data-lucide="check-circle" style="color: var(--emerald); width: 18px; height: 18px; flex-shrink: 0;"></i>';
    } else if (type === 'error') {
      iconHtml = '<i data-lucide="x-circle" style="color: var(--rose); width: 18px; height: 18px; flex-shrink: 0;"></i>';
    } else if (type === 'warning') {
      iconHtml = '<i data-lucide="alert-triangle" style="color: var(--amber); width: 18px; height: 18px; flex-shrink: 0;"></i>';
    } else {
      iconHtml = '<i data-lucide="bell" style="color: var(--cyan); width: 18px; height: 18px; flex-shrink: 0;"></i>';
    }

    toast.innerHTML = `
      ${iconHtml}
      <div style="flex-grow: 1; line-height: 1.4;">${message}</div>
      <button style="background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 1.1rem; padding: 0 4px; line-height: 1;" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);
    
    if (window.lucide) window.lucide.createIcons();

    // Trigger slide-in animation
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 50);

    // Slide-out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50px)';
      setTimeout(() => {
        toast.remove();
      }, 400);
    }, duration);
  };

  function updateNotificationsBadge() {
    if (!notificationsBadge) return;
    const unreadCount = notificationsHistory.filter(n => n.unread).length;
    if (unreadCount > 0) {
      notificationsBadge.textContent = unreadCount;
      notificationsBadge.classList.remove('hidden');
    } else {
      notificationsBadge.classList.add('hidden');
    }
  }

  function renderNotificationsDrawer() {
    if (!notificationsDrawerList) return;
    notificationsDrawerList.innerHTML = '';

    if (notificationsHistory.length === 0) {
      notificationsDrawerList.innerHTML = '<p style="color: var(--text-dim); font-size: 0.85rem; text-align: center; margin-top: 2rem;">لا توجد إشعارات حالياً.</p>';
      if (notificationsHistoryCount) notificationsHistoryCount.textContent = 'لا توجد إشعارات';
      return;
    }

    notificationsHistory.forEach(item => {
      const card = document.createElement('div');
      card.style.background = 'rgba(255, 255, 255, 0.03)';
      card.style.border = '1px solid rgba(255, 255, 255, 0.05)';
      
      // Highlight unread notifications
      if (item.unread) {
        card.style.borderRight = '3px solid var(--cyan)';
        card.style.background = 'rgba(6, 182, 212, 0.04)';
      } else {
        card.style.borderRight = '3px solid rgba(255, 255, 255, 0.15)';
      }

      card.style.borderRadius = '4px';
      card.style.padding = '10px 12px';
      card.style.fontSize = '0.8rem';
      card.style.color = '#e2e8f0';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '4px';

      card.innerHTML = `
        <div style="line-height: 1.4;">${item.text}</div>
        <span style="font-size: 0.7rem; color: var(--text-dim); align-self: flex-end;">${item.timestamp}</span>
      `;
      notificationsDrawerList.appendChild(card);
    });

    if (notificationsHistoryCount) {
      notificationsHistoryCount.textContent = `إجمالي الإشعارات: ${notificationsHistory.length}`;
    }
  }

  function playNotificationSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      const now = ctx.currentTime;
      
      // double bell sound: C5 followed by G5 chime
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(783.99, now + 0.12); // G5
      
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6); // fade out over 0.6s
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (err) {
      console.warn("Web Audio playback failed:", err);
    }
  }

  // =========================================================================
  // WMS (Warehouse Management System) Logic and Views
  // =========================================================================
  let currentWMSTab = 'stock';
  let currentHistoryFilter = 'all';
  let wmsExcelImportTemp = [];

  function setupWMSEventListeners() {
    // WMS Tab switching
    const tabs = document.querySelectorAll('#wms-sub-tabs .filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        currentWMSTab = tab.getAttribute('data-wms-tab') || e.currentTarget.getAttribute('data-wms-tab');
        if (currentWMSTab === 'sales') {
          const searchInput = document.getElementById('wms-sales-product-search');
          const hiddenProduct = document.getElementById('wms-sales-product');
          const salesQty = document.getElementById('wms-sales-qty');
          if (searchInput) searchInput.value = '';
          if (hiddenProduct) hiddenProduct.value = '';
          if (salesQty) salesQty.value = '';
          const rec = document.getElementById('wms-fefo-recommendation');
          if (rec) rec.classList.add('hidden');
        }
        renderWMSViews();
      });
    });

    // Excel Import Buttons and Modal Controls
    const btnImportRaw = document.getElementById('btn-import-raw-excel');
    const btnImportReady = document.getElementById('btn-import-ready-excel');
    const modalExcelImport = document.getElementById('modal-wms-excel-import');
    const closeExcelImportModal = document.getElementById('close-wms-excel-import-modal');

    window.excelImportTargetType = 'raw'; 

    if (btnImportRaw) {
      btnImportRaw.addEventListener('click', () => {
        window.excelImportTargetType = 'raw';
        const title = document.getElementById('wms-excel-import-title');
        const desc = document.getElementById('wms-excel-import-desc');
        if (title) title.innerHTML = 'استيراد الأرصدة الافتتاحية للمواد الخام (Excel) 📥';
        if (desc) desc.textContent = 'استيراد لمرة واحدة لمطابقة أرصدة المواد الأولية الحالية بالمعمل كـ Released.';
        if (modalExcelImport) modalExcelImport.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      });
    }

    if (btnImportReady) {
      btnImportReady.addEventListener('click', () => {
        window.excelImportTargetType = 'ready';
        const title = document.getElementById('wms-excel-import-title');
        const desc = document.getElementById('wms-excel-import-desc');
        if (title) title.innerHTML = 'استيراد الأرصدة الافتتاحية للرصيد الجاهز (Excel) 📥';
        if (desc) desc.textContent = 'استيراد لمرة واحدة لمطابقة أرصدة المنتجات التامة الجاهزة الحالية بالمعمل كـ Released.';
        if (modalExcelImport) modalExcelImport.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      });
    }

    const btnImportPackaging = document.getElementById('btn-import-packaging-excel');
    if (btnImportPackaging) {
      btnImportPackaging.addEventListener('click', () => {
        window.excelImportTargetType = 'packaging';
        const title = document.getElementById('wms-excel-import-title');
        const desc = document.getElementById('wms-excel-import-desc');
        if (title) title.innerHTML = 'استيراد الأرصدة الافتتاحية لمواد التغليف (Excel) 📥';
        if (desc) desc.textContent = 'استيراد لمرة واحدة لمطابقة أرصدة مواد التعبئة والتغليف الحالية بالمعمل كـ Released.';
        if (modalExcelImport) modalExcelImport.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();
      });
    }

    if (closeExcelImportModal) {
      closeExcelImportModal.addEventListener('click', () => {
        if (modalExcelImport) modalExcelImport.classList.add('hidden');
        wmsExcelImportTemp = [];
        const preview = document.getElementById('wms-excel-preview-container');
        if (preview) preview.classList.add('hidden');
        const excelFile = document.getElementById('wms-excel-file');
        if (excelFile) excelFile.value = '';
      });
    }

    // Excel import file listener
    const excelFile = document.getElementById('wms-excel-file');
    if (excelFile) excelFile.addEventListener('change', handleExcelImportChange);

    const btnCancelImport = document.getElementById('wms-btn-cancel-import');
    if (btnCancelImport) {
      btnCancelImport.addEventListener('click', () => {
        if (modalExcelImport) modalExcelImport.classList.add('hidden');
        wmsExcelImportTemp = [];
        const preview = document.getElementById('wms-excel-preview-container');
        if (preview) preview.classList.add('hidden');
        const excelFile = document.getElementById('wms-excel-file');
        if (excelFile) excelFile.value = '';
      });
    }

    const btnConfirmImport = document.getElementById('wms-btn-confirm-import');
    if (btnConfirmImport) btnConfirmImport.addEventListener('click', confirmExcelImport);

    const formInbound = document.getElementById('wms-form-inbound');
    if (formInbound) formInbound.addEventListener('submit', handleInboundSubmit);

    // Expiry Date inputs sync
    const elExpiryDate = document.getElementById('wms-in-expiry');
    const elExpiryMonths = document.getElementById('wms-in-expiry-months');
    const elExpiryMM = document.getElementById('wms-in-expiry-mm');
    const elExpiryYYYY = document.getElementById('wms-in-expiry-yyyy');

    if (elExpiryMonths) {
      elExpiryMonths.addEventListener('input', () => {
        const months = parseInt(elExpiryMonths.value, 10);
        if (isNaN(months) || months <= 0) return;
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const yyyy = lastDay.getFullYear();
        const mm = String(lastDay.getMonth() + 1).padStart(2, '0');
        const dd = String(lastDay.getDate()).padStart(2, '0');
        
        if (elExpiryDate) elExpiryDate.value = `${yyyy}-${mm}-${dd}`;
        if (elExpiryMM) elExpiryMM.value = mm;
        if (elExpiryYYYY) elExpiryYYYY.value = String(yyyy);
      });
    }

    const syncMMYYYY = () => {
      if (!elExpiryMM || !elExpiryYYYY || !elExpiryDate) return;
      const mm = elExpiryMM.value;
      const yyyy = elExpiryYYYY.value;
      if (!mm || !yyyy) return;
      const lastDay = new Date(parseInt(yyyy, 10), parseInt(mm, 10), 0);
      const dd = String(lastDay.getDate()).padStart(2, '0');
      elExpiryDate.value = `${yyyy}-${mm}-${dd}`;
      if (elExpiryMonths) elExpiryMonths.value = '';
    };

    if (elExpiryMM) elExpiryMM.addEventListener('change', syncMMYYYY);
    if (elExpiryYYYY) elExpiryYYYY.addEventListener('change', syncMMYYYY);

    if (elExpiryDate) {
      elExpiryDate.addEventListener('change', () => {
        const val = elExpiryDate.value;
        if (!val) return;
        const parts = val.split('-');
        if (parts.length === 3) {
          if (elExpiryMM) elExpiryMM.value = parts[1];
          if (elExpiryYYYY) elExpiryYYYY.value = parts[0];
          if (elExpiryMonths) elExpiryMonths.value = '';
        }
      });
    }

    const formSales = document.getElementById('wms-form-sales');
    if (formSales) formSales.addEventListener('submit', handleSalesSubmit);

    // Stock Search
    const stockSearch = document.getElementById('wms-stock-search');
    if (stockSearch) stockSearch.addEventListener('input', renderStockLots);

    const packagingSearch = document.getElementById('wms-packaging-search');
    if (packagingSearch) packagingSearch.addEventListener('input', renderPackagingLots);

    const readySearch = document.getElementById('wms-ready-search');
    if (readySearch) readySearch.addEventListener('input', renderReadyProducts);

    // Excel Export listeners
    const btnExportRawExcel = document.getElementById('btn-export-raw-excel');
    if (btnExportRawExcel) {
      btnExportRawExcel.addEventListener('click', () => exportStockToExcel('raw'));
    }

    const btnExportPackagingExcel = document.getElementById('btn-export-packaging-excel');
    if (btnExportPackagingExcel) {
      btnExportPackagingExcel.addEventListener('click', () => exportStockToExcel('packaging'));
    }

    const btnExportReadyExcel = document.getElementById('btn-export-ready-excel');
    if (btnExportReadyExcel) {
      btnExportReadyExcel.addEventListener('click', () => exportStockToExcel('ready'));
    }

    // Clear Raw Materials Stock
    const btnClearAll = document.getElementById('wms-btn-clear-all');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        if (!confirm('⚠️ تحذير حرج: هل أنت متأكد من تفريغ وتصفير كامل رصيد المواد الأولية بالمستودع؟\nلا يمكن التراجع عن هذا الإجراء!')) {
          return;
        }
        
        const pin = prompt('الرجاء إدخال رمز تأكيد الحذف (الـ PIN code لمدير النظام):');
        if (pin !== '9999') {
          alert('رمز التأكيد غير صحيح! تم إلغاء العملية.');
          return;
        }
        
        const isRawMaterial = lot => {
          if (!lot || !lot.Unit) return false;
          const u = lot.Unit.toLowerCase();
          return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
        };

        // Remove only raw materials
        const lotsToClear = stockLots.filter(lot => {
          if (!lot) return false;
          const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
          return type === 'raw';
        });

        stockLots = stockLots.filter(lot => !lotsToClear.includes(lot));

        // Purge cleared raw materials from all batches' formulation lists
        lotsToClear.forEach(lot => {
          removeLotFromBatches(lot.Lot_ID);
        });

        // Add WMS transaction log
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: 'system',
          Tx_Type: 'Clear_Inventory',
          Quantity: 0,
          Material_Type: 'raw',
          Reference_ID: 'تصفير كامل مستودع المواد الأولية',
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });

        saveWMS(true);
        logUserActivity('تصفير المستودع', 'تم تصفير وتطهير مستودع المواد الأولية الخام بالكامل.');
        renderWMSViews();
        
        if (window.showToast) {
          window.showToast('تم تصفير مستودع المواد الأولية بالكامل 🗑️', 'success');
        }
      });
    }

    // Clear Packaging Materials Stock
    const btnClearPackaging = document.getElementById('wms-btn-clear-packaging');
    if (btnClearPackaging) {
      btnClearPackaging.addEventListener('click', () => {
        if (!confirm('⚠️ تحذير حرج: هل أنت متأكد من تفريغ وتصفير كامل رصيد مواد التغليف بالمستودع؟\nلا يمكن التراجع عن هذا الإجراء!')) {
          return;
        }
        
        const pin = prompt('الرجاء إدخال رمز تأكيد الحذف (الـ PIN code لمدير النظام):');
        if (pin !== '9999') {
          alert('رمز التأكيد غير صحيح! تم إلغاء العملية.');
          return;
        }
        
        const isRawMaterial = lot => {
          if (!lot || !lot.Unit) return false;
          const u = lot.Unit.toLowerCase();
          return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
        };

        const lotsToClear = stockLots.filter(lot => {
          if (!lot) return false;
          const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
          return type === 'packaging';
        });

        stockLots = stockLots.filter(lot => !lotsToClear.includes(lot));

        // Add WMS transaction log
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: 'system',
          Tx_Type: 'Clear_Inventory',
          Quantity: 0,
          Material_Type: 'packaging',
          Reference_ID: 'تصفير كامل مستودع مواد التغليف',
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });

        saveWMS(true);
        logUserActivity('تصفير المستودع', 'تم تصفير وتطهير مستودع مواد التغليف بالكامل.');
        renderWMSViews();
        
        if (window.showToast) {
          window.showToast('تم تصفير مستودع مواد التغليف بالكامل 🗑️', 'success');
        }
      });
    }

    // Clear Finished Products Stock
    const btnClearReady = document.getElementById('wms-btn-clear-ready');
    if (btnClearReady) {
      btnClearReady.addEventListener('click', () => {
        if (!confirm('⚠️ تحذير حرج: هل أنت متأكد من تفريغ وتصفير كامل الرصيد الجاهز للمنتجات التامة؟\nلا يمكن التراجع عن هذا الإجراء!')) {
          return;
        }
        
        const pin = prompt('الرجاء إدخال رمز تأكيد الحذف (الـ PIN code لمدير النظام):');
        if (pin !== '9999') {
          alert('رمز التأكيد غير صحيح! تم إلغاء العملية.');
          return;
        }
        
        const isRawMaterial = lot => {
          if (!lot || !lot.Unit) return false;
          const u = lot.Unit.toLowerCase();
          return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
        };

        // Remove only ready finished products
        stockLots = stockLots.filter(lot => {
          if (!lot) return false;
          const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
          return type !== 'ready';
        });

        // Add WMS transaction log
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: 'system',
          Tx_Type: 'Clear_Inventory',
          Quantity: 0,
          Material_Type: 'ready',
          Reference_ID: 'تصفير كامل رصيد المنتجات التامة (الرصيد الجاهز)',
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });

        saveWMS(true);
        logUserActivity('تصفير المستودع', 'تم تصفير وتطهير رصيد المنتجات الجاهزة (الرصيد الجاهز) بالكامل.');
        renderWMSViews();
        
        if (window.showToast) {
          window.showToast('تم تصفير الرصيد الجاهز بالكامل 🗑️', 'success');
        }
      });
    }

    // History Filters event listeners
    const historyFilters = document.querySelectorAll('#wms-history-filters .filter-tab');
    historyFilters.forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentHistoryFilter = btn.getAttribute('data-history-filter') || e.currentTarget.getAttribute('data-history-filter');
        
        historyFilters.forEach(b => {
          if (b.getAttribute('data-history-filter') === currentHistoryFilter) {
            b.classList.add('active');
            b.style.background = 'var(--primary)';
            b.style.borderColor = 'var(--primary)';
            b.style.color = '#fff';
          } else {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.borderColor = 'rgba(255,255,255,0.15)';
            b.style.color = 'var(--text-dim)';
          }
        });

        renderTransactionsLog();
      });
    });

    // Formulation dynamically adding rows
    if (btnAddFormulationRow) {
      btnAddFormulationRow.addEventListener('click', () => {
        addWeighingFormulationRow('', 0);
      });
    }

    // Packaging materials dynamically adding rows
    const btnAddPackagingRow = document.getElementById('btn-add-packaging-row');
    if (btnAddPackagingRow) {
      btnAddPackagingRow.addEventListener('click', () => {
        addPackagingMaterialRow('', 0);
      });
    }



    // Sales/FEFO Form
    setupSalesAutocomplete();
    window.currentSalesInvoiceItems = [];

    const salesQty = document.getElementById('wms-sales-qty');
    if (salesQty) salesQty.addEventListener('input', updateFEFORecommendation);

    const btnSalesAddItem = document.getElementById('wms-btn-sales-add-item');
    if (btnSalesAddItem) {
      btnSalesAddItem.addEventListener('click', () => {
        const select = document.getElementById('wms-sales-product');
        const inputQty = document.getElementById('wms-sales-qty');
        const inputSearch = document.getElementById('wms-sales-product-search');

        if (!select || !inputQty || !inputSearch) return;

        const lotId = select.value;
        const qty = parseFloat(inputQty.value) || 0;

        if (!lotId) {
          alert('الرجاء اختيار المنتج والباتش أولاً!');
          return;
        }
        if (qty <= 0) {
          alert('الرجاء تحديد كمية شحن صالحة أكبر من الصفر!');
          return;
        }

        const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
        if (!lot) {
          alert('الباتش المحدد غير موجود!');
          return;
        }

        if (qty > lot.Current_Qty) {
          alert(`الكمية المطلوبة (${qty} ${lot.Unit}) أكبر من الرصيد المتوفر في الباتش (${lot.Current_Qty} ${lot.Unit})!`);
          return;
        }

        const exists = window.currentSalesInvoiceItems.some(item => String(item.lotId) === String(lotId));
        if (exists) {
          alert('هذا المنتج وهذا الباتش مضاف مسبقاً للفاتورة الحالية!');
          return;
        }

        window.currentSalesInvoiceItems.push({
          lotId: lot.Lot_ID,
          name: lot.Material_Name,
          lotNumber: lot.Lot_Number,
          qty: qty,
          unit: lot.Unit,
          expiry: lot.Expiry_Date
        });

        inputSearch.value = '';
        select.value = '';
        inputQty.value = '';

        document.getElementById('wms-fefo-recommendation').classList.add('hidden');
        renderSalesInvoiceTable();
      });
    }
  }

  function renderWMSViews() {
    updateWMSStats();
    
    // Toggle active sub-tab buttons
    const tabs = document.querySelectorAll('#wms-sub-tabs .filter-tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-wms-tab') === currentWMSTab) {
        tab.classList.add('active');
        tab.style.background = 'var(--primary)';
        tab.style.borderColor = 'var(--primary)';
        tab.style.color = '#fff';
      } else {
        tab.classList.remove('active');
        tab.style.background = 'transparent';
        tab.style.borderColor = 'rgba(255,255,255,0.15)';
        tab.style.color = 'var(--text-dim)';
      }
    });

    // Toggle sub-views
    const subViews = document.querySelectorAll('.wms-sub-view');
    subViews.forEach(view => {
      if (view.id === `wms-view-${currentWMSTab}`) {
        view.classList.remove('hidden');
      } else {
        view.classList.add('hidden');
      }
    });

    // Clear buttons display is handled directly by HTML/CSS and protected by PIN prompts.

    // Render corresponding sub-view data
    if (currentWMSTab === 'stock') {
      renderStockLots();
    } else if (currentWMSTab === 'packaging') {
      renderPackagingLots();
    } else if (currentWMSTab === 'ready') {
      renderReadyProducts();
    } else if (currentWMSTab === 'history') {
      renderTransactionsLog();
    } else if (currentWMSTab === 'sales') {
      populateSalesProductsDropdown();
    } else if (currentWMSTab === 'trace') {
      renderTraceabilityView();
    }
  }

  function updateWMSStats() {
    let relCount = 0, relWeight = 0;
    let quaCount = 0, quaWeight = 0;
    let rejCount = 0, rejWeight = 0;

    stockLots.forEach(lot => {
      if (!lot) return;
      const qty = parseFloat(lot.Current_Qty) || 0;
      if (lot.Status === 'Released') {
        relCount++;
        relWeight += qty;
      } else if (lot.Status === 'Quarantine') {
        quaCount++;
        quaWeight += qty;
      } else if (lot.Status === 'Rejected') {
        rejCount++;
        rejWeight += qty;
      }
    });

    const elQuaCount = document.getElementById('wms-stat-quarantine-count');
    const elRejCount = document.getElementById('wms-stat-rejected-count');
    const elRejWeight = document.getElementById('wms-stat-rejected-weight');

    if (elQuaCount) elQuaCount.textContent = quaCount;
    if (elRejCount) elRejCount.textContent = rejCount;
    if (elRejWeight) elRejWeight.textContent = `${rejWeight.toFixed(3)} ${stockLots[0]?.Unit || 'kg'}`;
  }

  function renderStockLots() {
    const tbody = document.getElementById('wms-stock-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('wms-stock-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };

    const filtered = stockLots.filter(lot => {
      if (!lot) return false;
      
      const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
      if (type !== 'raw') return false;

      return lot.Material_Code.toLowerCase().includes(query) ||
             lot.Material_Name.toLowerCase().includes(query) ||
             lot.Lot_Number.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">لا توجد مواد تطابق البحث أو المخزون فارغ.</td></tr>`;
      return;
    }

    filtered.forEach(lot => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

      const statusMap = {
        Released: '<span class="wms-badge released"><i data-lucide="check-circle-2" style="width:12px;height:12px;"></i> مقبول ومفرج عنه</span>',
        Quarantine: '<span class="wms-badge quarantine"><i data-lucide="shield-alert" style="width:12px;height:12px;"></i> محجور (تحت الفحص)</span>',
        Rejected: '<span class="wms-badge rejected"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> مرفوض معزول</span>'
      };

      // QC Actions HTML
      let actionsHtml = '-';
      if (currentUserRole === 'admin' || currentUserRole === 'qc' || currentUserRole === 'wms') {
        const btnClass = 'btn btn-secondary btn-sm';
        const style = 'padding: 2px 6px; font-size: 0.72rem; margin: 0 2px;';
        let deleteBtnHtml = '';
        if (currentUserRole === 'admin' || currentUserRole === 'wms') {
          deleteBtnHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="openReconciliationModal('${lot.Lot_ID}')" title="تسوية الرصيد">تسوية ⚖️</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="deleteStockLot('${lot.Lot_ID}')" title="حذف اللوت نهائياً">
              <i data-lucide="trash-2" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
            </button>
          `;
        }
        
        if (lot.Status === 'Quarantine') {
          let requestBtnHtml = '';
          if (currentUserRole === 'wms' || currentUserRole === 'admin') {
            requestBtnHtml = `<button class="${btnClass}" style="${style} border-color: var(--cyan); color: var(--cyan);" onclick="notifyQCToReleaseLot('${lot.Lot_ID}')" title="طلب تحليل وإفراج من المختبر">طلب تحليل 🧪</button>`;
          }
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${requestBtnHtml}
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Released') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Rejected') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            ${deleteBtnHtml}
          `;
        }
      }

      let attachmentHtml = '';
      if (lot.Release_Attachment) {
        attachmentHtml = `
          <a href="#" onclick="downloadQCReleaseAttachment('${lot.Lot_ID}'); return false;" style="margin-right: 6px; color: var(--cyan);" title="عرض/تحميل مستند الإفراج النهائي: ${lot.Release_Attachment_Name || 'مرفق'}">
            <i data-lucide="paperclip" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i>
          </a>
        `;
      }

      tr.innerHTML = `
        <td style="padding: 8px; font-weight: bold; color: var(--cyan);">${lot.Material_Code || '-'}</td>
        <td style="padding: 8px; color: #fff;">${lot.Material_Name || '-'}</td>
        <td style="padding: 8px;"><strong style="color: var(--amber); font-family: monospace;">${lot.Lot_Number || '-'}</strong>${attachmentHtml}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Supplier || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Production_Date || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Entry_Date || '-'}</td>
        <td style="padding: 8px; color: var(--rose);">${lot.Expiry_Date || '-'}</td>
        <td style="padding: 8px; font-weight: bold; color: var(--emerald);">${lot.Current_Qty} ${lot.Unit}</td>
        <td style="padding: 8px; color: var(--cyan);">${lot.Storage_Location || '-'}</td>
        <td style="padding: 8px;">${statusMap[lot.Status] || lot.Status}</td>
        <td style="padding: 8px; text-align: center;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function renderPackagingLots() {
    const tbody = document.getElementById('wms-packaging-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('wms-packaging-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };

    const filtered = stockLots.filter(lot => {
      if (!lot) return false;
      
      const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
      if (type !== 'packaging') return false;

      return lot.Material_Code.toLowerCase().includes(query) ||
             lot.Material_Name.toLowerCase().includes(query) ||
             lot.Lot_Number.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">لا توجد مواد تغليف تطابق البحث أو مستودع التغليف فارغ.</td></tr>`;
      return;
    }

    filtered.forEach(lot => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

      const statusMap = {
        Released: '<span class="wms-badge released"><i data-lucide="check-circle-2" style="width:12px;height:12px;"></i> مقبول ومفرج عنه</span>',
        Quarantine: '<span class="wms-badge quarantine"><i data-lucide="shield-alert" style="width:12px;height:12px;"></i> محجور (تحت الفحص)</span>',
        Rejected: '<span class="wms-badge rejected"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> مرفوض معزول</span>'
      };

      // QC Actions HTML
      let actionsHtml = '-';
      if (currentUserRole === 'admin' || currentUserRole === 'qc' || currentUserRole === 'wms') {
        const btnClass = 'btn btn-secondary btn-sm';
        const style = 'padding: 2px 6px; font-size: 0.72rem; margin: 0 2px;';
        let deleteBtnHtml = '';
        if (currentUserRole === 'admin' || currentUserRole === 'wms') {
          deleteBtnHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="openReconciliationModal('${lot.Lot_ID}')" title="تسوية الرصيد">تسوية ⚖️</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="deleteStockLot('${lot.Lot_ID}')" title="حذف اللوت نهائياً">
              <i data-lucide="trash-2" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
            </button>
          `;
        }

        if (lot.Status === 'Quarantine') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Released') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Rejected') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            ${deleteBtnHtml}
          `;
        }
      }

      let attachmentHtml = '';
      if (lot.Release_Attachment) {
        attachmentHtml = `
          <a href="#" onclick="downloadQCReleaseAttachment('${lot.Lot_ID}'); return false;" style="margin-right: 6px; color: var(--cyan);" title="عرض/تحميل مستند الإفراج النهائي: ${lot.Release_Attachment_Name || 'مرفق'}">
            <i data-lucide="paperclip" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i>
          </a>
        `;
      }

      tr.innerHTML = `
        <td style="padding: 8px; font-weight: bold; color: var(--cyan);">${lot.Material_Code || '-'}</td>
        <td style="padding: 8px; color: #fff;">${lot.Material_Name || '-'}</td>
        <td style="padding: 8px;"><strong style="color: var(--amber); font-family: monospace;">${lot.Lot_Number || '-'}</strong>${attachmentHtml}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Supplier || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Production_Date || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Entry_Date || '-'}</td>
        <td style="padding: 8px; color: var(--rose);">${lot.Expiry_Date || '-'}</td>
        <td style="padding: 8px; font-weight: bold; color: var(--emerald);">${lot.Current_Qty} ${lot.Unit}</td>
        <td style="padding: 8px; color: var(--cyan);">${lot.Storage_Location || '-'}</td>
        <td style="padding: 8px;">${statusMap[lot.Status] || lot.Status}</td>
        <td style="padding: 8px; text-align: center;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function renderReadyProducts() {
    const tbody = document.getElementById('wms-ready-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('wms-ready-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };

    const filtered = stockLots.filter(lot => {
      if (!lot) return false;

      const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
      if (type !== 'ready') return false;

      return lot.Material_Code.toLowerCase().includes(query) ||
             lot.Material_Name.toLowerCase().includes(query) ||
             lot.Lot_Number.toLowerCase().includes(query);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">لا توجد منتجات جاهزة تطابق البحث أو الرصيد الجاهز فارغ.</td></tr>`;
      return;
    }

    filtered.forEach(lot => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

      const statusMap = {
        Released: '<span class="wms-badge released"><i data-lucide="check-circle-2" style="width:12px;height:12px;"></i> مقبول ومفرج عنه</span>',
        Quarantine: '<span class="wms-badge quarantine"><i data-lucide="shield-alert" style="width:12px;height:12px;"></i> محجور (تحت الفحص)</span>',
        Rejected: '<span class="wms-badge rejected"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> مرفوض معزول</span>'
      };

      // Actions HTML
      let actionsHtml = '-';
      if (currentUserRole === 'admin' || currentUserRole === 'qc' || currentUserRole === 'wms') {
        const btnClass = 'btn btn-secondary btn-sm';
        const style = 'padding: 2px 6px; font-size: 0.72rem; margin: 0 2px;';
        let deleteBtnHtml = '';
        if (currentUserRole === 'admin' || currentUserRole === 'wms') {
          deleteBtnHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="openReconciliationModal('${lot.Lot_ID}')" title="تسوية الرصيد">تسوية ⚖️</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="deleteStockLot('${lot.Lot_ID}')" title="حذف اللوت نهائياً">
              <i data-lucide="trash-2" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
            </button>
          `;
        }
        
        if (lot.Status === 'Quarantine') {
          let requestBtnHtml = '';
          if (currentUserRole === 'wms' || currentUserRole === 'admin') {
            requestBtnHtml = `<button class="${btnClass}" style="${style} border-color: var(--cyan); color: var(--cyan);" onclick="notifyQCToReleaseLot('${lot.Lot_ID}')" title="طلب تحليل وإفراج من المختبر">طلب تحليل 🧪</button>`;
          }
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${requestBtnHtml}
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Released') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--rose); color: var(--rose);" onclick="changeLotStatus('${lot.Lot_ID}', 'Rejected')">رفض ❌</button>
            ${deleteBtnHtml}
          `;
        } else if (lot.Status === 'Rejected') {
          actionsHtml = `
            <button class="${btnClass}" style="${style} border-color: var(--amber); color: var(--amber);" onclick="changeLotStatus('${lot.Lot_ID}', 'Quarantine')">حجر 🔒</button>
            <button class="${btnClass}" style="${style} border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatus('${lot.Lot_ID}', 'Released')">إفراج ✅</button>
            ${deleteBtnHtml}
          `;
        }
      }

      let attachmentHtml = '';
      if (lot.Release_Attachment) {
        attachmentHtml = `
          <a href="#" onclick="downloadQCReleaseAttachment('${lot.Lot_ID}'); return false;" style="margin-right: 6px; color: var(--cyan);" title="عرض/تحميل مستند الإفراج النهائي: ${lot.Release_Attachment_Name || 'مرفق'}">
            <i data-lucide="paperclip" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i>
          </a>
        `;
      }

      tr.innerHTML = `
        <td style="padding: 8px; font-weight: bold; color: var(--cyan);">${lot.Material_Code || '-'}</td>
        <td style="padding: 8px; color: #fff;">${lot.Material_Name || '-'}</td>
        <td style="padding: 8px;"><strong style="color: var(--amber); font-family: monospace;">${lot.Lot_Number || '-'}</strong>${attachmentHtml}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Supplier || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Production_Date || '-'}</td>
        <td style="padding: 8px; color: var(--text-dim);">${lot.Entry_Date || '-'}</td>
        <td style="padding: 8px; color: var(--rose);">${lot.Expiry_Date || '-'}</td>
        <td style="padding: 8px; font-weight: bold; color: var(--emerald);">${lot.Current_Qty} ${lot.Unit}</td>
        <td style="padding: 8px; color: var(--cyan);">${lot.Storage_Location || '-'}</td>
        <td style="padding: 8px;">${statusMap[lot.Status] || lot.Status}</td>
        <td style="padding: 8px; text-align: center;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  window.changeLotStatus = function(lotId, newStatus) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) return;

    if (newStatus === 'Released' && lot.Material_Type === 'ready') {
      document.getElementById('release-lot-id').value = lotId;
      document.getElementById('release-product-name').textContent = lot.Material_Name;
      document.getElementById('release-lot-number').textContent = lot.Lot_Number;
      document.getElementById('release-attachment-file').value = '';
      document.getElementById('modal-qc-final-release').classList.remove('hidden');
      return;
    }

    const oldStatus = lot.Status;
    lot.Status = newStatus;
    lot.updatedAt = Date.now();

    // Log transaction
    const tx = {
      Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      Lot_ID: lotId,
      Tx_Type: 'QC_Status_Change',
      Quantity: 0,
      Reference_ID: `تغيير حالة من ${oldStatus} إلى ${newStatus}`,
      Performed_By: currentUserRole,
      Timestamp: Date.now()
    };
    wmsTransactions.unshift(tx);

    saveWMS(true);
    renderWMSViews();

    if (window.showToast) {
      window.showToast(`تم تغيير حالة اللوت [${lot.Lot_Number}] للمادة [${lot.Material_Name}] إلى ${newStatus} بنجاح 🧪`, 'success');
    }
  };

  function removeLotFromBatches(lotId) {
    let batchModified = false;
    batches.forEach(b => {
      if (b && Array.isArray(b.stages)) {
        let singleBatchModified = false;
        b.stages.forEach(stage => {
          if (stage && Array.isArray(stage.formulation)) {
            const originalLength = stage.formulation.length;
            stage.formulation = stage.formulation.filter(row => {
              const id = row.Lot_ID || row.lotId;
              return String(id) !== String(lotId);
            });
            if (stage.formulation.length !== originalLength) {
              singleBatchModified = true;
              
              // Recalculate total accepted weight for the weighing stage if it was modified
              let newTotal = 0;
              stage.formulation.forEach(row => {
                const qtyVal = row.Quantity || row.qty || 0;
                newTotal += parseFloat(qtyVal) || 0;
              });
              stage.acceptedKg = parseFloat(newTotal.toFixed(3));
              stage.version = (stage.version || 0) + 1;
            }
          }
          if (stage && Array.isArray(stage.packaging_materials)) {
            const originalLength = stage.packaging_materials.length;
            stage.packaging_materials = stage.packaging_materials.filter(row => {
              const id = row.Lot_ID || row.lotId;
              return String(id) !== String(lotId);
            });
            if (stage.packaging_materials.length !== originalLength) {
              singleBatchModified = true;
              stage.version = (stage.version || 0) + 1;
            }
          }
        });
        if (singleBatchModified) {
          batchModified = true;
          b.version = (b.version || 0) + 1;
          b.updatedAt = Date.now();
        }
      }
    });

    if (batchModified) {
      localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
      if (typeof renderApp === 'function') renderApp();
    }
  }

  window.deleteStockLot = function(lotId) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) return;

    if (!confirm(`هل أنت متأكد من حذف اللوت نهائياً من المستودع؟\nالمادة: ${lot.Material_Name}\nرقم اللوت: ${lot.Lot_Number}`)) {
      return;
    }

    // Remove from stockLots
    stockLots = stockLots.filter(l => l && String(l.Lot_ID) !== String(lotId));
    // Remove related transactions
    wmsTransactions = wmsTransactions.filter(tx => tx && String(tx.Lot_ID) !== String(lotId));

    // Remove from all batches' formulation lists!
    removeLotFromBatches(lotId);

    saveWMS(true);
    logUserActivity('حذف لوت مادة', `تم حذف اللوت ${lot.Lot_Number} للمادة ${lot.Material_Name} نهائياً وتطهير سجلات الأضابير.`);
    renderWMSViews();

    if (window.showToast) {
      window.showToast('تم حذف اللوت وتطهير سجلات أوزان التشغيلات بنجاح 🗑️', 'success');
    }
  };

  window.openReconciliationModal = function(lotId) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) return;

    document.getElementById('recon-lot-id').value = lot.Lot_ID;
    document.getElementById('recon-material-code').value = lot.Material_Code;
    document.getElementById('recon-material-name').value = lot.Material_Name;
    document.getElementById('recon-lot-number').value = lot.Lot_Number;
    document.getElementById('recon-qty').value = lot.Current_Qty;
    document.getElementById('recon-expiry-date').value = lot.Expiry_Date;
    document.getElementById('recon-storage-location').value = lot.Storage_Location || '';
    document.getElementById('recon-unit-label').textContent = lot.Unit || 'kg';

    document.getElementById('modal-wms-reconciliation').classList.remove('hidden');
  };

  // Bind close buttons for Reconciliation Modal
  const closeReconciliationModal = () => {
    document.getElementById('modal-wms-reconciliation').classList.add('hidden');
  };
  const closeReconBtn = document.getElementById('close-wms-reconciliation-modal');
  if (closeReconBtn) closeReconBtn.addEventListener('click', closeReconciliationModal);
  const cancelReconBtn = document.getElementById('btn-cancel-wms-reconciliation');
  if (cancelReconBtn) cancelReconBtn.addEventListener('click', closeReconciliationModal);

  const formReconciliation = document.getElementById('form-wms-reconciliation');
  if (formReconciliation) {
    formReconciliation.addEventListener('submit', (e) => {
      e.preventDefault();
      const lotId = document.getElementById('recon-lot-id').value;
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
      if (!lot) return;

      const oldQty = lot.Current_Qty;
      const oldLotNo = lot.Lot_Number;
      const oldExpiry = lot.Expiry_Date;
      const oldLocation = lot.Storage_Location;

      const newQty = parseFloat(document.getElementById('recon-qty').value) || 0;
      const newLotNo = document.getElementById('recon-lot-number').value.trim();
      const newExpiry = document.getElementById('recon-expiry-date').value.trim();
      const newLocation = document.getElementById('recon-storage-location').value.trim();

      const diff = parseFloat((newQty - oldQty).toFixed(3));

      // Apply adjustments
      lot.Current_Qty = newQty;
      lot.Lot_Number = newLotNo;
      lot.Expiry_Date = newExpiry;
      lot.Storage_Location = newLocation;
      lot.updatedAt = Date.now();

      // Log WMS transaction
      wmsTransactions.unshift({
        Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        Lot_ID: lot.Lot_ID,
        Tx_Type: 'Stock_Adjustment',
        Quantity: diff,
        Material_Type: lot.Material_Type || 'raw',
        Reference_ID: `تسوية وتعديل رصيد مخزني يدوي`,
        Performed_By: currentUserRole,
        Timestamp: Date.now()
      });

      saveWMS(true);
      logUserActivity('تسوية مخزنية', `تم إجراء تسوية للوت ${oldLotNo} للمادة ${lot.Material_Name}: تعديل الكمية من ${oldQty} إلى ${newQty} ${lot.Unit}، واللوت من ${oldLotNo} إلى ${newLotNo}، والصلاحية من ${oldExpiry} إلى ${newExpiry}.`);
      
      closeReconciliationModal();
      renderWMSViews();

      if (window.showToast) {
        window.showToast('تمت تسوية وتحديث اللوت بنجاح ⚖️', 'success');
      }
    });
  }

  function renderTransactionsLog() {
    const tbody = document.getElementById('wms-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };

    const filteredTx = wmsTransactions.filter(tx => {
      if (!tx) return false;
      if (currentHistoryFilter === 'all') return true;

      // Find lot to check category
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(tx.Lot_ID));
      let type = tx.Material_Type;
      if (!type) {
        if (lot) {
          type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
        } else {
          // Fallback if deleted
          if (tx.Tx_Type === 'Sales_Dispatch' || tx.Tx_Type === 'FG_Receipt') {
            type = 'ready';
          } else {
            type = 'raw';
          }
        }
      }

      return type === currentHistoryFilter;
    });

    if (filteredTx.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 20px;">لا توجد حركات تطابق الفلتر المحدد حالياً.</td></tr>`;
      return;
    }

    filteredTx.forEach(tx => {
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(tx.Lot_ID));
      const materialName = lot ? lot.Material_Name : 'مادة محذوفة';
      const lotNumber = lot ? lot.Lot_Number : '-';
      const unit = lot ? lot.Unit : '';

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

      const typeMap = {
        Initial_Balance: '<span style="color: var(--cyan); font-weight: bold;">رصيد افتتاحي 📥</span>',
        Inbound_Purchase: '<span style="color: var(--amber); font-weight: bold;">وارد جديد للمستودع ➕</span>',
        Dispense_Production: '<span style="color: var(--primary); font-weight: bold;">صرف لأوامر الإنتاج ⚙️</span>',
        FG_Receipt: '<span style="color: var(--emerald); font-weight: bold;">وارد منتج تام 📦</span>',
        Sales_Dispatch: '<span style="color: var(--rose); font-weight: bold;">شحن مبيعات وعملاء 🚚</span>',
        QC_Status_Change: '<span style="color: #c084fc; font-weight: bold;">قرار جودة جودي 🧪</span>',
        Clear_Inventory: '<span style="color: var(--rose); font-weight: bold;">تصفير مستودع 🗑️</span>'
      };

      const dateStr = new Date(tx.Timestamp).toLocaleString('en-US');

      tr.innerHTML = `
        <td style="padding: 10px; font-family: monospace; font-size: 0.75rem; color: var(--text-dim);">${tx.Tx_ID}</td>
        <td style="padding: 10px;">${typeMap[tx.Tx_Type] || tx.Tx_Type}</td>
        <td style="padding: 10px; font-weight: bold; color: #fff;">${materialName}</td>
        <td style="padding: 10px;"><strong style="color: var(--amber); font-family: monospace;">${lotNumber}</strong></td>
        <td style="padding: 10px; font-weight: bold; color: ${tx.Quantity < 0 ? 'var(--rose)' : (tx.Quantity === 0 ? 'var(--text-dim)' : 'var(--emerald)')};">${tx.Quantity > 0 ? '+' : ''}${tx.Quantity}</td>
        <td style="padding: 10px; color: var(--text-dim);">${unit}</td>
        <td style="padding: 10px; font-size: 0.8rem;">${tx.Reference_ID || '-'}</td>
        <td style="padding: 10px; color: var(--text-dim);">${tx.Performed_By}</td>
        <td style="padding: 10px; font-size: 0.8rem; color: var(--text-dim);">${dateStr}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function handleExcelImportChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let rows = [];
        let headerRowIndex = -1;
        let colIndices = { code: -1, name: -1, unit: -1, qty: -1, lot: -1, exp: -1 };
        let activeSheet = null;

        // Loop through all sheets to find the correct one
        for (const sName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sName];
          const tempRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (!Array.isArray(tempRows) || tempRows.length === 0) continue;

          for (let r = 0; r < tempRows.length; r++) {
            const row = tempRows[r];
            if (!Array.isArray(row)) continue;

            let tempIndices = { code: -1, name: -1, unit: -1, qty: -1, lot: -1, exp: -1 };

            for (let c = 0; c < row.length; c++) {
              if (row[c] === undefined || row[c] === null) continue;
              const val = String(row[c]).toLowerCase().trim().replace(/_/g, ' ');
              if (!val) continue;

              function isMatch(val, list) {
                return list.some(k => val.includes(k.toLowerCase().trim().replace(/_/g, ' ')) || k.toLowerCase().trim().replace(/_/g, ' ').includes(val));
              }

              if (tempIndices.code === -1 && isMatch(val, ['رمز المادة', 'كود المادة', 'المادة', 'material code', 'material_code', 'code'])) {
                tempIndices.code = c;
              } else if (tempIndices.name === -1 && isMatch(val, ['اسم المادة', 'اسم المادة الخام', 'اسم المكون', 'material name', 'material_name', 'name'])) {
                tempIndices.name = c;
              } else if (tempIndices.lot === -1 && isMatch(val, ['الفئة', 'اللوت', 'لوت', 'رقم اللوت', 'الوجبة', 'الدفعة', 'رقم التشغيلة', 'رقم الدفعة', 'lot', 'lot number', 'lot_number', 'batch', 'batch number', 'batch_no'])) {
                tempIndices.lot = c;
              } else if (tempIndices.qty === -1 && isMatch(val, ['الكمية', 'الكمية المتوفرة', 'الرصيد', 'الوزن', 'quantity', 'qty', 'balance', 'weight'])) {
                tempIndices.qty = c;
              } else if (tempIndices.unit === -1 && isMatch(val, ['الوحدة', 'الواحدة', 'unit'])) {
                tempIndices.unit = c;
              } else if (tempIndices.exp === -1 && isMatch(val, ['تاريخ انتهاء الصلاحية', 'تاريخ الصلاحية', 'تاريخ الانتهاء', 'الصلاحية', 'الانتهاء', 'expiry date', 'expiry_date', 'expiry', 'exp date', 'exp_date'])) {
                tempIndices.exp = c;
              }
            }

            // Match if we have at least code and name, and either lot or quantity
            if (tempIndices.code !== -1 && tempIndices.name !== -1) {
              headerRowIndex = r;
              colIndices = tempIndices;
              rows = tempRows;
              activeSheet = sName;
              break;
            }
          }
          if (headerRowIndex !== -1) break;
        }

        if (headerRowIndex === -1 || rows.length === 0) {
          alert('تعذر التعرف التلقائي على أعمدة الجدول في ملف الأكسل! يرجى التأكد من أن الملف يحتوي على أعمدة: رمز المادة، اسم المادة، رقم اللوت، والكمية.');
          e.target.value = '';
          return;
        }

        function formatExcelDate(val) {
          if (val === undefined || val === null) return '';
          const num = Number(val);
          if (!isNaN(num) && num > 30000 && num < 80000) {
            const date = new Date((num - 25569) * 86400 * 1000);
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
          }
          return String(val).trim();
        }

        wmsExcelImportTemp = [];
        for (let r = headerRowIndex + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!Array.isArray(row) || row.length === 0) continue;

          const code = colIndices.code !== -1 && row[colIndices.code] !== undefined && row[colIndices.code] !== null ? String(row[colIndices.code]).trim() : '';
          const name = colIndices.name !== -1 && row[colIndices.name] !== undefined && row[colIndices.name] !== null ? String(row[colIndices.name]).trim() : '';
          const unit = colIndices.unit !== -1 && row[colIndices.unit] !== undefined && row[colIndices.unit] !== null ? String(row[colIndices.unit]).trim() : 'kg';
          const qtyVal = colIndices.qty !== -1 ? row[colIndices.qty] : 0;
          const qty = parseFloat(qtyVal) || 0;
          const lotNum = colIndices.lot !== -1 && row[colIndices.lot] !== undefined && row[colIndices.lot] !== null ? String(row[colIndices.lot]).trim() : '';
          
          const rawExp = colIndices.exp !== -1 && row[colIndices.exp] !== undefined && row[colIndices.exp] !== null ? row[colIndices.exp] : '';
          const expDate = formatExcelDate(rawExp);

          if (code && name) {
            wmsExcelImportTemp.push({
              Material_Code: code,
              Material_Name: name,
              Unit: unit || 'kg',
              Quantity: qty,
              Lot_Number: lotNum || 'lot-auto',
              Expiry_Date: expDate
            });
          }
        }

        if (wmsExcelImportTemp.length === 0) {
          alert('لم يتم العثور على أي بيانات صالحة تحت الأعمدة المطابقة في ملف الأكسل!');
          const preview = document.getElementById('wms-excel-preview-container');
          if (preview) preview.classList.add('hidden');
          e.target.value = '';
          return;
        }

        const previewTbody = document.getElementById('wms-excel-preview-tbody');
        if (previewTbody) {
          previewTbody.innerHTML = '';
          wmsExcelImportTemp.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${row.Material_Code}</td>
              <td>${row.Material_Name}</td>
              <td><strong>${row.Lot_Number}</strong></td>
              <td style="color: var(--emerald); font-weight: bold;">${row.Quantity}</td>
              <td>${row.Unit}</td>
              <td style="color: var(--rose);">${row.Expiry_Date}</td>
              <td><span class="wms-badge released">Released ✅</span></td>
            `;
            previewTbody.appendChild(tr);
          });
        }

        document.getElementById('wms-excel-preview-container').classList.remove('hidden');

      } catch (err) {
        alert('حدث خطأ أثناء تحليل ملف الأكسل: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function confirmExcelImport() {
    if (wmsExcelImportTemp.length === 0) return;

    const targetType = window.excelImportTargetType || 'raw';
    
    // Read the import mode selected by the user
    const modeEl = document.querySelector('input[name="wms-excel-import-mode"]:checked');
    const importMode = modeEl ? modeEl.value : 'append';

    if (importMode === 'replace') {
      stockLots = stockLots.filter(l => {
        if (!l) return false;
        if (l.Storage_Location !== 'مستورد افتتاحي') return true;
        
        const isRawMaterial = lot => {
          if (!lot || !lot.Unit) return false;
          const u = lot.Unit.toLowerCase();
          return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
        };
        const type = l.Material_Type || (isRawMaterial(l) ? 'raw' : 'ready');
        return type !== targetType;
      });
    }

    wmsExcelImportTemp.forEach(row => {
      const lotId = 'lot-init-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      
      // Enforce units based on target type if missing or incorrect
      let finalUnit = row.Unit || 'kg';
      const isRawMaterial = lot => {
        if (!lot || !lot.Unit) return false;
        const u = lot.Unit.toLowerCase();
        return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
      };
      
      if (targetType === 'raw') {
        const isRaw = finalUnit === 'kg' || finalUnit === 'g' || finalUnit === 'L' || finalUnit === 'كغ' || finalUnit === 'غ' || finalUnit === 'جرام' || finalUnit === 'لتر';
        if (!isRaw) finalUnit = 'kg';
      } else if (targetType === 'packaging') {
        if (!row.Unit) finalUnit = 'units';
      } else {
        const isRaw = finalUnit === 'kg' || finalUnit === 'g' || finalUnit === 'L' || finalUnit === 'كغ' || finalUnit === 'غ' || finalUnit === 'جرام' || finalUnit === 'لتر';
        if (isRaw) finalUnit = 'blisters'; // default for ready products
      }

      const newLot = {
        Lot_ID: lotId,
        Material_Code: row.Material_Code,
        Material_Name: row.Material_Name,
        Lot_Number: row.Lot_Number,
        Current_Qty: row.Quantity,
        Unit: finalUnit,
        Status: 'Released',
        Expiry_Date: row.Expiry_Date,
        Storage_Location: 'مستورد افتتاحي',
        Material_Type: targetType, // Explicit type!
        updatedAt: Date.now()
      };
      stockLots.push(newLot);

      wmsTransactions.unshift({
        Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        Lot_ID: lotId,
        Tx_Type: 'Initial_Balance',
        Quantity: row.Quantity,
        Material_Type: targetType, // Explicit type!
        Reference_ID: `استيراد رصيد افتتاحي من أكسل (${targetType === 'raw' ? 'مواد أولية' : targetType === 'packaging' ? 'مواد تغليف' : 'رصيد جاهز'})`,
        Performed_By: currentUserRole,
        Timestamp: Date.now()
      });
    });

    saveWMS(true);
    logUserActivity('استيراد أكسل', `تم استيراد رصيد لوتات أكسل للنوع [${targetType}] بعدد ${wmsExcelImportTemp.length} لوت، بوضعية [${importMode}].`);
    
    wmsExcelImportTemp = [];
    document.getElementById('wms-excel-preview-container').classList.add('hidden');
    document.getElementById('wms-excel-file').value = '';
    
    // Hide Modal
    const modalExcelImport = document.getElementById('modal-wms-excel-import');
    if (modalExcelImport) modalExcelImport.classList.add('hidden');

    currentWMSTab = targetType === 'raw' ? 'stock' : (targetType === 'packaging' ? 'packaging' : 'ready');
    renderWMSViews();

    if (window.showToast) {
      window.showToast(`تم استيراد الأرصدة الافتتاحية لـ ${targetType === 'raw' ? 'المواد الخام' : targetType === 'packaging' ? 'مواد التغليف' : 'الرصيد الجاهز'} بنجاح 📥`, 'success');
    }
  }

  function exportStockToExcel(type) {
    if (typeof XLSX === 'undefined') {
      alert('مكتبة تصدير الأكسل غير محملة في المتصفح حالياً!');
      return;
    }

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };
    
    const filtered = stockLots.filter(lot => {
      if (!lot) return false;
      const t = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
      return t === type;
    });

    if (filtered.length === 0) {
      alert('لا توجد بيانات لتصديرها في هذا المخزن حالياً!');
      return;
    }

    const rows = filtered.map(lot => ({
      'رمز المادة/المنتج': lot.Material_Code || '',
      'اسم المادة/المنتج': lot.Material_Name || '',
      'رقم اللوت/التشغيلة': lot.Lot_Number || '',
      'الكمية المتوفرة': lot.Current_Qty || 0,
      'الوحدة': lot.Unit || '',
      'تاريخ انتهاء الصلاحية': lot.Expiry_Date || '',
      'حالة المادة': lot.Status === 'Released' ? 'مقبول ومفرج عنه' : (lot.Status === 'Quarantine' ? 'محجور تحت الفحص' : 'مرفوض معزول')
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    const sheetName = type === 'raw' ? 'رصيد المواد الأولية' : (type === 'packaging' ? 'رصيد مواد التغليف' : 'الرصيد الجاهز');
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    
    const filename = type === 'raw' ? 'raw_materials_stock.xlsx' : (type === 'packaging' ? 'packaging_materials_stock.xlsx' : 'ready_products_stock.xlsx');
    XLSX.writeFile(workbook, filename);
    
    if (window.showToast) {
      window.showToast('تم تصدير ملف الأكسل بنجاح 📤', 'success');
    }
  }

  function handleInboundSubmit(e) {
    e.preventDefault();
    const type = document.getElementById('wms-in-type').value;
    const code = document.getElementById('wms-in-code').value.trim();
    const name = document.getElementById('wms-in-name').value.trim();
    const lotNum = document.getElementById('wms-in-lot').value.trim();
    const qty = parseFloat(document.getElementById('wms-in-qty').value) || 0;
    const unit = document.getElementById('wms-in-unit').value;
    const expiry = document.getElementById('wms-in-expiry').value;
    const location = document.getElementById('wms-in-location').value.trim();
    const supplier = document.getElementById('wms-in-supplier').value.trim();
    const effective = document.getElementById('wms-in-effective').value;
    const entry = document.getElementById('wms-in-entry').value;

    const lotId = 'lot-in-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const newLot = {
      Lot_ID: lotId,
      Material_Code: code,
      Material_Name: name,
      Lot_Number: lotNum,
      Current_Qty: qty,
      Unit: unit,
      Status: 'Quarantine',
      Expiry_Date: expiry,
      Storage_Location: location,
      Supplier: supplier,
      Production_Date: effective,
      Entry_Date: entry || '-',
      Material_Type: type, // Explicit type!
      updatedAt: Date.now()
    };

    stockLots.push(newLot);

    wmsTransactions.unshift({
      Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      Lot_ID: lotId,
      Tx_Type: 'Inbound_Purchase',
      Quantity: qty,
      Material_Type: type, // Explicit type!
      Reference_ID: type === 'packaging' ? 'استلام مادة تعبئة وتغليف جديدة' : (type === 'ready' ? 'استلام منتج جاهز جديد للمستودع' : 'استلام مادة أولية جديدة للمستودع'),
      Performed_By: currentUserRole,
      Timestamp: Date.now()
    });

    saveWMS(true);
    const typeLabel = type === 'packaging' ? 'مادة تعبئة وتغليف' : (type === 'ready' ? 'منتج جاهز' : 'مادة أولية');
    logUserActivity('استلام وارد جديد', `تم استلام لوت وارد جديد لـ ${typeLabel} (${name}) (لوت: ${lotNum}) بكمية ${qty} ${unit} وحفظه في الحجر الصحي.`);
    document.getElementById('wms-form-inbound').reset();
    currentWMSTab = type === 'raw' ? 'stock' : (type === 'packaging' ? 'packaging' : 'ready');
    renderWMSViews();

    if (window.showToast) {
      window.showToast('تم استلام الوارد بنجاح وحفظه في الحجر الصحي (Quarantine) 🔒', 'success');
    }
  }

  function populateSalesProductsDropdown() {
    const searchInput = document.getElementById('wms-sales-product-search');
    const hiddenProduct = document.getElementById('wms-sales-product');
    const salesQty = document.getElementById('wms-sales-qty');
    if (searchInput) searchInput.value = '';
    if (hiddenProduct) hiddenProduct.value = '';
    if (salesQty) salesQty.value = '';
    
    window.currentSalesInvoiceItems = [];
    renderSalesInvoiceTable();
    updateFEFORecommendation();
  }

  function renderSalesInvoiceTable() {
    const tbody = document.getElementById('wms-sales-invoice-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!window.currentSalesInvoiceItems || window.currentSalesInvoiceItems.length === 0) {
      tbody.innerHTML = `
        <tr id="wms-sales-invoice-empty-row">
          <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 20px;">لم يتم إضافة أي بنود للفاتورة بعد. الرجاء إضافة بنود أعلاه.</td>
        </tr>
      `;
      return;
    }

    window.currentSalesInvoiceItems.forEach((item, index) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      tr.innerHTML = `
        <td style="padding: 10px;">${item.name}</td>
        <td style="padding: 10px;"><strong style="color: var(--amber);">${item.lotNumber}</strong></td>
        <td style="padding: 10px; font-weight: bold; color: var(--cyan);">${item.qty}</td>
        <td style="padding: 10px;">${item.unit}</td>
        <td style="padding: 10px; color: var(--rose);">${item.expiry}</td>
        <td style="padding: 10px; text-align: center;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="removeSalesInvoiceItem(${index})" style="padding: 2px 6px; border-color: var(--rose); color: var(--rose); font-size: 0.75rem;">حذف</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  window.removeSalesInvoiceItem = function(index) {
    if (window.currentSalesInvoiceItems) {
      window.currentSalesInvoiceItems.splice(index, 1);
      renderSalesInvoiceTable();
    }
  };

  function setupSalesAutocomplete() {
    const inputSearch = document.getElementById('wms-sales-product-search');
    const hiddenProduct = document.getElementById('wms-sales-product');
    const dropdown = document.getElementById('wms-sales-product-dropdown');

    if (!inputSearch || !hiddenProduct || !dropdown) return;

    function getReleasedProducts() {
      const addedLotIds = (window.currentSalesInvoiceItems || []).map(item => String(item.lotId));
      
      const isRawMaterial = lot => {
        if (!lot || !lot.Unit) return false;
        const u = lot.Unit.toLowerCase();
        return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
      };

      return stockLots
        .filter(lot => {
          if (!lot) return false;
          if (lot.Status !== 'Released') return false;
          if (lot.Current_Qty <= 0) return false;
          if (addedLotIds.includes(String(lot.Lot_ID))) return false;
          
          const type = lot.Material_Type || (isRawMaterial(lot) ? 'raw' : 'ready');
          return type === 'ready';
        })
        .map(lot => ({
          lotId: lot.Lot_ID,
          name: lot.Material_Name,
          lotNumber: lot.Lot_Number,
          qty: lot.Current_Qty,
          unit: lot.Unit
        }));
    }

    function populateDropdown(query = '') {
      dropdown.innerHTML = '';
      const lots = getReleasedProducts();
      const filtered = lots.filter(l => 
        l.name.toLowerCase().includes(query.toLowerCase()) || 
        l.lotNumber.toLowerCase().includes(query.toLowerCase())
      );

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px; color: var(--text-dim); text-align: center; font-size: 0.85rem;">لا توجد لوتات مطابقة</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      filtered.forEach(l => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.fontSize = '0.88rem';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        item.style.transition = 'background 0.2s';
        
        item.innerHTML = `
          <div style="font-weight: bold; color: #fff;">${l.name}</div>
          <div style="font-size: 0.78rem; color: var(--text-dim); margin-top: 2px; display: flex; justify-content: space-between;">
            <span>الباتش: <strong style="color: var(--amber);">${l.lotNumber}</strong></span>
            <span>الرصيد: <strong style="color: var(--emerald);">${l.qty} ${l.unit}</strong></span>
          </div>
        `;

        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(6, 182, 212, 0.15)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });

        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          inputSearch.value = `${l.name} [الباتش: ${l.lotNumber}]`;
          hiddenProduct.value = l.lotId;
          dropdown.classList.add('hidden');
          updateFEFORecommendation();
          
          const salesQty = document.getElementById('wms-sales-qty');
          if (salesQty) {
            salesQty.focus();
            salesQty.select();
          }
        });

        dropdown.appendChild(item);
      });

      dropdown.classList.remove('hidden');
    }

    inputSearch.addEventListener('focus', () => {
      populateDropdown(inputSearch.value);
    });

    inputSearch.addEventListener('input', (e) => {
      hiddenProduct.value = '';
      populateDropdown(e.target.value);
      updateFEFORecommendation();
    });

    inputSearch.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.classList.add('hidden');
        const lots = getReleasedProducts();
        const exists = lots.some(l => `${l.name} [الباتش: ${l.lotNumber}]` === inputSearch.value);
        if (!exists) {
          inputSearch.value = '';
          hiddenProduct.value = '';
          updateFEFORecommendation();
        }
      }, 200);
    });
  }

  function updateFEFORecommendation() {
    const select = document.getElementById('wms-sales-product');
    const inputQty = document.getElementById('wms-sales-qty');
    const container = document.getElementById('wms-fefo-recommendation');
    const details = document.getElementById('wms-fefo-details');

    if (!select || !inputQty || !container || !details) return;

    const lotId = select.value;
    const requiredQty = parseFloat(inputQty.value) || 0;

    if (!lotId) {
      container.classList.add('hidden');
      return;
    }

    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) {
      container.classList.add('hidden');
      return;
    }

    let recommendationHtml = '<ul style="margin: 0; padding-right: 20px;">';
    recommendationHtml += `
      <li style="margin-bottom: 4px;">
        صرف منتج: <strong>${lot.Material_Name}</strong>
      </li>
      <li style="margin-bottom: 4px;">
        من الباتش: <strong style="color: var(--amber);">${lot.Lot_Number}</strong> (تاريخ الانتهاء: <span style="color: var(--rose); font-weight: bold;">${lot.Expiry_Date}</span>، المتوفر: ${lot.Current_Qty} ${lot.Unit})
      </li>
    `;
    if (requiredQty > 0) {
      recommendationHtml += `
        <li style="margin-bottom: 4px;">
          الكمية المطلوبة للشحن: <strong style="color: var(--cyan);">${requiredQty.toFixed(3)} ${lot.Unit}</strong>
        </li>
      `;
    }
    recommendationHtml += '</ul>';

    if (requiredQty <= 0) {
      recommendationHtml += `
        <div style="color: var(--text-dim); margin-top: 8px;">
          الرجاء إدخال الكمية المطلوبة للشحن...
        </div>
      `;
    } else if (requiredQty > lot.Current_Qty) {
      recommendationHtml += `
        <div style="color: var(--rose); font-weight: bold; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
          <i data-lucide="alert-circle" style="width:16px;height:16px;"></i>
          عذراً، الرصيد المتاح في هذا الباتش (${lot.Current_Qty} ${lot.Unit}) غير كافٍ لتلبية الطلب!
        </div>
      `;
    } else {
      recommendationHtml += `
        <div style="color: var(--emerald); font-weight: bold; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
          <i data-lucide="check-circle" style="width:16px;height:16px;"></i>
          الرصيد متوفر وسيصبح المتبقي في هذا الباتش: ${(lot.Current_Qty - requiredQty).toFixed(3)} ${lot.Unit}
        </div>
      `;
    }

    details.innerHTML = recommendationHtml;
    container.classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
  }

  function handleSalesSubmit(e) {
    e.preventDefault();
    const ref = document.getElementById('wms-sales-ref').value.trim();

    if (!window.currentSalesInvoiceItems || window.currentSalesInvoiceItems.length === 0) {
      alert('الرجاء إضافة منتج واحد على الأقل للشحنة قبل التأكيد!');
      return;
    }

    if (!ref) {
      alert('الرجاء تحديد الجهة المستلمة أو رقم الفاتورة/العميل!');
      return;
    }

    // Validate quantities for all items
    let errorOccurred = false;
    for (const item of window.currentSalesInvoiceItems) {
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(item.lotId));
      if (!lot) {
        alert(`الباتش المحدد للمنتج [${item.name}] غير موجود!`);
        errorOccurred = true;
        break;
      }
      if (item.qty > lot.Current_Qty) {
        alert(`الرصيد في الباتش [${lot.Lot_Number}] للمنتج [${item.name}] غير كافٍ! المتوفر: ${lot.Current_Qty} ${lot.Unit}، المطلوب: ${item.qty} ${lot.Unit}`);
        errorOccurred = true;
        break;
      }
    }

    if (errorOccurred) return;

    // Deduct stock and save transactions
    let shippedLots = [];
    window.currentSalesInvoiceItems.forEach(item => {
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(item.lotId));
      if (lot) {
        lot.Current_Qty = parseFloat((lot.Current_Qty - item.qty).toFixed(3));
        lot.updatedAt = Date.now();
        shippedLots.push(`${lot.Material_Name} (الباتش: ${lot.Lot_Number})`);

        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: lot.Lot_ID,
          Tx_Type: 'Sales_Dispatch',
          Quantity: -item.qty,
          Reference_ID: `شحن مبيعات للعملاء (${ref}) - باتش رقم: ${lot.Lot_Number}`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      }
    });

    saveWMS(true);
    logUserActivity('شحن مبيعات', `تم صرف وشحن طلبية للعميل ${ref} تشمل المنتجات: ${shippedLots.join('، ')}.`);
    window.currentSalesInvoiceItems = [];
    document.getElementById('wms-form-sales').reset();
    renderSalesInvoiceTable();
    
    // Clear line entry inputs
    const searchInput = document.getElementById('wms-sales-product-search');
    const hiddenProduct = document.getElementById('wms-sales-product');
    const salesQty = document.getElementById('wms-sales-qty');
    if (searchInput) searchInput.value = '';
    if (hiddenProduct) hiddenProduct.value = '';
    if (salesQty) salesQty.value = '';

    document.getElementById('wms-fefo-recommendation').classList.add('hidden');
    currentWMSTab = 'ready';
    renderWMSViews();

    if (window.showToast) {
      window.showToast(`تم شحن وصرف الشحنة [${ref}] بنجاح للمنتجات التالية: ${shippedLots.join('، ')} 🚚`, 'success');
    }
  }

  function addWeighingFormulationRow(selectedLotId = '', qty = 0, selectedUnit = 'kg', isDisabled = false) {
    if (!elWeighingFormulationTbody) return;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
    
    // Searchable Select Container
    const container = document.createElement('div');
    container.className = 'wms-searchable-select-container';
    container.style.position = 'relative';
    container.style.width = '100%';

    const inputSearch = document.createElement('input');
    inputSearch.type = 'text';
    inputSearch.className = 'wms-lot-search-input';
    inputSearch.placeholder = 'ابحث باسم المادة، كودها، أو رقم اللوت...';
    inputSearch.style.width = '100%';
    inputSearch.style.background = isDisabled ? 'rgba(255,255,255,0.05)' : '#1e293b';
    inputSearch.style.color = '#fff';
    inputSearch.style.border = '1px solid rgba(255,255,255,0.15)';
    inputSearch.style.padding = '6px';
    inputSearch.style.borderRadius = '4px';
    inputSearch.style.boxSizing = 'border-box';
    inputSearch.autocomplete = 'off';
    if (isDisabled) {
      inputSearch.disabled = true;
      inputSearch.style.cursor = 'not-allowed';
    }

    const hiddenLotId = document.createElement('input');
    hiddenLotId.type = 'hidden';
    hiddenLotId.className = 'wms-lot-id-hidden';
    hiddenLotId.value = selectedLotId;

    const dropdown = document.createElement('div');
    dropdown.className = 'wms-autocomplete-dropdown hidden';
    dropdown.style.position = 'absolute';
    dropdown.style.top = '100%';
    dropdown.style.left = '0';
    dropdown.style.right = '0';
    dropdown.style.background = '#0b0f19';
    dropdown.style.border = '1px solid rgba(6, 182, 212, 0.3)';
    dropdown.style.borderRadius = '4px';
    dropdown.style.maxHeight = '180px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.zIndex = '9999';
    dropdown.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8)';
    dropdown.style.marginTop = '2px';

    const releasedLots = stockLots.filter(l => l && l.Status === 'Released' && l.Current_Qty > 0 && l.Material_Type === 'raw');

    // Set initial value if selectedLotId is provided
    if (selectedLotId) {
      const initialLot = stockLots.find(l => String(l.Lot_ID) === String(selectedLotId));
      if (initialLot) {
        inputSearch.value = `${initialLot.Material_Name} [Code: ${initialLot.Material_Code}] - L: ${initialLot.Lot_Number} (الرصيد: ${initialLot.Current_Qty} ${initialLot.Unit})`;
      } else {
        inputSearch.value = `لوت غير معروف (${selectedLotId})`;
      }
    }

    function populateDropdown(query = '') {
      if (isDisabled) return;
      dropdown.innerHTML = '';
      const filtered = releasedLots.filter(lot => {
        const text = `${lot.Material_Name} ${lot.Material_Code} ${lot.Lot_Number}`.toLowerCase();
        return text.includes(query.toLowerCase());
      });

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px; color: var(--text-dim); text-align: center; font-size: 0.8rem;">لا توجد لوتات مفرجة مطابقة للبحث</div>';
        return;
      }

      filtered.forEach(lot => {
        const item = document.createElement('div');
        item.style.padding = '8px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.fontSize = '0.78rem';
        item.style.transition = 'background 0.2s';
        item.innerHTML = `<strong>${lot.Material_Name}</strong> <span style="color: var(--text-dim);">[Code: ${lot.Material_Code}]</span><br><span style="color: var(--amber);">Lot: ${lot.Lot_Number}</span> <span style="color: var(--emerald); float: left;">الرصيد: ${lot.Current_Qty} ${lot.Unit}</span>`;
        
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(6, 182, 212, 0.15)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = '';
        });

        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent input blur from firing before selection
          inputSearch.value = `${lot.Material_Name} [Code: ${lot.Material_Code}] - L: ${lot.Lot_Number} (الرصيد: ${lot.Current_Qty} ${lot.Unit})`;
          hiddenLotId.value = lot.Lot_ID;
          dropdown.classList.add('hidden');
          updateWeighingFormulationTotal();
        });

        dropdown.appendChild(item);
      });
    }

    if (!isDisabled) {
      inputSearch.addEventListener('focus', () => {
        dropdown.classList.remove('hidden');
        populateDropdown(inputSearch.value);
      });

      inputSearch.addEventListener('blur', () => {
        setTimeout(() => {
          dropdown.classList.add('hidden');
        }, 200);
      });

      inputSearch.addEventListener('input', (e) => {
        hiddenLotId.value = '';
        dropdown.classList.remove('hidden');
        populateDropdown(e.target.value);
        updateWeighingFormulationTotal();
      });
    }

    container.appendChild(inputSearch);
    container.appendChild(hiddenLotId);
    container.appendChild(dropdown);

    const inputQty = document.createElement('input');
    inputQty.type = 'number';
    inputQty.step = '0.001';
    inputQty.required = true;
    inputQty.value = qty > 0 ? qty : '';
    inputQty.placeholder = 'الكمية';
    inputQty.className = 'wms-qty-input';
    inputQty.style.width = '100%';
    inputQty.style.background = isDisabled ? 'rgba(255,255,255,0.05)' : '#1e293b';
    inputQty.style.color = '#fff';
    inputQty.style.border = '1px solid rgba(255,255,255,0.15)';
    inputQty.style.padding = '6px';
    inputQty.style.borderRadius = '4px';
    inputQty.style.boxSizing = 'border-box';
    if (isDisabled) {
      inputQty.disabled = true;
      inputQty.style.cursor = 'not-allowed';
    } else {
      inputQty.addEventListener('input', updateWeighingFormulationTotal);
    }

    const selectUnit = document.createElement('select');
    selectUnit.className = 'wms-row-unit-select';
    selectUnit.style.width = '100%';
    selectUnit.style.background = isDisabled ? 'rgba(255,255,255,0.05)' : '#1e293b';
    selectUnit.style.color = '#fff';
    selectUnit.style.border = '1px solid rgba(255,255,255,0.15)';
    selectUnit.style.padding = '6px';
    selectUnit.style.borderRadius = '4px';
    selectUnit.style.boxSizing = 'border-box';
    if (isDisabled) {
      selectUnit.disabled = true;
      selectUnit.style.cursor = 'not-allowed';
    } else {
      selectUnit.addEventListener('change', updateWeighingFormulationTotal);
    }
    
    const optKg = document.createElement('option');
    optKg.value = 'kg';
    optKg.textContent = 'kg';
    const optG = document.createElement('option');
    optG.value = 'g';
    optG.textContent = 'g';
    
    selectUnit.appendChild(optKg);
    selectUnit.appendChild(optG);
    selectUnit.value = selectedUnit;

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-secondary btn-sm';
    btnDel.style.borderColor = 'var(--rose)';
    btnDel.style.color = 'var(--rose)';
    btnDel.style.padding = '4px';
    btnDel.innerHTML = '&times;';
    btnDel.addEventListener('click', () => {
      tr.remove();
      updateWeighingFormulationTotal();
    });
    if (isDisabled) {
      btnDel.style.display = 'none';
    }

    const tdSelect = document.createElement('td');
    tdSelect.appendChild(container);
    const tdInput = document.createElement('td');
    tdInput.appendChild(inputQty);
    const tdUnit = document.createElement('td');
    tdUnit.appendChild(selectUnit);
    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'center';
    tdAction.appendChild(btnDel);

    tr.appendChild(tdSelect);
    tr.appendChild(tdInput);
    tr.appendChild(tdUnit);
    tr.appendChild(tdAction);

    elWeighingFormulationTbody.appendChild(tr);
  }

  function addPackagingMaterialRow(selectedLotId = '', qty = 0) {
    const elPackagingMaterialsTbody = document.getElementById('packaging-materials-tbody');
    if (!elPackagingMaterialsTbody) return;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
    
    // Searchable Select Container
    const container = document.createElement('div');
    container.className = 'wms-searchable-select-container';
    container.style.position = 'relative';
    container.style.width = '100%';

    const inputSearch = document.createElement('input');
    inputSearch.type = 'text';
    inputSearch.className = 'wms-lot-search-input';
    inputSearch.placeholder = 'ابحث باسم المادة، كودها، أو رقم اللوت...';
    inputSearch.style.width = '100%';
    inputSearch.style.background = '#1e293b';
    inputSearch.style.color = '#fff';
    inputSearch.style.border = '1px solid rgba(255,255,255,0.15)';
    inputSearch.style.padding = '6px';
    inputSearch.style.borderRadius = '4px';
    inputSearch.style.boxSizing = 'border-box';
    inputSearch.autocomplete = 'off';

    const hiddenLotId = document.createElement('input');
    hiddenLotId.type = 'hidden';
    hiddenLotId.className = 'wms-lot-id-hidden';
    hiddenLotId.value = selectedLotId;

    const dropdown = document.createElement('div');
    dropdown.className = 'wms-autocomplete-dropdown hidden';
    dropdown.style.position = 'absolute';
    dropdown.style.top = '100%';
    dropdown.style.left = '0';
    dropdown.style.right = '0';
    dropdown.style.background = '#0b0f19';
    dropdown.style.border = '1px solid rgba(6, 182, 212, 0.3)';
    dropdown.style.borderRadius = '4px';
    dropdown.style.maxHeight = '180px';
    dropdown.style.overflowY = 'auto';
    dropdown.style.zIndex = '9999';
    dropdown.style.boxShadow = '0 10px 25px rgba(0,0,0,0.8)';
    dropdown.style.marginTop = '2px';

    const releasedLots = stockLots.filter(l => l && l.Status === 'Released' && l.Current_Qty > 0 && l.Material_Type === 'packaging');

    // Set initial value if selectedLotId is provided
    if (selectedLotId) {
      const initialLot = stockLots.find(l => String(l.Lot_ID) === String(selectedLotId));
      if (initialLot) {
        inputSearch.value = `${initialLot.Material_Name} [Code: ${initialLot.Material_Code}] - L: ${initialLot.Lot_Number} (الرصيد: ${initialLot.Current_Qty} ${initialLot.Unit})`;
      } else {
        inputSearch.value = `لوت غير معروف (${selectedLotId})`;
      }
    }

    function populateDropdown(query = '') {
      dropdown.innerHTML = '';
      const filtered = releasedLots.filter(lot => {
        const text = `${lot.Material_Name} ${lot.Material_Code} ${lot.Lot_Number}`.toLowerCase();
        return text.includes(query.toLowerCase());
      });

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px; color: var(--text-dim); text-align: center; font-size: 0.8rem;">لا توجد لوتات تغليف مفرجة مطابقة</div>';
        return;
      }

      filtered.forEach(lot => {
        const item = document.createElement('div');
        item.style.padding = '8px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
        item.style.fontSize = '0.78rem';
        item.style.transition = 'background 0.2s';
        item.innerHTML = `<strong>${lot.Material_Name}</strong> <span style="color: var(--text-dim);">[Code: ${lot.Material_Code}]</span><br><span style="color: var(--amber);">Lot: ${lot.Lot_Number}</span> <span style="color: var(--emerald); float: left;">الرصيد: ${lot.Current_Qty} ${lot.Unit}</span>`;
        
        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(6, 182, 212, 0.15)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = '';
        });

        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // Prevent input blur from firing before selection
          inputSearch.value = `${lot.Material_Name} [Code: ${lot.Material_Code}] - L: ${lot.Lot_Number} (الرصيد: ${lot.Current_Qty} ${lot.Unit})`;
          hiddenLotId.value = lot.Lot_ID;
          dropdown.classList.add('hidden');
        });

        dropdown.appendChild(item);
      });
    }

    inputSearch.addEventListener('focus', () => {
      dropdown.classList.remove('hidden');
      populateDropdown(inputSearch.value);
    });

    inputSearch.addEventListener('blur', () => {
      setTimeout(() => {
        dropdown.classList.add('hidden');
      }, 200);
    });

    inputSearch.addEventListener('input', (e) => {
      hiddenLotId.value = '';
      dropdown.classList.remove('hidden');
      populateDropdown(e.target.value);
    });

    container.appendChild(inputSearch);
    container.appendChild(hiddenLotId);
    container.appendChild(dropdown);

    const inputQty = document.createElement('input');
    inputQty.type = 'number';
    inputQty.step = '0.001';
    inputQty.required = true;
    inputQty.value = qty > 0 ? qty : '';
    inputQty.placeholder = 'الكمية';
    inputQty.className = 'wms-qty-input';
    inputQty.style.width = '100%';
    inputQty.style.background = '#1e293b';
    inputQty.style.color = '#fff';
    inputQty.style.border = '1px solid rgba(255,255,255,0.15)';
    inputQty.style.padding = '6px';
    inputQty.style.borderRadius = '4px';
    inputQty.style.boxSizing = 'border-box';

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn btn-secondary btn-sm';
    btnDel.style.borderColor = 'var(--rose)';
    btnDel.style.color = 'var(--rose)';
    btnDel.style.padding = '4px';
    btnDel.innerHTML = '&times;';
    btnDel.addEventListener('click', () => {
      tr.remove();
    });

    const tdSelect = document.createElement('td');
    tdSelect.appendChild(container);
    const tdInput = document.createElement('td');
    tdInput.appendChild(inputQty);
    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'center';
    tdAction.appendChild(btnDel);

    tr.appendChild(tdSelect);
    tr.appendChild(tdInput);
    tr.appendChild(tdAction);

    elPackagingMaterialsTbody.appendChild(tr);
  }

    function updateWeighingFormulationTotal() {
    if (!elWeighingFormulationTbody || !inputLogAcceptedKg) return;
    let total = 0;
    const rows = elWeighingFormulationTbody.querySelectorAll('tr');
    rows.forEach(row => {
      const input = row.querySelector('.wms-qty-input');
      const val = parseFloat(input?.value) || 0;
      const selectUnit = row.querySelector('.wms-row-unit-select');
      const unit = selectUnit ? selectUnit.value : 'kg';
      
      const qtyInKg = unit === 'g' ? (val / 1000) : val;
      total += qtyInKg;
    });
    inputLogAcceptedKg.value = total.toFixed(3);
  }

  // =========================================================================
  // USER ACTIVITY LOG ENGINE (AUDIT TRAIL)
  // =========================================================================
  let userActivityLogs = [];

  function saveActivityLogs() {
    localStorage.setItem('pharma_user_activity_logs', JSON.stringify(userActivityLogs));
  }

  function logUserActivity(actionType, details) {
    const roleLabels = {
      admin: 'مدير النظام 👑',
      qc: 'الرقابة النوعية QC 🧪',
      wms: 'أمين المستودع 📦',
      production: 'إدارة الإنتاج ⚙️',
      observer: 'المراقب 👁️'
    };
    const logEntry = {
      timestamp: new Date().toLocaleString('en-US'),
      user: roleLabels[currentUserRole] || currentUserRole,
      actionType: actionType,
      details: details
    };
    userActivityLogs.unshift(logEntry);
    if (userActivityLogs.length > 1000) {
      userActivityLogs = userActivityLogs.slice(0, 1000);
    }
    saveActivityLogs();
  }

  function renderActivityLogsView() {
    const tbody = document.getElementById('user-activity-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (userActivityLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim); padding: 20px;">سجل حركات النظام فارغ حالياً.</td></tr>`;
      return;
    }

    userActivityLogs.forEach(log => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
      tr.innerHTML = `
        <td style="padding: 10px; color: var(--text-dim); font-size: 0.82rem;">${log.timestamp}</td>
        <td style="padding: 10px; font-weight: bold;">${log.user}</td>
        <td style="padding: 10px;"><span class="wms-badge" style="background: rgba(255,255,255,0.05); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">${log.actionType}</span></td>
        <td style="padding: 10px; font-size: 0.85rem;">${log.details}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function exportActivityLogsToExcel() {
    try {
      if (userActivityLogs.length === 0) {
        alert('سجل الحركة فارغ، لا يوجد ما يمكن تصديره.');
        return;
      }
      const data = userActivityLogs.map(log => ({
        'الوقت والتاريخ': log.timestamp,
        'المستخدم / الصفة': log.user,
        'نوع الحركة': log.actionType,
        'تفاصيل التعديل / الإجراء': log.details
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Audit_Trail_Log');
      
      const fileName = `User_Activity_Audit_Trail_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
      logUserActivity('تصدير سجل الحركة', 'تم تصدير سجل حركات النظام إلى ملف Excel.');
    } catch (err) {
      alert('حدث خطأ أثناء تصدير ملف إكسل: ' + err.message);
    }
  }

  // =========================================================================
  // QUALITY CONTROL (QC) MANAGEMENT ENGINE
  // =========================================================================
  let currentQCTab = 'quarantine';

  function setupQCEventListeners() {
    const tabs = document.querySelectorAll('#qc-sub-tabs .filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentQCTab = e.currentTarget.getAttribute('data-qc-tab');
        renderQCViews();
      });
    });

    const btnExportActivity = document.getElementById('btn-export-activity-excel');
    if (btnExportActivity) btnExportActivity.addEventListener('click', exportActivityLogsToExcel);
  }

  function renderQCViews() {
    let pen = 0, fail = 0;
    stockLots.forEach(lot => {
      if (!lot) return;
      if (lot.Status === 'Quarantine') pen++;
      else if (lot.Status === 'Rejected') fail++;
    });

    const elPen = document.getElementById('qc-stat-pending');
    const elFail = document.getElementById('qc-stat-failed');
    if (elPen) elPen.textContent = `المعلقة: ${pen} لوت`;
    if (elFail) elFail.textContent = `المرفوضة: ${fail} لوت`;

    const subViews = document.querySelectorAll('.qc-sub-view');
    subViews.forEach(view => {
      if (view.id === `qc-view-${currentQCTab}`) {
        view.classList.remove('hidden');
      } else {
        view.classList.add('hidden');
      }
    });

    let tbodyId = '';
    let targetStatus = '';
    if (currentQCTab === 'quarantine') {
      tbodyId = 'qc-pending-tbody';
      targetStatus = 'Quarantine';
    } else if (currentQCTab === 'rejected') {
      tbodyId = 'qc-rejected-tbody';
      targetStatus = 'Rejected';
    }

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = stockLots.filter(lot => lot && lot.Status === targetStatus);
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">لا توجد عناصر في هذا التبويب حالياً.</td></tr>`;
      return;
    }

    const isRawMaterial = lot => {
      if (!lot || !lot.Unit) return false;
      const u = lot.Unit.toLowerCase();
      return u === 'kg' || u === 'g' || u === 'l' || u === 'كغ' || u === 'غ' || u === 'جرام' || u === 'لتر';
    };

    filtered.forEach(lot => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';

      const typeLabel = lot.Material_Type === 'packaging' ? 'مواد تعبئة 🏷️' : (isRawMaterial(lot) ? 'مواد أولية 🧪' : 'منتج جاهز 📦');
      
      let actionButtons = '';
      if (lot.Status === 'Quarantine') {
        actionButtons = `
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--emerald); color: var(--emerald); margin-left: 6px;" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Released')">إفراج وقبول ✅</button>
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--rose); color: var(--rose);" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Rejected')">رفض وعزل ❌</button>
        `;
      } else if (lot.Status === 'Released') {
        actionButtons = `
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--amber); color: var(--amber); margin-left: 6px;" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Quarantine')">إعادة حجر 🔒</button>
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--rose); color: var(--rose);" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Rejected')">رفض وعزل ❌</button>
        `;
      } else if (lot.Status === 'Rejected') {
        actionButtons = `
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--amber); color: var(--amber); margin-left: 6px;" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Quarantine')">إعادة حجر 🔒</button>
          <button class="btn btn-secondary btn-sm" style="padding: 4px 10px; font-size: 0.8rem; border-color: var(--emerald); color: var(--emerald);" onclick="changeLotStatusFromQC('${lot.Lot_ID}', 'Released')">إفراج وقبول ✅</button>
        `;
      }

      tr.innerHTML = `
        <td style="padding: 10px;">${lot.Material_Code || '-'}</td>
        <td style="padding: 10px; font-weight: bold;">${lot.Material_Name || '-'}</td>
        <td style="padding: 10px;"><span style="color: var(--amber); font-weight: bold;">${lot.Lot_Number || '-'}</span></td>
        <td style="padding: 10px;">${typeLabel}</td>
        <td style="padding: 10px;">${lot.Current_Qty} <small>${lot.Unit}</small></td>
        <td style="padding: 10px; color: var(--text-dim);">${lot.Expiry_Date || '-'}</td>
        <td style="padding: 10px; text-align: center;">${actionButtons}</td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
  }

  window.changeLotStatusFromQC = function(lotId, newStatus) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) return;

    if (newStatus === 'Released' && lot.Material_Type === 'ready') {
      document.getElementById('release-lot-id').value = lotId;
      document.getElementById('release-product-name').textContent = lot.Material_Name;
      document.getElementById('release-lot-number').textContent = lot.Lot_Number;
      document.getElementById('release-attachment-file').value = '';
      document.getElementById('modal-qc-final-release').classList.remove('hidden');
      return;
    }
    
    const oldStatus = lot.Status;
    lot.Status = newStatus;
    lot.updatedAt = Date.now();

    wmsTransactions.unshift({
      Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      Lot_ID: lotId,
      Tx_Type: newStatus === 'Released' ? 'Released_From_Quarantine' : (newStatus === 'Rejected' ? 'Rejected_From_Quarantine' : 'Re_Quarantined'),
      Quantity: lot.Current_Qty,
      Material_Type: lot.Material_Type || 'raw',
      Reference_ID: `تعديل القرار الجودي من الرقابة النوعية QC`,
      Performed_By: currentUserRole,
      Timestamp: Date.now()
    });

    saveWMS(true);
    
    logUserActivity('تعديل حالة لوت (QC)', `تم تغيير حالة اللوت ${lot.Lot_Number} للمادة ${lot.Material_Name} من [${oldStatus}] إلى [${newStatus}].`);

    renderQCViews();
    if (window.showToast) {
      window.showToast(`تم تحديث حالة اللوت بنجاح إلى [${newStatus}] 🔬`, 'success');
    }
  };

  // Bind close buttons for QC Final Release Modal
  const closeQCReleaseModal = () => {
    document.getElementById('modal-qc-final-release').classList.add('hidden');
  };
  const closeQCReleaseBtn = document.getElementById('close-qc-final-release-modal');
  if (closeQCReleaseBtn) closeQCReleaseBtn.addEventListener('click', closeQCReleaseModal);
  const cancelQCReleaseBtn = document.getElementById('btn-cancel-qc-final-release');
  if (cancelQCReleaseBtn) cancelQCReleaseBtn.addEventListener('click', closeQCReleaseModal);

  const formQCRelease = document.getElementById('form-qc-final-release');
  if (formQCRelease) {
    formQCRelease.addEventListener('submit', (e) => {
      e.preventDefault();
      const lotId = document.getElementById('release-lot-id').value;
      const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
      if (!lot) return;

      const fileInput = document.getElementById('release-attachment-file');
      const file = fileInput.files[0];

      const oldStatus = lot.Status;

      const finalizeRelease = (attachmentBase64 = null, attachmentName = null) => {
        lot.Status = 'Released';
        lot.updatedAt = Date.now();
        if (attachmentBase64) {
          lot.Release_Attachment = attachmentBase64;
          lot.Release_Attachment_Name = attachmentName;
        }

        // Log transaction
        wmsTransactions.unshift({
          Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          Lot_ID: lotId,
          Tx_Type: 'QC_Status_Change',
          Quantity: 0,
          Reference_ID: `تحرير وإفراج نهائي للمنتج مع مستند جودة`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });

        saveWMS(true);
        logUserActivity('إفراج نهائي لمنتج', `تم تحرير وإفراج نهائي للمنتج ${lot.Material_Name} (الباتش: ${lot.Lot_Number}) ${attachmentName ? 'مع إرفاق مستند: ' + attachmentName : ''}.`);
        
        closeQCReleaseModal();
        
        if (typeof renderQCViews === 'function') renderQCViews();
        if (typeof renderWMSViews === 'function') renderWMSViews();

        if (window.showToast) {
          window.showToast(`تم الإفراج النهائي وتحرير الباتش [${lot.Lot_Number}] بنجاح 🔓`, 'success');
        }
      };

      if (file) {
        if (file.size > 1024 * 1024) {
          alert('حجم الملف المرفق أكبر من 1MB! يرجى اختيار ملف أصغر حجماً لتفادي امتلاء الذاكرة.');
          return;
        }
        const reader = new FileReader();
        reader.onload = function(evt) {
          finalizeRelease(evt.target.result, file.name);
        };
        reader.readAsDataURL(file);
      } else {
        finalizeRelease();
      }
    });
  }

  window.downloadQCReleaseAttachment = function(lotId) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot || !lot.Release_Attachment) return;
    
    // Create temporary download anchor
    const link = document.createElement('a');
    link.href = lot.Release_Attachment;
    link.download = lot.Release_Attachment_Name || 'release_document';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  window.downloadBatchStageReleaseCertificate = function(batchId) {
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch || !batch.stages) return;
    const visualStage = batch.stages.find(s => s && s.id === 'visual_inspection');
    if (!visualStage || !visualStage.releaseCertificate || !visualStage.releaseCertificate.data) return;
    const link = document.createElement('a');
    link.href = visualStage.releaseCertificate.data;
    link.download = visualStage.releaseCertificate.name || 'release_certificate';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  window.removeBatchStageReleaseCertificate = function(batchId) {
    if (!confirm('هل أنت متأكد من حذف هذا المرفق؟')) return;
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch || !batch.stages) return;
    const visualStage = batch.stages.find(s => s && s.id === 'visual_inspection');
    if (visualStage) {
      delete visualStage.releaseCertificate;
      batch.version = (batch.version || 0) + 1;
      batch.updatedAt = Date.now();
      saveBatches(true);
      renderStageLogger(batch);
    }
  };

  // =========================================================================
  // MATERIAL TRACEABILITY ENGINE
  // =========================================================================
  function setupTraceEventListeners() {
    const traceSearch = document.getElementById('wms-trace-search');
    if (traceSearch) {
      traceSearch.addEventListener('input', renderTraceabilityView);
    }
  }

  function renderTraceabilityView() {
    const tbody = document.getElementById('wms-trace-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('wms-trace-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (!query) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">الرجاء كتابة اسم المادة، كود المادة، المورد، أو رقم لوت المادة للبحث...</td></tr>`;
      return;
    }

    const matches = [];

    batches.forEach(batch => {
      if (!batch || !Array.isArray(batch.stages)) return;

      batch.stages.forEach(stage => {
        if (!stage) return;

        // 1. Search formulation rows (Raw Materials)
        if (Array.isArray(stage.formulation)) {
          stage.formulation.forEach(row => {
            if (!row) return;
            const lotId = row.Lot_ID || row.lotId;
            const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
            
            const matName = lot ? (lot.Material_Name || '').toLowerCase() : '';
            const matCode = lot ? (lot.Material_Code || '').toLowerCase() : '';
            const matLot = lot ? (lot.Lot_Number || '').toLowerCase() : '';
            const supplier = lot ? (lot.Supplier || '').toLowerCase() : '';

            if (matName.includes(query) || matCode.includes(query) || matLot.includes(query) || supplier.includes(query)) {
              let displayQty = row.Quantity || row.qty || 0;
              let displayUnit = lot ? lot.Unit : 'kg';
              if (row.userQty !== undefined && row.userUnit !== undefined) {
                displayQty = row.userQty;
                displayUnit = row.userUnit;
              }
              matches.push({
                code: lot ? lot.Material_Code : '-',
                name: lot ? lot.Material_Name : '-',
                lotNum: lot ? lot.Lot_Number : '-',
                productName: batch.productName,
                batchNo: batch.batchNo,
                stageName: stage.name,
                qty: displayQty,
                unit: displayUnit,
                type: 'مواد خام 🧪'
              });
            }
          });
        }

        // 2. Search packaging materials rows (Packaging)
        if (Array.isArray(stage.packaging_materials)) {
          stage.packaging_materials.forEach(row => {
            if (!row) return;
            const lotId = row.Lot_ID || row.lotId;
            const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
            
            const matName = lot ? (lot.Material_Name || '').toLowerCase() : '';
            const matCode = lot ? (lot.Material_Code || '').toLowerCase() : '';
            const matLot = lot ? (lot.Lot_Number || '').toLowerCase() : '';
            const supplier = lot ? (lot.Supplier || '').toLowerCase() : '';

            if (matName.includes(query) || matCode.includes(query) || matLot.includes(query) || supplier.includes(query)) {
              let displayQty = row.Quantity || row.qty || 0;
              let displayUnit = lot ? lot.Unit : 'kg';
              if (row.userQty !== undefined && row.userUnit !== undefined) {
                displayQty = row.userQty;
                displayUnit = row.userUnit;
              }
              matches.push({
                code: lot ? lot.Material_Code : '-',
                name: lot ? lot.Material_Name : '-',
                lotNum: lot ? lot.Lot_Number : '-',
                productName: batch.productName,
                batchNo: batch.batchNo,
                stageName: stage.name,
                qty: displayQty,
                unit: displayUnit,
                type: 'مواد تغليف 📦'
              });
            }
          });
        }
      });
    });

    if (matches.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">لم يتم العثور على أي نتائج تطابق البحث في المواد المستهلكة بالإنتاج.</td></tr>`;
      return;
    }

    matches.forEach(item => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
      tr.innerHTML = `
        <td style="padding: 10px; color: var(--cyan);">${item.type}</td>
        <td style="padding: 10px;">${item.code}</td>
        <td style="padding: 10px; font-weight: bold;">${item.name}</td>
        <td style="padding: 10px;"><span style="color: var(--amber); font-weight: bold;">${item.lotNum}</span></td>
        <td style="padding: 10px; font-weight: bold; color: var(--cyan);">${item.productName}</td>
        <td style="padding: 10px;">${item.batchNo}</td>
        <td style="padding: 10px; font-size: 0.85rem;">${item.stageName}</td>
        <td style="padding: 10px;">${item.qty.toFixed(3)} <small>${item.unit}</small></td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
