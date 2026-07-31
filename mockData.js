/**
 * Mock Data for Initial Pharma Batches with Partial Accepted & Rejected Quantities per Batch
 */

window.DEFAULT_BATCHES = [
  {
    id: 'batch-101',
    productName: 'سيتامول 500 ملغ (Cetamol Coated Tablets)',
    batchNo: 'B-2026-441',
    pharmaForm: 'solid',
    pharmaFormLabel: 'أقراص صلبة (ملبس)',
    isCoated: true,
    totalWeightKg: 500,
    lotsCount: 5,
    preCoatingMg: 95,
    postCoatingMg: 140,
    unitsPerBlister: 10,
    startDate: '2026-07-20',
    expDate: '2029-07-20',
    stages: [
      { id: 'weighing', name: 'الوزن الميداني والتحضير', status: 'completed', doneKg: 500, acceptedKg: 500, rejectedKg: 0 },
      { id: 'compression', name: 'الضغط (Compression)', status: 'in_progress', doneKg: 200, acceptedKg: 180, rejectedKg: 20 },
      { id: 'coating', name: 'التلبيس بالفيلم (Film Coating)', status: 'pending', doneKg: 0, acceptedKg: 0, rejectedKg: 0 },
      { id: 'blistering', name: 'البليستر والتغليف', status: 'pending', doneKg: 0, acceptedKg: 0, rejectedKg: 0 }
    ],
    currentStageIndex: 1,
    logs: [
      { time: '2026-07-20 09:00', text: 'بدء الباتش (500 كغ / 5 لوتات).' },
      { time: '2026-07-25 14:00', text: 'تم ضغط 200 كغ (180 كغ مقبول = 36,000 ظرف | 20 كغ مرفوض/إعادة تشغيل = 4,000 ظرف).' }
    ]
  },
  {
    id: 'batch-102',
    productName: 'إيبوبروفين 400 ملغ (Ibuprofen Capsules)',
    batchNo: 'B-2026-809',
    pharmaForm: 'capsule',
    pharmaFormLabel: 'كبسول',
    isCoated: false,
    totalWeightKg: 300,
    lotsCount: 3,
    preCoatingMg: 400,
    postCoatingMg: 400,
    unitsPerBlister: 10,
    startDate: '2026-07-15',
    expDate: '2029-07-15',
    stages: [
      { id: 'weighing', name: 'الوزن والتحضير', status: 'completed', doneKg: 300, acceptedKg: 300, rejectedKg: 0 },
      { id: 'filling', name: 'تعبئة الكبسول', status: 'completed', doneKg: 300, acceptedKg: 300, rejectedKg: 0 },
      { id: 'blistering', name: 'البليستر والتغليف', status: 'in_progress', doneKg: 100, acceptedKg: 95, rejectedKg: 5 }
    ],
    currentStageIndex: 2,
    logs: [
      { time: '2026-07-15 08:30', text: 'إطلاق الباتش 300 كغ (3 لوتات).' },
      { time: '2026-07-28 16:00', text: 'بليستر 100 كغ (95 كغ مقبول = 23,750 ظرف | 5 كغ مرفوض = 1,250 ظرف).' }
    ]
  },
  {
    id: 'batch-103',
    productName: 'ديكلوفيناك 100 ملغ (Diclofenac Suppositories)',
    batchNo: 'B-2026-112',
    pharmaForm: 'suppository',
    pharmaFormLabel: 'تحاميل',
    isCoated: false,
    totalWeightKg: 150,
    lotsCount: 3,
    preCoatingMg: 1500,
    postCoatingMg: 1500,
    unitsPerBlister: 5,
    startDate: '2026-07-28',
    expDate: '2028-07-28',
    stages: [
      { id: 'preparation', name: 'التحضير والتذويب', status: 'completed', doneKg: 150, acceptedKg: 150, rejectedKg: 0 },
      { id: 'filling', name: 'تعبئة وسكب التحاميل', status: 'in_progress', doneKg: 50, acceptedKg: 35, rejectedKg: 15 }
    ],
    currentStageIndex: 1,
    logs: [
      { time: '2026-07-28 10:00', text: 'بدء خط التحاميل 150 كغ (تم سكب 50 كغ: 35 كغ مقبول، 15 كغ بحاجة إعادة تشغيل).' }
    ]
  }
];
