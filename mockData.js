/**
 * Initial Mock Data for Pharma Production Batches
 * Pre-configured with distinct Weighing & Preparation stages and Prior Batch Carry-Over
 */

window.DEFAULT_BATCHES = [
  {
    id: "batch-101",
    productName: "سيتامول 500 ملغ",
    batchNo: "B-2026-889",
    pharmaForm: "solid",
    pharmaFormLabel: "أقراص صلبة (ملبس)",
    isCoated: true,
    totalWeightKg: 100,
    lotsCount: 5,
    preCoatingMg: 95,
    postCoatingMg: 140,
    unitsPerBlister: 10,
    priorBatchNo: "B-2026-802",
    carryOverKg: 4.5,
    startDate: "2026-07-28",
    expDate: "2029-07-28",
    currentStageIndex: 2,
    stages: [
      { id: "weighing", name: "الوزن الميداني للمواد الخام", status: "completed", doneKg: 100, acceptedKg: 100, rejectedKg: 0 },
      { id: "preparation", name: "التحضير والمزج المبدئي", status: "completed", doneKg: 100, acceptedKg: 99.5, rejectedKg: 0.5 },
      { id: "compression", name: "الضغط (Compression)", status: "in_progress", doneKg: 40, acceptedKg: 38, rejectedKg: 2 },
      { id: "coating", name: "التلبيس بالفيلم (Film Coating)", status: "pending", doneKg: 0, acceptedKg: 0, rejectedKg: 0 },
      { id: "blistering", name: "البليستر والتغليف النهائي", status: "pending", doneKg: 0, acceptedKg: 0, rejectedKg: 0 }
    ],
    logs: [
      { time: "28/07/2026 09:30 AM", text: "تم إنشاء التشغيلة مع إضافة 4.5 كغ من باتش سابق رقم B-2026-802." },
      { time: "28/07/2026 11:00 AM", text: "إتمام عملية الوزن الميداني بكفاءة 100% (100 كغ مقبول = 71,428 ظرف)." },
      { time: "29/07/2026 02:15 PM", text: "تسجيل إنجاز بالضغط: 38 كغ مقبول (27,142 ظرف) و 2 كغ مرفوض (1,428 ظرف إعادة تشغيل)." }
    ]
  },
  {
    id: "batch-102",
    productName: "أمبسلين 250 ملغ",
    batchNo: "B-2026-912",
    pharmaForm: "capsule",
    pharmaFormLabel: "كبسول",
    isCoated: false,
    totalWeightKg: 80,
    lotsCount: 4,
    preCoatingMg: 280,
    postCoatingMg: 280,
    unitsPerBlister: 12,
    priorBatchNo: "",
    carryOverKg: 0,
    startDate: "2026-07-29",
    expDate: "2028-07-29",
    currentStageIndex: 1,
    stages: [
      { id: "weighing", name: "الوزن الميداني للمواصفات", status: "completed", doneKg: 80, acceptedKg: 80, rejectedKg: 0 },
      { id: "preparation", name: "التحضير والمزج الجاف", status: "in_progress", doneKg: 30, acceptedKg: 30, rejectedKg: 0 },
      { id: "filling", name: "تعبئة الكبسول", status: "pending", doneKg: 0, acceptedKg: 0, rejectedKg: 0 },
      { id: "blistering", name: "البليستر والتغليف النهائي", status: "pending", doneKg: 0, acceptedKg: 0, rejectedKg: 0 }
    ],
    logs: [
      { time: "29/07/2026 10:00 AM", text: "إنشاء تشغيلة الكبسول (80 كغ / 4 لوتات)." }
    ]
  },
  {
    id: "batch-103",
    productName: "بروفين 400 ملغ",
    batchNo: "B-2026-950",
    pharmaForm: "solid",
    pharmaFormLabel: "أقراص صلبة (غير ملبس)",
    isCoated: false,
    totalWeightKg: 120,
    lotsCount: 6,
    preCoatingMg: 450,
    postCoatingMg: 450,
    unitsPerBlister: 10,
    priorBatchNo: "B-2026-901",
    carryOverKg: 3.0,
    startDate: "2026-07-30",
    expDate: "2029-07-30",
    currentStageIndex: 3,
    stages: [
      { id: "weighing", name: "الوزن الميداني", status: "completed", doneKg: 120, acceptedKg: 120, rejectedKg: 0 },
      { id: "preparation", name: "التحضير والمزج المبدئي", status: "completed", doneKg: 120, acceptedKg: 120, rejectedKg: 0 },
      { id: "compression", name: "الضغط (Compression)", status: "completed", doneKg: 120, acceptedKg: 118, rejectedKg: 2 },
      { id: "blistering", name: "البليستر والتغليف النهائي", status: "in_progress", doneKg: 60, acceptedKg: 58, rejectedKg: 2 }
    ],
    logs: [
      { time: "30/07/2026 08:00 AM", text: "بدء تشغيلة بروفين وإتمام الضغط بنجاح وتجهيز البليستر." }
    ]
  }
];
