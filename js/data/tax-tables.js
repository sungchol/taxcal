/* 세율표와 공제 기준 (세법 기준일 2026-11-01)
 * 구간 표 형식: [상한(이하), 세율, 누진공제]  → 세액 = 금액 × 세율 − 누진공제
 * 공제 표 형식: [상한(이하), 비율, 가산액]    → 공제액 = 금액 × 비율 + 가산액
 */
(function (TAX) {
  const INF = Infinity;

  TAX.tables = {
    basedOn: "2026-11-01",
    LOCAL_RATE: 0.1, // 지방소득세 = 소득세(산출·결정세액)의 10%

    /* 종합소득세·양도소득세 기본세율 (소득세법 제55조, 2023년 귀속 이후) */
    BASIC: [
      [14e6, 0.06, 0],
      [50e6, 0.15, 1.26e6],
      [88e6, 0.24, 5.76e6],
      [150e6, 0.35, 15.44e6],
      [300e6, 0.38, 19.94e6],
      [500e6, 0.4, 25.94e6],
      [1e9, 0.42, 35.94e6],
      [INF, 0.45, 65.94e6],
    ],

    /* 상속세·증여세 세율 (상속세 및 증여세법 제26조) */
    GIFT_INHERIT: [
      [1e8, 0.1, 0],
      [5e8, 0.2, 1e7],
      [1e9, 0.3, 6e7],
      [3e9, 0.4, 1.6e8],
      [INF, 0.5, 4.6e8],
    ],

    /* 납부지연가산세 일 이자율 구간 [시작일(초과), 종료일(이하), 일 이율] */
    LATE_INTEREST: [
      [null, "2019-02-11", 0.0003],
      ["2019-02-11", "2022-02-14", 0.00025],
      ["2022-02-14", null, 0.00022],
    ],
    /* 신고불성실가산세율 */
    REPORT_PENALTY: {
      ontime: 0,
      latepay: 0,
      none: 0.2,
      under: 0.1,
      fraud: 0.4,
    },

    /* 양도소득세: 부동산 */
    REALTY: {
      basicDeduction: 2.5e6, // 연 250만원 (자산 그룹별 1회)
      highPriceLine: 12e8, // 1세대 1주택 고가주택 기준 12억원
      nontaxMinHold: 2, // 1세대 1주택 비과세 최소 보유 연수
      heavyAdd: { 2: 0.2, 3: 0.3 },
      heavyGrace: ["2022-05-10", "2026-05-09"], // 다주택 중과 유예 기간 (2년 이상 보유 주택)
      shortTerm: { house: [0.7, 0.6], other: [0.5, 0.4] }, // [1년 미만, 2년 미만]
      longTerm: {
        minHold: 3,
        table1: { perYear: 0.02, maxYears: 15 }, // 일반 (최대 30%)
        table2: { hold: 0.04, live: 0.04, maxYears: 10, minLive: 2 }, // 1세대 1주택 (최대 80%)
      },
      reportMonths: 2, // 예정신고: 양도월 말일부터 2개월
    },

    /* 양도소득세: 주식 */
    STOCK: {
      basicDeduction: 2.5e6,
      classes: {
        A: {
          label: "대주주, 중소기업 외, 1년 미만 보유",
          rateText: "30%",
          table: [[INF, 0.3, 0]],
        },
        B: {
          label: "대주주 (그 외)",
          rateText: "20% / 3억 초과분 25%",
          table: [
            [3e8, 0.2, 0],
            [INF, 0.25, 1.5e7],
          ],
        },
        C: {
          label: "대주주 외, 중소기업",
          rateText: "10%",
          table: [[INF, 0.1, 0]],
        },
        D: {
          label: "대주주 외, 중소기업 외",
          rateText: "20%",
          table: [[INF, 0.2, 0]],
        },
      },
    },

    /* 종합소득세 */
    INCOME: {
      finThreshold: 2e7, // 금융소득 종합과세 기준
      finRate: { int25: 0.25, normal: 0.14 },
      grossUp: 0.1,
      personal: { basic: 1.5e6, elder: 1e6, disabled: 2e6 },
      wageDeduction: {
        cap: 2e7,
        table: [
          [5e6, 0.7, 0],
          [15e6, 0.4, 1.5e6],
          [45e6, 0.15, 5.25e6],
          [1e8, 0.05, 9.75e6],
          [INF, 0.02, 12.75e6],
        ],
      },
      pensionDeduction: {
        cap: 9e6,
        table: [
          [3.5e6, 1, 0],
          [7e6, 0.4, 2.1e6],
          [14e6, 0.2, 3.5e6],
          [INF, 0.1, 4.9e6],
        ],
      },
      religionExpense: {
        table: [
          [2e7, 0.8, 0],
          [4e7, 0.5, 6e6],
          [6e7, 0.3, 1.4e7],
          [INF, 0.2, 2e7],
        ],
      },
      wageCredit: {
        table: [
          [1.3e6, 0.55, 0],
          [INF, 0.3, 325000],
        ],
      },
      // 근로세액공제 한도: [총급여 상한, 기준액, 차감률, 최저액] → max(기준액 − 총급여×차감률, 최저액)
      wageCreditLimit: [
        [33e6, 740000, 0, 740000],
        [70e6, 1004000, 0.008, 660000],
        [120e6, 35660000, 0.5, 500000],
        [INF, 60500000, 0.5, 200000],
      ],
      childCredit: { first: 250000, second: 300000, more: 400000 }, // 2025년 귀속부터
      pensionAccount: {
        savingCap: 6e6,
        totalCap: 9e6,
        high: 0.15,
        low: 0.12,
        incomeLine: 45e6,
        wageLine: 55e6,
      },
      insurance: { cap: 1e6, rate: 0.12 },
      medical: { floorRate: 0.03, rate: 0.15 },
      education: 0.15,
      rent: [
        [55e6, 45e6, 0.17],
        [80e6, 70e6, 0.15],
      ], // [총급여 이하, 종합소득금액 이하, 공제율]
      donation: { rate: 0.15, limitRate: 0.3 },
      standardCredit: { wage: 130000, other: 70000 },
      business: {
        ownSimple: 0.3,
        ownStd: 0.4,
        disabled: 0.2,
        excessLine: 4e7,
        multiple: { double: 3.4, simple: 2.8 },
      },
      rental: {
        expense: { registered: 0.6, other: 0.5 },
        deduction: { registered: 4e6, other: 2e6 },
        incomeLine: 2e7,
        rate: 0.14,
        revenueLine: 2e7,
      },
      /* 분리과세 소득 (분리과세 소득 결정세액 계산서) */
      separate: {
        pension: { rate: 0.15 }, // 사적연금 연 1,500만원 초과분 분리과세 선택
        deposit: { rate: 0.2 }, // 계약금이 위약금·배상금으로 대체되는 기타소득
        crypto: { rate: 0.2, deduction: 2.5e6, from: "2027-01-01" }, // 가상자산 양도·대여 (2027년 이후분)
        // 고배당 상장기업 배당소득 (조세특례제한법, 2026.1.1.~2028.12.31. 지급분)
        highDividend: {
          from: "2026-01-01",
          to: "2028-12-31",
          table: [
            [2e7, 0.14, 0],
            [3e8, 0.2, 1.2e6],
            [5e9, 0.25, 1.62e7],
            [INF, 0.3, 2.662e8],
          ],
        },
      },
    },

    /* 증여세 */
    GIFT: {
      deduction: {
        spouse: 6e8,
        lineal: 5e7,
        linealMinor: 2e7,
        kin: 1e7,
        other: 0,
      },
      marriageCap: 1e8,
      minorAge: 19,
      skipSurcharge: 0.3,
      skipSurchargeMinorHigh: 0.4,
      skipHighLine: 2e9,
      minTaxable: 5e5,
      reportCredit: 0.03,
      installment: { half: 2e7, over: 1e7 },
      reportMonths: 3,
    },

    /* 법인세 (2026.1.1. 이후 개시 사업연도, 전 구간 1%p 인상) */
    CORP: {
      // 각 사업연도 소득 세율 [과세표준 상한, 세율, 누진공제]
      rate: [
        [2e8, 0.1, 0],
        [2e10, 0.2, 2e7],
        [3e11, 0.22, 4.2e8],
        [INF, 0.25, 9.42e9],
      ],
      // 성실신고확인대상 소규모 법인 (부동산임대업 주업 등): 2억원 이하 구간 없음
      rateSmall: [
        [2e10, 0.2, 0],
        [3e11, 0.22, 4e8],
        [INF, 0.25, 9.4e9],
      ],
      // 법인지방소득세 (법인세율의 1/10)
      local: [
        [2e8, 0.01, 0],
        [2e10, 0.02, 2e6],
        [3e11, 0.022, 4.2e7],
        [INF, 0.025, 9.42e8],
      ],
      localSmall: [
        [2e10, 0.02, 0],
        [3e11, 0.022, 4e7],
        [INF, 0.025, 9.4e8],
      ],
      // 최저한세율 (조세특례제한법 제132조)
      minTax: {
        sme: [[INF, 0.07, 0]],
        defer_1_3: [[INF, 0.08, 0]], //유예기간 경과 1~3년차
        defer_4_5: [[INF, 0.09, 0]], //유예기간 경과 4~5년차
        general: [
          [1e10, 0.1, 0],
          [1e11, 0.12, 2e8],
          [INF, 0.17, 5.2e9],
        ],
      },
      lossCap: { sme: 1, general: 0.8 }, // 이월결손금 공제한도 (각 사업연도 소득 대비)
      agriRate: 0.2, // 농어촌특별세: 감면세액의 20%
    },

    /* 취득세 (지방세법 제11조·제13조·제13조의2)
     * 세율은 종전 취득세분(acq)과 등록세분(reg)으로 나눠 적는다 (단위 %)
     * 농어촌특별세 = 과세표준 × 취득세분 × 10%, 지방교육세 = 과세표준 × 등록세분 × 20%
     */
    ACQ: {
      general: { acq: 2, reg: 2 }, // 주택 외 유상취득 4%
      farmBuy: { acq: 2, reg: 1 }, // 농지 유상취득 3%
      farmSelf: { acq: 1, reg: 0.5 }, // 2년 이상 자경농민 농지 1.5% (농특세 비과세)
      newBuild: { acq: 2, reg: 0.8 }, // 원시취득(신축) 2.8%
      inherit: { acq: 2, reg: 0.8 }, // 상속 2.8%
      inheritFarm: { acq: 2, reg: 0.3 }, // 농지 상속 2.3%
      inheritOneHouse: { acq: 0, reg: 0.8 }, // 1가구 1주택 상속 특례 0.8%
      gift: { acq: 2, reg: 1.5 }, // 증여 3.5%
      split: { acq: 2, reg: 0.3 }, // 공유물·합유물·총유물 분할 2.3%
      provisional: { acq: 0, reg: 0.2 }, // 가등기 0.2%
      heavy8: { acq: 6, reg: 2 }, // 주택 중과 8%
      heavy12: { acq: 10, reg: 2 }, // 주택 중과 12%
      // 주택 유상취득 일반세율: 6억 이하 1%, 9억 이하 (취득가액 × 2/3억 − 3)%, 초과 3%
      house: { low: 6e8, high: 9e8, lowRate: 1, highRate: 3 },
      houseAgri: 0.2, // 주택 유상취득 농특세: 표준세율 2% 기준 → 과세표준의 0.2%
      houseEduRatio: 0.1, // 주택 유상취득 지방교육세: 취득세의 10% (세율 × 50% × 20%)
      giftHeavyLine: 3e8, // 조정대상지역 증여 중과: 시가표준액 3억원 이상
      smallArea: 85, // 국민주택규모 85㎡ 이하 농특세 비과세
      reportDays: 60, // 유상·원시취득 신고기한 (취득일부터 60일)
      reportMonths: { gift: 3, inherit: 6 },
    },

    /* 상속세 */
    INHERIT: {
      lump: 5e8,
      spouseMin: 5e8,
      spouseMax: 3e9,
      spouseShare: 1.5,
      childShare: 1,
      finance: { full: 2e7, flatUpTo: 1e8, flat: 2e7, rate: 0.2, cap: 2e8 },
      cohabCap: 6e8,
      funeralCap: 15e6,
      appraisalCap: 5e6,
      minTaxable: 5e5,
      reportCredit: 0.03,
      reportMonths: 6,
    },
  };
})((globalThis.TAX = globalThis.TAX || {}));
