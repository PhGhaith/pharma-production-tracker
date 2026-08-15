/**
 * Main Application Logic for Pharma Production Tracker & Quarantine Inventory
 * Version 11 - Equipped with Throttled Conflict-Free Sync Engine & API Cache-Busting
 */

(function () {
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
  const viewProductionContainer = document.getElementById('view-production-container');
  const viewWarehouseContainer = document.getElementById('view-warehouse-container');

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
    setupEventListeners();
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

          if (Array.isArray(cloudData)) {
            cloudBatches = cloudData;
          } else if (cloudData && typeof cloudData === 'object') {
            cloudBatches = cloudData.batches || [];
            cloudLots = cloudData.stock_lots || [];
            cloudTx = cloudData.transactions || [];
          }

          if (Array.isArray(cloudBatches)) {
            const mergedList = mergeBatches(batches, cloudBatches);
            sanitizeBatchesCoatingName(mergedList);

            const mergedLots = mergeStockLots(stockLots, cloudLots);
            const mergedTx = mergeTransactions(wmsTransactions, cloudTx);

            const currentLocalHash = JSON.stringify({ batches, stockLots, wmsTransactions });
            const mergedHash = JSON.stringify({ batches: mergedList, stock_lots: mergedLots, transactions: mergedTx });

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

              batches = mergedList;
              stockLots = mergedLots;
              wmsTransactions = mergedTx;

              localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(batches));
              localStorage.setItem(WMS_STOCK_LOTS_KEY, JSON.stringify(stockLots));
              localStorage.setItem(WMS_TRANSACTIONS_KEY, JSON.stringify(wmsTransactions));

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
    const payload = { batches: batches, stock_lots: stockLots, transactions: wmsTransactions };
    lastSyncHash = JSON.stringify({ batches: batches, stock_lots: stockLots, transactions: wmsTransactions });
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
      if (currentUserRole === 'qc') {
        btnNewBatch.classList.add('hidden');
      } else {
        btnNewBatch.classList.remove('hidden');
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
                ${currentUserRole !== 'qc' ? `
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
              ${currentUserRole !== 'qc' ? `
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
    window.openBatchDetail = openBatchDetail;
    if (btnExportBackup) btnExportBackup.addEventListener('click', exportBackupData);
    if (btnImportBackup) btnImportBackup.addEventListener('click', () => inputBackupFile.click());
    if (inputBackupFile) inputBackupFile.addEventListener('change', importBackupData);

    if (viewTabProduction) {
      viewTabProduction.addEventListener('click', () => {
        viewTabProduction.style.background = 'var(--primary)';
        viewTabProduction.style.borderColor = 'var(--primary)';
        viewTabProduction.style.color = '#fff';
        if (viewTabWarehouse) {
          viewTabWarehouse.style.background = 'transparent';
          viewTabWarehouse.style.borderColor = 'rgba(255,255,255,0.15)';
          viewTabWarehouse.style.color = 'var(--text-dim)';
        }
        if (viewProductionContainer) viewProductionContainer.classList.remove('hidden');
        if (viewWarehouseContainer) viewWarehouseContainer.classList.add('hidden');
        const prodStats = document.querySelector('.stats-grid');
        if (prodStats) prodStats.classList.remove('hidden');
      });
    }

    if (viewTabWarehouse) {
      viewTabWarehouse.addEventListener('click', () => {
        viewTabWarehouse.style.background = 'var(--primary)';
        viewTabWarehouse.style.borderColor = 'var(--primary)';
        viewTabWarehouse.style.color = '#fff';
        if (viewTabProduction) {
          viewTabProduction.style.background = 'transparent';
          viewTabProduction.style.borderColor = 'rgba(255,255,255,0.15)';
          viewTabProduction.style.color = 'var(--text-dim)';
        }
        if (viewWarehouseContainer) viewWarehouseContainer.classList.remove('hidden');
        if (viewProductionContainer) viewProductionContainer.classList.add('hidden');
        const prodStats = document.querySelector('.stats-grid');
        if (prodStats) prodStats.classList.add('hidden');
        renderWMSViews();
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

    if (btnDeleteBatch) {
      if (currentUserRole === 'qc') {
        btnDeleteBatch.classList.add('hidden');
      } else {
        btnDeleteBatch.classList.remove('hidden');
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
    if (currentUserRole === 'qc') {
      alert('عذراً، لا تملك الصلاحية لحذف التشغيلات/الأضابير التصنيعية.');
      return;
    }
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

      // Weighing Formulation Dynamic View toggle
      if (activeStageIndex === 0) {
        if (elWeighingFormulationContainer) elWeighingFormulationContainer.classList.remove('hidden');
        if (inputLogAcceptedKg) {
          inputLogAcceptedKg.readOnly = true;
          inputLogAcceptedKg.style.background = 'rgba(255,255,255,0.05)';
          inputLogAcceptedKg.style.cursor = 'not-allowed';
        }
        if (elWeighingFormulationTbody) {
          elWeighingFormulationTbody.innerHTML = '';
          if (stage.formulation && stage.formulation.length > 0) {
            stage.formulation.forEach(row => {
              addWeighingFormulationRow(row.Lot_ID, row.Quantity);
            });
          } else {
            addWeighingFormulationRow('', 0);
          }
        }
        updateWeighingFormulationTotal();
      } else {
        if (elWeighingFormulationContainer) elWeighingFormulationContainer.classList.add('hidden');
        if (inputLogAcceptedKg) {
          inputLogAcceptedKg.readOnly = false;
          inputLogAcceptedKg.style.background = '';
          inputLogAcceptedKg.style.cursor = '';
        }
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
        logStageTotalBlisters.textContent = `(${totalMath.equivalentLots.toFixed(2)} Lot | ${PharmaMath.formatNumber(totalMath.totalBlisters)} ${unitLabel})`;;
      }
    }

    if (logStageAcceptedKg) logStageAcceptedKg.textContent = `${stageAccKg} kg`;
    if (logStageAcceptedBlisters) logStageAcceptedBlisters.textContent = `(${PharmaMath.formatNumber(accMath.totalBlisters)} ${unitLabel} مقبول)`;

    if (logStageRejectedKg) logStageRejectedKg.textContent = `${stageRejKg} kg`;
    if (logStageRejectedBlisters) logStageRejectedBlisters.textContent = `(${PharmaMath.formatNumber(rejMath.totalBlisters)} ${unitLabel} مرفوض/إعادة تشغيل)`;

    // Role Authorization for Production Logger
    const isQC = currentUserRole === 'qc';
    if (isQC) {
      if (inputLogAcceptedKg) inputLogAcceptedKg.disabled = true;
      if (inputLogRejectedKg) inputLogRejectedKg.disabled = true;
      if (btnSubmitStageLog) {
        btnSubmitStageLog.disabled = true;
        btnSubmitStageLog.style.opacity = '0.5';
        btnSubmitStageLog.title = 'تتطلب صلاحية إدارة الإنتاج أو المشرف';
      }
      if (btnToggleEditMode) {
        btnToggleEditMode.disabled = true;
        btnToggleEditMode.style.opacity = '0.5';
        btnToggleEditMode.title = 'تتطلب صلاحية إدارة الإنتاج أو المشرف';
      }
      // disable carry over progress checkbox if present
      const chkCarry = document.getElementById('chk-add-carry-over-progress');
      if (chkCarry) chkCarry.disabled = true;
    } else {
      if (inputLogAcceptedKg) inputLogAcceptedKg.disabled = false;
      if (inputLogRejectedKg) inputLogRejectedKg.disabled = false;
      if (btnSubmitStageLog) {
        btnSubmitStageLog.disabled = false;
        btnSubmitStageLog.style.opacity = '1';
        btnSubmitStageLog.title = '';
      }
      if (btnToggleEditMode) {
        btnToggleEditMode.disabled = false;
        btnToggleEditMode.style.opacity = '1';
        btnToggleEditMode.title = '';
      }
    }
  }

  function handleUpdateStageSubmit(e) {
    e.preventDefault();
    const batch = batches.find(b => b && String(b.id) === String(activeBatchId));
    if (!batch || !Array.isArray(batch.stages)) return;

    const stage = batch.stages[activeStageIndex];
    if (!stage) return;
    const isBlisterStage = activeStageIndex === batch.stages.length - 1;
    const term = getTerminology(batch.pharmaForm);

    if (currentUserRole === 'qc') {
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
        if (isEditCorrectionMode && Array.isArray(stage.formulation)) {
          const oldRow = stage.formulation.find(or => String(or.Lot_ID || or.lotId) === String(lotId));
          if (oldRow) {
            oldQtyForLot = oldRow.Quantity || oldRow.qty || 0;
          }
        }

        if (qty > (lot.Current_Qty + oldQtyForLot)) {
          alert(`الكمية المطلوبة للمادة [${lot.Material_Name}] (${qty}) أكبر من الرصيد المتوفر باللوت [${lot.Lot_Number}] مضافاً إليه الكمية المصروفة سابقاً (${(lot.Current_Qty + oldQtyForLot).toFixed(3)} ${lot.Unit})!`);
          isValid = false;
          break;
        }

        formulationRows.push({ lotId, qty, lotName: lot.Material_Name, lotNumber: lot.Lot_Number, unit: lot.Unit });
      }

      if (!isValid) return;
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
              lot.Current_Qty = parseFloat((lot.Current_Qty + qty).toFixed(3));
              lot.updatedAt = Date.now();
            }
          });
        }
        // 2. Delete previous WMS transactions for this batch
        wmsTransactions = wmsTransactions.filter(tx => tx && !(tx.Tx_Type === 'Dispense_Production' && tx.Reference_ID === `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`));

        // 3. Save new formulation array
        stage.formulation = formulationRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty }));
        
        // 4. Deduct new quantities and log transactions
        formulationRows.forEach(row => {
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
            Reference_ID: `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
            Performed_By: currentUserRole,
            Timestamp: Date.now()
          });
        });
        saveWMS(false);
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

    // If Weighing stage, execute WMS stock deductions
    if (activeStageIndex === 0) {
      stage.formulation = formulationRows.map(r => ({ Lot_ID: r.lotId, Quantity: r.qty }));
      formulationRows.forEach(row => {
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
          Reference_ID: `صرف لإنتاج تشغيلة ${batch.productName} (#${batch.batchNo})`,
          Performed_By: currentUserRole,
          Timestamp: Date.now()
        });
      });
      saveWMS(false);
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
      const detailsStr = formulationRows.map(r => `${r.lotName} (لوت: ${r.lotNumber}) بوزن ${r.qty} ${r.unit}`).join('، ');
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
      qc: '5555'
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
      qc: 'الصلاحية: الجودة 🧪'
    };
    roleSwitcherText.textContent = roleNames[currentUserRole] || 'الصلاحية: مشرف 👑';
  }

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
  let wmsExcelImportTemp = [];

  function setupWMSEventListeners() {
    // WMS Tab switching
    const tabs = document.querySelectorAll('#wms-sub-tabs .filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        currentWMSTab = e.target.getAttribute('data-wms-tab');
        renderWMSViews();
      });
    });

    // Excel import
    const excelFile = document.getElementById('wms-excel-file');
    if (excelFile) excelFile.addEventListener('change', handleExcelImportChange);

    const btnCancelImport = document.getElementById('wms-btn-cancel-import');
    if (btnCancelImport) {
      btnCancelImport.addEventListener('click', () => {
        wmsExcelImportTemp = [];
        const preview = document.getElementById('wms-excel-preview-container');
        if (preview) preview.classList.add('hidden');
        if (excelFile) excelFile.value = '';
      });
    }

    const btnConfirmImport = document.getElementById('wms-btn-confirm-import');
    if (btnConfirmImport) btnConfirmImport.addEventListener('click', confirmExcelImport);

    // Inbound Purchase Form
    const formInbound = document.getElementById('wms-form-inbound');
    if (formInbound) formInbound.addEventListener('submit', handleInboundSubmit);

    // Sales/FEFO Form
    setupSalesAutocomplete();

    const salesQty = document.getElementById('wms-sales-qty');
    if (salesQty) salesQty.addEventListener('input', updateFEFORecommendation);

    const formSales = document.getElementById('wms-form-sales');
    if (formSales) formSales.addEventListener('submit', handleSalesSubmit);

    // Stock Search
    const stockSearch = document.getElementById('wms-stock-search');
    if (stockSearch) stockSearch.addEventListener('input', renderStockLots);

    // Clear All WMS Stock
    const btnClearAll = document.getElementById('wms-btn-clear-all');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        if (!confirm('⚠️ تحذير حرج: هل أنت متأكد من تفريغ كامل رصيد المستودع وحذف جميع المواد واللوتات وسجل الحركات نهائياً؟\nلا يمكن التراجع عن هذا الإجراء!')) {
          return;
        }
        
        const pin = prompt('الرجاء إدخال رمز تأكيد الحذف (الـ PIN code لمدير النظام):');
        if (pin !== '9999') {
          alert('رمز التأكيد غير صحيح! تم إلغاء العملية.');
          return;
        }
        
        stockLots = [];
        wmsTransactions = [];
        saveWMS(true);
        renderWMSViews();
        
        if (window.showToast) {
          window.showToast('تم تفريغ كافة أرصدة وحركات المستودع بالكامل 🗑️', 'success');
        }
      });
    }

    // Formulation dynamically adding rows
    if (btnAddFormulationRow) {
      btnAddFormulationRow.addEventListener('click', () => {
        addWeighingFormulationRow('', 0);
      });
    }

    // Download WMS template
    const btnDownloadTemplate = document.getElementById('wms-btn-download-template');
    if (btnDownloadTemplate) {
      btnDownloadTemplate.addEventListener('click', () => {
        const headers = ['رمز المادة', 'اسم المادة', 'الفئة (رقم التشغيلة)', 'الكمية', 'الوحدة', 'تاريخ انتهاء الصلاحية'];
        const sampleRows = [
          ['MC-021', 'Lactose Monohydrate', 'LOT-LAC-09', '1250', 'kg', '2029-08-30'],
          ['MC-033', 'Microcrystalline Cellulose (MCC)', 'LOT-MCC-24', '800', 'kg', '2029-05-15'],
          ['MC-104', 'Paracetamol Powder', 'LOT-PARA-88', '5000', 'kg', '2028-11-20']
        ];
        
        let csvContent = '\uFEFF'; // UTF-8 BOM for proper Arabic encoding in Excel
        csvContent += headers.join(',') + '\n';
        sampleRows.forEach(r => {
          csvContent += r.join(',') + '\n';
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'pharma_wms_opening_balance_template.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

    // Clear button visibility based on active tab and admin role
    const btnClearAll = document.getElementById('wms-btn-clear-all');
    if (btnClearAll) {
      btnClearAll.style.display = (currentWMSTab === 'stock' && currentUserRole === 'admin') ? 'inline-flex' : 'none';
    }

    // Render corresponding sub-view data
    if (currentWMSTab === 'stock') {
      renderStockLots();
    } else if (currentWMSTab === 'history') {
      renderTransactionsLog();
    } else if (currentWMSTab === 'sales') {
      populateSalesProductsDropdown();
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

    const elRelCount = document.getElementById('wms-stat-released-count');
    const elRelWeight = document.getElementById('wms-stat-released-weight');
    const elQuaCount = document.getElementById('wms-stat-quarantine-count');
    const elQuaWeight = document.getElementById('wms-stat-quarantine-weight');
    const elRejCount = document.getElementById('wms-stat-rejected-count');
    const elRejWeight = document.getElementById('wms-stat-rejected-weight');
    const elTxCount = document.getElementById('wms-stat-tx-count');

    if (elRelCount) elRelCount.textContent = relCount;
    if (elRelWeight) elRelWeight.textContent = `${relWeight.toFixed(3)} ${stockLots[0]?.Unit || 'kg'}`;
    if (elQuaCount) elQuaCount.textContent = quaCount;
    if (elQuaWeight) elQuaWeight.textContent = `${quaWeight.toFixed(3)} ${stockLots[0]?.Unit || 'kg'}`;
    if (elRejCount) elRejCount.textContent = rejCount;
    if (elRejWeight) elRejWeight.textContent = `${rejWeight.toFixed(3)} ${stockLots[0]?.Unit || 'kg'}`;
    if (elTxCount) elTxCount.textContent = wmsTransactions.length;
  }

  function renderStockLots() {
    const tbody = document.getElementById('wms-stock-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const searchInput = document.getElementById('wms-stock-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filtered = stockLots.filter(lot => {
      if (!lot) return false;
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
      if (currentUserRole === 'admin' || currentUserRole === 'qc') {
        const btnClass = 'btn btn-secondary btn-sm';
        const style = 'padding: 2px 6px; font-size: 0.72rem; margin: 0 2px;';
        let deleteBtnHtml = '';
        if (currentUserRole === 'admin') {
          deleteBtnHtml = `
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

      tr.innerHTML = `
        <td style="padding: 12px; font-weight: bold; color: var(--cyan);">${lot.Material_Code}</td>
        <td style="padding: 12px; color: #fff;">${lot.Material_Name}</td>
        <td style="padding: 12px;"><strong style="color: var(--amber); font-family: monospace;">${lot.Lot_Number}</strong></td>
        <td style="padding: 12px; font-weight: bold; color: var(--emerald);">${lot.Current_Qty} ${lot.Unit}</td>
        <td style="padding: 12px; color: var(--rose);">${lot.Expiry_Date}</td>
        <td style="padding: 12px;">${statusMap[lot.Status] || lot.Status}</td>
        <td style="padding: 12px; text-align: center;">${actionsHtml}</td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  window.changeLotStatus = function(lotId, newStatus) {
    const lot = stockLots.find(l => l && String(l.Lot_ID) === String(lotId));
    if (!lot) return;

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

    saveWMS(true);
    renderWMSViews();

    if (window.showToast) {
      window.showToast('تم حذف اللوت والعمليات المرتبطة به نهائياً 🗑️', 'success');
    }
  };

  function renderTransactionsLog() {
    const tbody = document.getElementById('wms-history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (wmsTransactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 20px;">سجل الحركات فارغ حالياً.</td></tr>`;
      return;
    }

    wmsTransactions.forEach(tx => {
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
        QC_Status_Change: '<span style="color: #c084fc; font-weight: bold;">قرار جودة جودي 🧪</span>'
      };

      const dateStr = new Date(tx.Timestamp).toLocaleString('en-US');

      tr.innerHTML = `
        <td style="padding: 10px; font-family: monospace; font-size: 0.75rem; color: var(--text-dim);">${tx.Tx_ID}</td>
        <td style="padding: 10px;">${typeMap[tx.Tx_Type] || tx.Tx_Type}</td>
        <td style="padding: 10px; font-weight: bold; color: #fff;">${materialName}</td>
        <td style="padding: 10px;"><strong style="color: var(--amber); font-family: monospace;">${lotNumber}</strong></td>
        <td style="padding: 10px; font-weight: bold; color: ${tx.Quantity < 0 ? 'var(--rose)' : 'var(--emerald)'};">${tx.Quantity > 0 ? '+' : ''}${tx.Quantity}</td>
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

    // Filter out previous initial balance stock lots and transactions to prevent duplication
    stockLots = stockLots.filter(l => l && l.Storage_Location !== 'مستورد افتتاحي');
    wmsTransactions = wmsTransactions.filter(tx => tx && tx.Tx_Type !== 'Initial_Balance');

    wmsExcelImportTemp.forEach(row => {
      const lotId = 'lot-init-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const newLot = {
        Lot_ID: lotId,
        Material_Code: row.Material_Code,
        Material_Name: row.Material_Name,
        Lot_Number: row.Lot_Number,
        Current_Qty: row.Quantity,
        Unit: row.Unit,
        Status: 'Released',
        Expiry_Date: row.Expiry_Date,
        Storage_Location: 'مستورد افتتاحي',
        updatedAt: Date.now()
      };
      stockLots.push(newLot);

      wmsTransactions.unshift({
        Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        Lot_ID: lotId,
        Tx_Type: 'Initial_Balance',
        Quantity: row.Quantity,
        Reference_ID: 'استيراد رصيد افتتاحي من أكسل',
        Performed_By: currentUserRole,
        Timestamp: Date.now()
      });
    });

    saveWMS(true);
    
    wmsExcelImportTemp = [];
    document.getElementById('wms-excel-preview-container').classList.add('hidden');
    document.getElementById('wms-excel-file').value = '';
    
    currentWMSTab = 'stock';
    renderWMSViews();

    if (window.showToast) {
      window.showToast('تم استيراد الأرصدة الافتتاحية للمواد الخام بنجاح كـ Released 📥', 'success');
    }
  }

  function handleInboundSubmit(e) {
    e.preventDefault();
    const code = document.getElementById('wms-in-code').value.trim();
    const name = document.getElementById('wms-in-name').value.trim();
    const lotNum = document.getElementById('wms-in-lot').value.trim();
    const qty = parseFloat(document.getElementById('wms-in-qty').value) || 0;
    const unit = document.getElementById('wms-in-unit').value;
    const expiry = document.getElementById('wms-in-expiry').value;
    const location = document.getElementById('wms-in-location').value.trim();

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
      updatedAt: Date.now()
    };

    stockLots.push(newLot);

    wmsTransactions.unshift({
      Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      Lot_ID: lotId,
      Tx_Type: 'Inbound_Purchase',
      Quantity: qty,
      Reference_ID: 'استلام مادة أولية جديدة للمستودع',
      Performed_By: currentUserRole,
      Timestamp: Date.now()
    });

    saveWMS(true);
    
    document.getElementById('wms-form-inbound').reset();
    currentWMSTab = 'stock';
    renderWMSViews();

    if (window.showToast) {
      window.showToast('تم استلام الوارد بنجاح وحفظه في الحجر الصحي (Quarantine) 🔒', 'success');
    }
  }

  function populateSalesProductsDropdown() {
    const searchInput = document.getElementById('wms-sales-product-search');
    const hiddenProduct = document.getElementById('wms-sales-product');
    if (searchInput) searchInput.value = '';
    if (hiddenProduct) hiddenProduct.value = '';
    updateFEFORecommendation();
  }

  function setupSalesAutocomplete() {
    const inputSearch = document.getElementById('wms-sales-product-search');
    const hiddenProduct = document.getElementById('wms-sales-product');
    const dropdown = document.getElementById('wms-sales-product-dropdown');

    if (!inputSearch || !hiddenProduct || !dropdown) return;

    function getReleasedProducts() {
      const releasedProductsMap = new Map();
      stockLots.forEach(lot => {
        if (lot && lot.Status === 'Released' && lot.Current_Qty > 0) {
          releasedProductsMap.set(lot.Material_Name, lot.Unit);
        }
      });
      return Array.from(releasedProductsMap.entries()).map(([name, unit]) => ({ name, unit }));
    }

    function populateDropdown(query = '') {
      dropdown.innerHTML = '';
      const products = getReleasedProducts();
      const filtered = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));

      if (filtered.length === 0) {
        dropdown.innerHTML = '<div style="padding: 8px; color: var(--text-dim); text-align: center; font-size: 0.85rem;">لا توجد منتجات مطابقة</div>';
        dropdown.classList.remove('hidden');
        return;
      }

      filtered.forEach(p => {
        const item = document.createElement('div');
        item.style.padding = '8px 12px';
        item.style.cursor = 'pointer';
        item.style.fontSize = '0.88rem';
        item.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        item.style.transition = 'background 0.2s';
        item.textContent = `${p.name} (${p.unit})`;

        item.addEventListener('mouseenter', () => {
          item.style.background = 'rgba(6, 182, 212, 0.15)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });

        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          inputSearch.value = p.name;
          hiddenProduct.value = p.name;
          dropdown.classList.add('hidden');
          updateFEFORecommendation();
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
        const products = getReleasedProducts();
        const exists = products.some(p => p.name === inputSearch.value);
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

    const productName = select.value;
    const requiredQty = parseFloat(inputQty.value) || 0;

    if (!productName || requiredQty <= 0) {
      container.classList.add('hidden');
      return;
    }

    const lots = stockLots
      .filter(l => l && l.Material_Name === productName && l.Status === 'Released' && l.Current_Qty > 0)
      .sort((a, b) => new Date(a.Expiry_Date) - new Date(b.Expiry_Date));

    let remaining = requiredQty;
    let recommendationHtml = '<ul style="margin: 0; padding-right: 20px;">';
    let availableTotal = 0;

    lots.forEach(lot => {
      availableTotal += lot.Current_Qty;
      if (remaining <= 0) return;

      const take = Math.min(remaining, lot.Current_Qty);
      remaining -= take;

      recommendationHtml += `
        <li style="margin-bottom: 4px;">
          صرف <strong style="color: var(--emerald);">${take.toFixed(3)} ${lot.Unit}</strong> 
          من اللوت <strong style="color: var(--amber);">${lot.Lot_Number}</strong> 
          (تاريخ الانتهاء: <span style="color: var(--rose); font-weight: bold;">${lot.Expiry_Date}</span>، المتوفر: ${lot.Current_Qty} ${lot.Unit})
        </li>
      `;
    });

    recommendationHtml += '</ul>';

    if (requiredQty > availableTotal) {
      recommendationHtml += `
        <div style="color: var(--rose); font-weight: bold; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
          <i data-lucide="alert-circle" style="width:16px;height:16px;"></i>
          عذراً، الرصيد المتاح من هذا المنتج (${availableTotal.toFixed(3)}) غير كافٍ لتلبية الطلب!
        </div>
      `;
    }

    details.innerHTML = recommendationHtml;
    container.classList.remove('hidden');

    if (window.lucide) window.lucide.createIcons();
  }

  function handleSalesSubmit(e) {
    e.preventDefault();
    const productName = document.getElementById('wms-sales-product').value;
    const requiredQty = parseFloat(document.getElementById('wms-sales-qty').value) || 0;
    const ref = document.getElementById('wms-sales-ref').value.trim() || 'فاتورة شحن مبيعات';

    if (!productName || requiredQty <= 0) return;

    const lots = stockLots
      .filter(l => l && l.Material_Name === productName && l.Status === 'Released' && l.Current_Qty > 0)
      .sort((a, b) => new Date(a.Expiry_Date) - new Date(b.Expiry_Date));

    let availableTotal = 0;
    lots.forEach(l => availableTotal += l.Current_Qty);

    if (requiredQty > availableTotal) {
      alert(`الرصيد المفرج عنه غير كافٍ! المتوفر: ${availableTotal}، المطلوب: ${requiredQty}`);
      return;
    }

    let remaining = requiredQty;
    lots.forEach(lot => {
      if (remaining <= 0) return;

      const take = Math.min(remaining, lot.Current_Qty);
      lot.Current_Qty = parseFloat((lot.Current_Qty - take).toFixed(3));
      lot.updatedAt = Date.now();
      remaining -= take;

      wmsTransactions.unshift({
        Tx_ID: 'tx-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        Lot_ID: lot.Lot_ID,
        Tx_Type: 'Sales_Dispatch',
        Quantity: -take,
        Reference_ID: `شحن مبيعات للعملاء (${ref})`,
        Performed_By: currentUserRole,
        Timestamp: Date.now()
      });
    });

    saveWMS(true);
    
    document.getElementById('wms-form-sales').reset();
    document.getElementById('wms-fefo-recommendation').classList.add('hidden');
    currentWMSTab = 'stock';
    renderWMSViews();

    if (window.showToast) {
      window.showToast(`تم شحن وصرف كمية ${requiredQty} من المنتج [${productName}] بنجاح وفق مبدأ FEFO 🚚`, 'success');
    }
  }

  function addWeighingFormulationRow(selectedLotId = '', qty = 0) {
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

    const releasedLots = stockLots.filter(l => l && l.Status === 'Released' && l.Current_Qty > 0);

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

    inputSearch.addEventListener('focus', () => {
      dropdown.classList.remove('hidden');
      populateDropdown(inputSearch.value);
    });

    inputSearch.addEventListener('blur', () => {
      // Delay closing dropdown slightly so that mousedown events can register
      setTimeout(() => {
        dropdown.classList.add('hidden');
      }, 200);
    });

    inputSearch.addEventListener('input', (e) => {
      hiddenLotId.value = ''; // Reset ID on manual modification until they select again
      dropdown.classList.remove('hidden');
      populateDropdown(e.target.value);
      updateWeighingFormulationTotal();
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
    inputQty.addEventListener('input', updateWeighingFormulationTotal);

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

    elWeighingFormulationTbody.appendChild(tr);
  }

  function updateWeighingFormulationTotal() {
    if (!elWeighingFormulationTbody || !inputLogAcceptedKg) return;
    let total = 0;
    const rows = elWeighingFormulationTbody.querySelectorAll('tr');
    rows.forEach(row => {
      const input = row.querySelector('.wms-qty-input');
      const val = parseFloat(input?.value) || 0;
      total += val;
    });
    inputLogAcceptedKg.value = total.toFixed(3);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
