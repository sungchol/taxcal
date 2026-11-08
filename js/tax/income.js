/* 종합소득세 (엑셀 「소득세」 시트) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui,
    T = () => TAX.tables.INCOME;
  const { fl, pos, n } = U;

  /* 경비율 DB 조회표 */
  let RATE_MAP = null;
  const rateOf = (code) => {
    if (!RATE_MAP) {
      RATE_MAP = {};
      (TAX.BIZ_RATES || []).forEach((r) => {
        RATE_MAP[r[0]] = r;
      });
    }
    return RATE_MAP[code];
  };

  /* 원천징수세액 입력 경로 (소득별) */
  const WH = {
    int25: "int25Wh",
    int14: "int14Wh",
    divNoGu: "divNoGuWh",
    divGu: "divGuWh",
    wage: "wageWh",
    pension: "pensionWh",
    other: "otherWh",
    religion: "religionWh",
  };
  const WH_NAME = {
    int25: "이자 (25%)",
    int14: "이자 (14%)",
    divNoGu: "배당 (Gross-up 제외)",
    divGu: "배당 (Gross-up 대상)",
    wage: "근로소득",
    pension: "연금소득",
    other: "기타소득",
    religion: "종교인 기타소득",
  };

  /* ── 계산 ── */
  // 사업소득 1건: 단순·기준경비율 또는 장부 (엑셀 사업소득 행 K~Y열)
  function bizRow(r) {
    const C = n(r.revenue);
    const rec = rateOf(r.code);
    const wh = n(r.wh);
    if (r.method === "book")
      return {
        ok: true,
        rec,
        revenue: C,
        expense: n(r.actualExp),
        income: C - n(r.actualExp),
        method: "장부",
        wh,
      };
    if (!rec)
      return { ok: false, revenue: C, expense: 0, income: C, method: "", wh };
    const B = T().business;
    const [, , K, L, R, H] = rec;
    const own = !!r.own,
      dis = !!r.disabled;
    const rd1 = (v) => Math.floor(v * 10 + 1e-9) / 10;
    const M = H === 0 && own ? K + B.ownSimple * 1 : K; // 자가율: 단순 +0.3%p
    const O = dis ? rd1(M + (100 - M) * B.disabled) : M; // 장애인 우대
    const P = dis ? (L > 0 ? rd1(L + (100 - L) * B.disabled) : 0) : rd1(L);
    // 기준경비율 배율 한도용 단순경비율 금액: 장애인 우대 전 경비율(M, L) 사용
    const Q_normal =
      C > B.excessLine && L > 0
        ? (B.excessLine * M) / 100 + ((C - B.excessLine) * L) / 100
        : (C * M) / 100;
    const Q =
      C > B.excessLine && P > 0
        ? (B.excessLine * O) / 100 + ((C - B.excessLine) * P) / 100
        : (C * O) / 100;
    const S = H === 0 && own ? R + B.ownStd : R; // 자가율: 기준 +0.4%p
    const book = r.method === "std" ? r.book : "simple";
    const W =
      r.method === "std"
        ? (C - Q_normal) * B.multiple[book === "double" ? "double" : "simple"]
        : C - Q;
    const X =
      book === "double"
        ? fl(C - (C * S) / 200 - n(r.mainExp))
        : fl(C - (C * S) / 100 - n(r.mainExp));
    const income = fl(Math.min(W, X) + 1e-6);
    return {
      ok: true,
      rec,
      revenue: C,
      expense: C - income,
      income,
      method: r.method === "std" ? "기준경비율" : "단순경비율",
      wh,
    };
  }
  const wageDeduction = (g) =>
    g > 0
      ? Math.min(
          fl(U.piecewise(g, T().wageDeduction.table)),
          T().wageDeduction.cap,
        )
      : 0;
  const pensionDeduction = (p) =>
    p > 0
      ? fl(
          Math.min(
            U.piecewise(p, T().pensionDeduction.table),
            T().pensionDeduction.cap,
          ),
        )
      : 0;
  const religionExpense = (c) =>
    c > 0 ? fl(U.piecewise(c, T().religionExpense.table)) : 0;
  const wageCredit = (j) =>
    j > 0 ? fl(U.piecewise(j, T().wageCredit.table)) : 0;
  const wageCreditLimit = (g) => {
    const b = U.bracket(g, T().wageCreditLimit);
    return fl(Math.max(b[1] - g * b[2], b[3]));
  };
  const childCredit = (k) => {
    const c = T().childCredit;
    k = Math.floor(n(k));
    return k <= 0
      ? 0
      : k === 1
        ? c.first
        : c.first + c.second + (k - 2) * c.more;
  };

  /* ── 분리과세 소득: ① 총수입금액 − ② 필요경비 − ③ 공제금액 = ④ 과세표준, × ⑤ 세율 = ⑥ 산출세액, − ⑦ 세액감면 = ⑧ 결정세액 ── */
  function separateCalc(st, globalIncome) {
    const t = T(),
      S = t.separate,
      rr = t.rental,
      LOCAL = TAX.tables.LOCAL_RATE;
    const items = [];
    const add = (key, name, revenue, expense, deduction, rate, extra = {}) => {
      if (!(revenue > 0)) return;
      const base = pos(revenue - expense - deduction);
      const table = Array.isArray(rate) ? rate : null;
      const tax = table ? U.progressive(base, table) : fl(base * rate);
      const reduction = Math.min(n(extra.reduction), tax);
      items.push({
        key,
        name,
        revenue,
        expense,
        deduction,
        base,
        tax,
        reduction,
        decided: tax - reduction,
        wh: n(extra.wh),
        rateLabel: table
          ? base > 0
            ? `${U.pct(U.rateOf(base, table))} 구간 (누진)`
            : "14~30%"
          : U.pct(rate),
        expNote: extra.expNote || "",
      });
    };
    // 주택임대 (14%, 등록 60% / 미등록 50% 필요경비, 다른 종합소득금액 2천만원 이하이면 400만 / 200만원 공제)
    const reg = !!st.rentRegistered;
    const rentRev = n(st.rentRevenue);
    add(
      "rental",
      "분리과세 주택임대소득",
      rentRev,
      fl(rentRev * (reg ? rr.expense.registered : rr.expense.other)),
      globalIncome <= rr.incomeLine
        ? reg
          ? rr.deduction.registered
          : rr.deduction.other
        : 0,
      rr.rate,
      { reduction: st.rentReduction, expNote: reg ? "등록 60%" : "미등록 50%" },
    );
    // 고배당 상장기업 배당소득 (14·20·25·30% 누진)
    add(
      "hiDiv",
      "고배당기업 배당소득",
      n(st.hiDiv),
      0,
      0,
      S.highDividend.table,
      { wh: st.hiDivWh },
    );
    // 연금소득 (사적연금 15%)
    add(
      "pension",
      "연금소득 (분리과세 선택)",
      n(st.sepPension),
      0,
      0,
      S.pension.rate,
      { wh: st.sepPensionWh },
    );
    // 분리과세 기타소득 (계약금이 위약금·배상금으로 대체되는 경우 20%)
    add(
      "deposit",
      "분리과세 기타소득 (위약금 대체 계약금)",
      n(st.sepDeposit),
      n(st.sepDepositExp),
      0,
      S.deposit.rate,
      { wh: st.sepDepositWh },
    );
    // 기타소득 (가상자산 양도·대여 20%, 250만원 공제)
    const cryptoIncome = pos(n(st.crypto) - n(st.cryptoExp));
    add(
      "crypto",
      "기타소득 (가상자산 양도·대여)",
      n(st.crypto),
      n(st.cryptoExp),
      Math.min(cryptoIncome, S.crypto.deduction),
      S.crypto.rate,
      { wh: st.cryptoWh },
    );
    // 직접 추가한 분리과세 소득
    (st.sepCustom || []).forEach((c, i) =>
      add(
        `custom${i}`,
        c.name || `기타 분리과세 ${i + 1}`,
        n(c.revenue),
        n(c.expense),
        0,
        n(c.rate) / 100,
        { wh: c.wh },
      ),
    );
    const sum = (k) => items.reduce((a, it) => a + it[k], 0);
    const decided = sum("decided"),
      wh = sum("wh");
    const local = items.reduce((a, it) => a + fl(it.decided * LOCAL), 0);
    const whLocal = fl(wh * LOCAL);
    return {
      items,
      decided,
      wh,
      local,
      whLocal,
      net: decided - wh,
      localNet: local - whLocal,
      rentRev,
    };
  }

  function calc(st) {
    const t = T(),
      BASIC = TAX.tables.BASIC,
      prog = (x) => U.progressive(x, BASIC);
    // 금융소득
    const i25 = n(st.int25),
      i14 = n(st.int14),
      dx = n(st.divNoGu),
      dg = n(st.divGu);
    const finTotal = i25 + i14 + dx + dg;
    const comp = finTotal > t.finThreshold;
    const others = i25 + i14 + dx;
    const grossUp =
      comp && dg > 0
        ? pos(
            fl(
              others < t.finThreshold
                ? (dg - (t.finThreshold - others)) * t.grossUp
                : dg * t.grossUp,
            ),
          )
        : 0;
    const finIncome = finTotal + grossUp;
    // 사업·근로·연금·기타·종교인
    const biz = (st.biz || []).map(bizRow);
    const bizIncome = biz.reduce((s, r) => s + r.income, 0);
    const gross = n(st.wage),
      wageDed = wageDeduction(gross),
      wageIncome = gross - wageDed;
    const pen = n(st.pension),
      penDed = pensionDeduction(pen),
      penIncome = pen - penDed;
    const otherIncome = n(st.other) - n(st.otherExp);
    const rel = n(st.religion),
      relDed = religionExpense(rel),
      relIncome = rel - relDed;
    const nonFin = bizIncome + wageIncome + penIncome + otherIncome + relIncome;
    const E17 = finIncome + nonFin; // 엑셀 소득금액 합계
    const globalIncome = comp ? E17 : nonFin; // 분리과세 금융소득 제외한 종합소득금액
    // 소득공제
    const p = t.personal;
    const ded = {
      basic: p.basic * Math.max(0, Math.floor(n(st.persons))),
      elder: p.elder * Math.max(0, Math.floor(n(st.elders))),
      disabled: p.disabled * Math.max(0, Math.floor(n(st.disabledPersons))),
      npension: n(st.npension),
      health: n(st.health),
      employ: n(st.employ),
      housing: n(st.housing),
      card: n(st.card),
      yellow: n(st.yellow),
    };
    const D23 = Object.values(ded).reduce((s, v) => s + v, 0);
    const D33 = E17 - D23;
    // 산출세액: 분리과세 방식(B)과 종합과세 방식(A) 중 큰 것
    const C37 = D33 - finIncome;
    const D37 =
      prog(C37) +
      fl(i25 * t.finRate.int25) +
      fl((i14 + dx + dg) * t.finRate.normal);
    const C36 = D33 - t.finThreshold;
    const finFlat = fl(t.finThreshold * t.finRate.normal); // 2천만원 × 14%
    const D36 = comp ? prog(C36) + finFlat : 0;
    const compSelected = comp && D36 > D37;
    const D35 = comp ? Math.max(D36, D37) : D37;
    // 세액공제
    const cr = {};
    cr.dividend = compSelected ? pos(Math.min(grossUp, D36 - D37)) : 0;
    cr.foreign =
      n(st.foreignIncome) > 0 && E17 > 0
        ? Math.min(n(st.foreignTax), fl((D35 * n(st.foreignIncome)) / E17))
        : 0;
    let wageCrLimit = 0;
    cr.wage = 0;
    if (gross > 0) {
      let base;
      if (compSelected) {
        const J49 = E17 - t.finThreshold;
        base = J49 > 0 ? ((D35 - finFlat) * wageIncome) / J49 : 0;
      } else {
        base = nonFin > 0 ? (wageIncome * prog(nonFin - D23)) / nonFin : 0;
      }
      wageCrLimit = wageCreditLimit(gross);
      cr.wage = Math.min(wageCredit(base), wageCrLimit);
    }
    cr.child = childCredit(st.kids);
    const pa = t.pensionAccount;
    const onlyWage = gross > 0 && globalIncome - wageIncome === 0;
    const pensionRate = (
      onlyWage ? gross <= pa.wageLine : globalIncome <= pa.incomeLine
    )
      ? pa.high
      : pa.low;
    const savEligible = Math.min(n(st.pensionSaving), pa.savingCap);
    const irpEligible = Math.min(n(st.irp), pos(pa.totalCap - savEligible));
    cr.irp = fl(irpEligible * pensionRate);
    cr.pensionSaving = fl(savEligible * pensionRate);
    cr.insurance = fl(
      Math.min(n(st.insurance), t.insurance.cap) * t.insurance.rate,
    );
    cr.medical =
      n(st.medical) > gross * t.medical.floorRate
        ? fl((n(st.medical) - gross * t.medical.floorRate) * t.medical.rate)
        : 0;
    cr.education = fl(n(st.education) * t.education);
    const rentRule =
      gross > 0
        ? t.rent.find(([g, i]) => gross <= g && globalIncome <= i)
        : null;
    cr.rent = rentRule ? fl(n(st.rent) * rentRule[2]) : 0;
    cr.donation = fl(
      Math.min(
        n(st.donation) * t.donation.rate,
        pos(E17 - finIncome) * t.donation.limitRate,
      ),
    );
    cr.religiousDonation = fl(n(st.donationReligious) * t.donation.rate);
    cr.politicsDonation = Math.min(fl(n(st.donationPolitics) / 1.1), 90909); // 10만원이하 정치자금기부금은 /1.1 세액공제
    cr.hometownLoveDonation = Math.min(
      fl(n(st.donationHometownLove) / 1.1),
      90909,
    ); // 10만원이하 고향사랑기부금은 /1.1 금액 세액공제

    //표준세액공제
    const stdBase =
      ded.health +
        ded.employ +
        ded.housing +
        cr.insurance +
        cr.education +
        cr.medical +
        cr.rent +
        cr.donation +
        cr.religiousDonation +
        cr.politicsDonation +
        cr.hometownLoveDonation >
      0
        ? 0
        : gross > 0
          ? t.standardCredit.wage
          : t.standardCredit.other;
    const G35 = E17 > 0 ? D35 - (D35 * finIncome) / E17 : D35; // 금융외 산출세액
    const G36 = E17 > 0 ? D35 - (D35 * t.finThreshold) / E17 : D35;
    cr.standard = pos(fl(Math.min(stdBase, compSelected ? G36 : G35)));
    // 공제액: 직접 수정값(crOv)이 있으면 그 값, 없으면 자동 계산값(autoCr)
    const autoCr = cr;
    const ov = st.crOv || {};
    const credits = {};
    const overridden = {};
    Object.keys(autoCr).forEach((k) => {
      overridden[k] = ov[k] != null;
      credits[k] = overridden[k] ? n(ov[k]) : autoCr[k];
    });

    // 기타 세액공제·세액감면 (직접 입력)
    const extras = (st.extraCredits || []).filter((e) => n(e.amount));
    const reduction = extras
      .filter((e) => e.kind === "reduction")
      .reduce((s, e) => s + n(e.amount), 0);
    let extraCredit = extras
      .filter((e) => e.kind !== "reduction")
      .reduce((s, e) => s + n(e.amount), 0);
    //중소기업감면
    const auto = n(
      (((D35 * st.specialReduction) / E17) * st.specialRate) / 100,
    );
    overridden.specialReduction = ov.specialReduction != null;
    const tax = overridden.specialReduction ? n(ov.specialReduction) : auto;
    extraCredit += tax;

    const D38 = Object.values(credits).reduce((s, v) => s + v, 0) + extraCredit;
    const D54 = pos(D35 - reduction - D38);
    const E54 = fl(D54 * TAX.tables.LOCAL_RATE);
    // 기납부세액: 소득별 원천징수 + 중간예납
    const whItems = Object.keys(WH).map((k) => ({
      name: WH_NAME[k],
      amount: n(st[WH[k]]),
    }));
    biz.forEach((b, i) =>
      whItems.push({ name: `사업소득 ${i + 1}`, amount: b.wh }),
    );
    //원천징수세액합계
    const withheld = whItems.reduce((s, w) => s + w.amount, 0);
    const prepaid = n(st.prepaid);
    const D58 = D54 - withheld - prepaid;
    const E58 = E54 - fl(withheld * TAX.tables.LOCAL_RATE);
    // 분리과세 소득 (종합소득과 합산하지 않고 따로 세액 계산)
    const sep = separateCalc(st, globalIncome);
    return {
      finTotal,
      comp,
      grossUp,
      finIncome,
      biz,
      gross,
      wageDed,
      wageIncome,
      pen,
      penDed,
      penIncome,
      otherIncome,
      rel,
      relDed,
      relIncome,
      nonFin,
      E17,
      globalIncome,
      ded,
      D23,
      D33,
      D36,
      D37,
      compSelected,
      D35,
      cr: credits,
      autoCr,
      overridden,
      extras,
      reduction,
      extraCredit,
      specialTaxReduction: {
        auto,
        tax,
        amount: st.specialReduction,
        rate: st.specialRate / 100,
      },
      wageCrLimit,
      pensionRate,
      D38,
      D54,
      E54,
      whItems,
      withheld,
      prepaid,
      D58,
      E58,
      sep,
      total: D58 + E58 + sep.net + sep.localNet,
      rate: U.rateOf(compSelected ? C36 : C37, BASIC),
    };
  }

  /* ── 예시값 (엑셀) ── */
  const CREDIT_KEYS = [
    "child",
    "pensionSaving",
    "irp",
    "insurance",
    "medical",
    "education",
    "rent",
    "donation",
    "religiousDonation",
    "politicsDonation",
    "hometownLoveDonation",
    "foreign",
    "wage",
    "dividend",
    "standard",
  ];
  const newOverrides = () => {
    const o = {};
    CREDIT_KEYS.forEach((k) => {
      o[k] = null; // null = 자동 계산
    });
    return o;
  };
  const newExtra = () => ({ kind: "credit", name: "", amount: 0 });
  const newSep = (i) => ({
    name: `기타 분리과세 ${i}`,
    revenue: 0,
    expense: 0,
    rate: 0,
    wh: 0,
  });
  const newBiz = () => ({
    code: "",
    revenue: 0,
    wh: 0,
    own: false,
    disabled: false,
    method: "simple",
    book: "simple",
    mainExp: 0,
    actualExp: 0,
  });
  const example = () => ({
    int25: 0,
    int25Wh: 0,
    int14: 0,
    int14Wh: 0,
    divNoGu: 0,
    divNoGuWh: 0,
    divGu: 0,
    divGuWh: 0,
    biz: [
      {
        code: "701201",
        revenue: 20000000,
        wh: 0,
        own: false,
        disabled: false,
        method: "simple",
        mainExp: 0,
        actualExp: 0,
      },
    ],
    wage: 0,
    wageWh: 0,
    pension: 0,
    pensionWh: 0,
    other: 0,
    otherExp: 0,
    otherWh: 0,
    religion: 0,
    religionWh: 0,
    persons: 1,
    elders: 0,
    disabledPersons: 0,
    npension: 0,
    health: 0,
    employ: 0,
    housing: 0,
    card: 0,
    yellow: 0,
    kids: 0,
    irp: 0,
    pensionSaving: 0,
    insurance: 0,
    medical: 0,
    education: 0,
    rent: 0,
    donation: 0,
    donationReligious: 0,
    foreignIncome: 0,
    foreignTax: 0,
    prepaid: 0,
    rentRevenue: 0,
    rentRegistered: true,
    rentReduction: 0,
    hiDiv: 0,
    hiDivWh: 0,
    sepPension: 0,
    sepPensionWh: 0,
    sepDeposit: 0,
    sepDepositExp: 0,
    sepDepositWh: 0,
    crypto: 0,
    cryptoExp: 0,
    cryptoWh: 0,
    sepCustom: [],
    crOv: newOverrides(),
    extraCredits: [newExtra()],
  });
  const blank = () => {
    const e = example();
    Object.keys(e).forEach((k) => {
      if (typeof e[k] === "number") e[k] = 0;
    });
    e.persons = 1;
    e.biz = [];
    return e;
  };

  /* ── 화면 ── */
  const codeInfo = (code) => {
    const rec = rateOf(code);
    if (!code) return "6자리 코드 또는 업종명으로 찾는다";
    return rec
      ? `${rec[1]}, 단순 ${rec[2]}%${rec[3] ? ` (4천만 초과 ${rec[3]}%)` : ""}, 기준 ${rec[4]}%`
      : "경비율 표에 없는 업종코드다";
  };
  // 소득 한 줄: 수입금액 | 필요경비(있을 때) | 원천징수세액
  const line = (revPath, revLabel, whPath, expPath, expLabel) =>
    `<div class="line">${UI.money(revPath, revLabel)}${expPath ? UI.money(expPath, expLabel) : UI.blankCell()}${UI.money(whPath, `원천징수세액: ${revLabel}`)}</div>`;

  /* ── 세액공제 입력: [기준 금액] [ ] [공제액(자동, 수정 가능)] ── */
  const CREDIT_ROWS = [
    {
      k: "child",
      label: "자녀세액공제",
      inputs: [["count", "kids", "자녀 수 (8세 이상)"]],
    },
    {
      k: "pensionSaving",
      label: "연금저축 세액공제",
      inputs: [["money", "pensionSaving", "연금저축 납입액"]],
    },
    {
      k: "irp",
      label: "퇴직연금 세액공제",
      inputs: [["money", "irp", "퇴직연금(IRP) 납입액"]],
    },
    {
      k: "insurance",
      label: "보험료 세액공제",
      inputs: [["money", "insurance", "보장성보험료"]],
    },
    {
      k: "medical",
      label: "의료비 세액공제",
      inputs: [["money", "medical", "의료비"]],
    },
    {
      k: "education",
      label: "교육비 세액공제",
      inputs: [["money", "education", "교육비"]],
    },
    {
      k: "rent",
      label: "월세 세액공제",
      inputs: [["money", "rent", "월세액"]],
    },
    {
      k: "donation",
      label: "기부금 세액공제 (일반)",
      inputs: [["money", "donation", "기부금 (일반)"]],
    },
    {
      k: "religiousDonation",
      label: "기부금 세액공제 (종교단체)",
      inputs: [["money", "donationReligious", "기부금 (종교단체)"]],
    },
    {
      k: "politicsDonation",
      label: "기부금 세액공제 (정치자금)",
      inputs: [["money", "donationPolitics", "기부금(10만원이하 정치자금)"]],
    },
    {
      k: "hometownLoveDonation",
      label: "기부금 세액공제 (고향사랑)",
      inputs: [
        ["money", "donationHometownLove", "기부금(10만원이하 고향사랑)"],
      ],
    },
    {
      k: "foreign",
      label: "외국납부세액공제",
      inputs: [
        ["money", "foreignIncome", "국외원천소득"],
        ["money", "foreignTax", "외국납부세액"],
      ],
    },
    {
      k: "wage",
      label: "근로소득세액공제",
      auto: "총급여와 근로소득 산출세액으로 계산한다",
    },
    {
      k: "dividend",
      label: "배당세액공제",
      auto: "금융소득 종합과세일 때 Gross-up 금액 한도로 계산한다",
    },
    {
      k: "standard",
      label: "표준세액공제",
      auto: "특별소득공제가 없으면 근로자 13만원, 그 외 7만원",
    },
  ];
  const CREDIT_LABEL = {};
  CREDIT_ROWS.forEach((c) => {
    CREDIT_LABEL[c.k] = c.label;
  });

  // 자동 계산 근거 (공제액 칸 아래 설명)
  function creditHint(k, r) {
    const t = T();
    if (k === "wage") return r.gross ? `한도 ${U.won(r.wageCrLimit)}원` : "";
    if (k === "irp" || k === "pensionSaving")
      return `공제율 ${U.pct(r.pensionRate)}`;
    if (k === "insurance")
      return `${U.won(t.insurance.cap)}원 한도 ${U.pct(t.insurance.rate)}`;
    if (k === "medical") return `총급여 3% 초과분의 ${U.pct(t.medical.rate)}`;
    if (k === "foreign") return "외국납부세액과 한도액 중 작은 금액";
    return "";
  }
  function creditMsg(k, r) {
    const hint = creditHint(k, r);
    if (r.overridden[k])
      return `직접 수정함, 자동 계산 ${U.won(r.autoCr[k])}원 <button class="linkbtn" type="button" data-act="auto" data-p="income.crOv.${k}">자동값으로</button>`;
    return hint ? `자동 계산, ${hint}` : "자동 계산";
  }

  function creditCell(k, r) {
    const v = r.overridden[k] ? r.cr[k] : r.autoCr[k];
    return `<div class="f cr${r.overridden[k] ? " manual" : ""}" data-crbox="${k}">
      <span class="l">${CREDIT_LABEL[k]}</span>
      <span class="in"><input class="won" inputmode="numeric" autocomplete="off" aria-label="${CREDIT_LABEL[k]} 공제액" data-p="income.crOv.${k}" data-t="ovmoney" data-ov="${k}" value="${v ? U.won(v) : ""}" placeholder="0"><i>원</i></span>
      <small data-crmsg="${k}">${creditMsg(k, r)}</small></div>`;
  }

  // 중소기업특별세액감면 massage
  function specialReductionMsg(r) {
    console.log("specialTaxReduction:", r.overridden.specialReduction);
    if (r.overridden.specialReduction)
      return `직접 수정함, 자동 계산 ${U.won(r.specialTaxReduction.auto)}원 <button class="linkbtn" type="button" data-act="auto" data-p="income.crOv.specialReduction">자동값으로</button>`;
    return "자동 계산";
  }

  // 세액공제 입력 화면
  function creditSection(s) {
    const r = calc(s);
    const rows = CREDIT_ROWS.map((c) => {
      const cells = c.auto
        ? [
            `<div class="f info"><span class="l">${c.label}</span><p>${c.auto}</p></div>`,
          ]
        : c.inputs.map(([type, key, label]) =>
            type === "count"
              ? UI.count(`income.${key}`, label)
              : UI.money(`income.${key}`, label),
          );
      while (cells.length < 2) cells.push(UI.blankCell());
      return `<div class="line">${cells.join("")}${creditCell(c.k, r)}</div>`;
    }).join("");

    const extras = (s.extraCredits || [])
      .map((e, i) => {
        const P = `income.extraCredits.${i}`;
        return `<div class="line extra">
        ${UI.sel(`${P}.kind`, "구분", [
          ["credit", "세액공제"],
          ["reduction", "세액감면"],
        ])}
        ${UI.text(`${P}.name`, "항목명 (예: 기장세액공제)")}
        <div class="f"><span class="l">공제·감면액</span>
          <span class="in"><input class="won" inputmode="numeric" autocomplete="off" data-p="${P}.amount" data-t="money" value="${n(e.amount) ? U.won(e.amount) : ""}" placeholder="0"><i>원</i></span>
          <small><button class="linkbtn" type="button" data-act="del" data-list="income.extraCredits" data-i="${i}">이 줄 삭제</button></small></div>
      </div>`;
      })
      .join("");

    // 중소기업특별세액감면
    const extra_specialReduction = `
      <div class="line extra">
        ${UI.money(`income.specialReduction`, "중소기업 감면소득")}
        ${UI.num(`income.specialRate`, "감면율", "%")}
        <div class="f cr${r.overridden.specialReduction ? " manual" : ""}" data-crbox="specialReduction">
          <span class="l">중소기업특별세액공제</span>
          <span class="in"><input class="won" inputmode="numeric" autocomplete="off" aria-label="중소기업특별세액 공제" data-p="income.crOv.specialReduction" data-t="ovmoney" data-ov="specialtax" value="" placeholder="0"><i>원</i></span>
          <small data-crmsg="specialReduction">${specialReductionMsg(r)}</small>
        </div>
      </div>
      `;

    return `<fieldset data-key="credits"><legend>세액공제</legend>
      <p class="note top">공제액 칸에는 자동 계산값이 들어간다. 금액을 고치면 그 값으로 계산하고, 칸을 비우거나 '자동값으로'를 누르면 다시 자동 계산값을 쓴다.</p>
      ${rows}</fieldset>
      <fieldset data-key="extraCredits"><legend>기타 세액공제·세액감면</legend>
      ${extra_specialReduction}
      ${extras}
      <button class="btn add" type="button" data-act="add" data-list="income.extraCredits">항목 추가</button>
      <p class="note">위 목록에 없는 세액공제(출산·입양, 혼인, 기장, 성실신고확인비용 등)나 세액감면을 직접 넣는다. </p></fieldset>`;
  }

  // 계산 후 공제액 칸 갱신: 직접 수정하지 않은 칸은 새 자동값으로 바꾼다 (입력 중인 칸은 건드리지 않는다)
  function sync(r) {
    if (typeof document === "undefined") return;
    CREDIT_KEYS.forEach((k) => {
      const box = document.querySelector(`[data-crbox="${k}"]`);
      if (!box) return;
      const input = box.querySelector("input");
      const manual = r.overridden[k];
      box.classList.toggle("manual", manual);
      if (!manual && document.activeElement !== input)
        input.value = r.autoCr[k] ? U.won(r.autoCr[k]) : "";
      const msg = box.querySelector(`[data-crmsg="${k}"]`);
      if (msg) msg.innerHTML = creditMsg(k, r);
    });

    // 중소기업특별세액감면
    const box = document.querySelector(`[data-crbox="specialReduction"]`);
    if (box) {
      const input = box.querySelector("input");
      const manual = r.overridden.specialReduction;
      box.classList.toggle("manual", manual);
      if (!manual && document.activeElement !== input)
        input.value = r.specialTaxReduction.tax
          ? U.won(r.specialTaxReduction.tax)
          : "";
      const msg = box.querySelector(`[data-crmsg="specialReduction"]`);
      if (msg) msg.innerHTML = specialReductionMsg(r);
    }
  }

  /* ── 분리과세 소득 입력 ── */
  function separateSection(s) {
    const block = (title, inner, note = "") =>
      `<div class="sep"><div class="sub">${title}</div><div class="grid">${inner}</div>${note ? `<p class="note">${note}</p>` : ""}</div>`;
    const custom = (s.sepCustom || [])
      .map((c, i) => {
        const P = `income.sepCustom.${i}`;
        return UI.item(
          c.name,
          "income.sepCustom",
          i,
          `<div class="grid">
        ${UI.money(`${P}.revenue`, "총수입금액")}${UI.money(`${P}.expense`, "필요경비")}
        ${UI.num(`${P}.rate`, "세율", "%")}${UI.money(`${P}.wh`, "원천징수세액")}</div>`,
          `${P}.name`,
        );
      })
      .join("");
    return `<details data-key="separateIncomes"><summary class="group-summary">분리과세 소득</summary>
      <p class="note top">종합소득과 합산하지 않고 따로 세액을 계산한다. 여기에 넣은 소득은 위의 금융·연금·기타소득 칸에 중복해서 넣지 않는다.</p>
      ${block(
        "주택임대소득 (14%)",
        UI.money("income.rentRevenue", "총수입금액 (2천만원 이하)") +
          UI.money("income.rentReduction", "세액감면 (소형주택 임대 등)") +
          UI.chk("income.rentRegistered", "임대사업자 등록 주택"),
        "필요경비는 등록 60%, 미등록 50%이고, 다른 종합소득금액이 2천만원 이하이면 등록 400만원, 미등록 200만원을 공제한다.",
      )}
      ${block(
        "고배당 상장기업 배당소득 (14~30%)",
        UI.money("income.hiDiv", "배당금액 (분리과세 신청분)") +
          UI.money("income.hiDivWh", "원천징수세액"),
        "2026~2028년에 지급받은 고배당 상장기업 배당에 적용한다. 2천만원 이하 14%, 3억원 이하 20%, 50억원 이하 25%, 초과분 30%다. 다른 소득이 적으면 종합과세가 더 유리할 수 있으니 두 경우를 비교한다.",
      )}
      ${block(
        "연금소득 (15%)",
        UI.money("income.sepPension", "사적연금 총수입금액") +
          UI.money("income.sepPensionWh", "원천징수세액"),
        "사적연금이 연 1,500만원을 넘어 15% 분리과세를 선택한 경우에 넣는다.",
      )}
      ${block(
        "분리과세 기타소득 (20%)",
        UI.money("income.sepDeposit", "총수입금액 (위약금 대체 계약금)") +
          UI.money("income.sepDepositExp", "필요경비") +
          UI.money("income.sepDepositWh", "원천징수세액"),
        "계약금이 위약금·배상금으로 대체된 경우다.",
      )}
      ${block(
        "기타소득, 가상자산 양도·대여 (20%)",
        UI.money("income.crypto", "총수입금액 (양도·대여 대가)") +
          UI.money("income.cryptoExp", "필요경비 (취득가액 등)") +
          UI.money("income.cryptoWh", "원천징수세액"),
        "2027년 1월 1일 이후 양도·대여분부터 과세하며 연 250만원을 공제한다.",
      )}
      <div class="sub">그 밖의 분리과세 소득</div>
      ${custom}
      <button class="btn add" type="button" data-act="add" data-list="income.sepCustom">분리과세 소득 추가</button>
    </details>`;
  }

  function form(s) {
    const biz = s.biz
      .map((b, i) =>
        UI.item(
          `사업장 ${i + 1}`,
          "income.biz",
          i,
          `
      <div class="grid">
        <label class="f wide"><span class="l">업종코드 (2025년 귀속 경비율)</span><span class="in"><input list="bizcodes" data-p="income.biz.${i}.code" data-t="code" value="${U.esc(b.code)}" placeholder="예: 940909"></span><small data-codeinfo="${i}">${U.esc(codeInfo(b.code))}</small></label>
        ${UI.sel(
          `income.biz.${i}.method`,
          "소득금액 계산 방법",
          [
            ["simple", "단순경비율"],
            ["std", "기준경비율"],
            ["book", "장부 (실제 필요경비)"],
          ],
          true,
        )}
      </div>
      <div class="line">${UI.money(`income.biz.${i}.revenue`, "수입금액")}${b.method === "book" ? UI.money(`income.biz.${i}.actualExp`, "필요경비 (장부)") : b.method === "std" ? UI.money(`income.biz.${i}.mainExp`, "주요경비 (매입·임차료·인건비)") : UI.blankCell()}${UI.money(`income.biz.${i}.wh`, "원천징수세액")}</div>
      ${
        b.method !== "book"
          ? `<div class="grid">${
              b.method === "std"
                ? UI.sel(`income.biz.${i}.book`, "기장 의무", [
                    ["double", "복식부기의무자"],
                    ["simple", "간편장부대상자"],
                  ])
                : ""
            }${UI.chk(`income.biz.${i}.own`, "자가 사업장")}${UI.chk(`income.biz.${i}.disabled`, "장애인 사업자")}</div>`
          : ""
      }`,
        ),
      )
      .join("");

    return (
      UI.intro(
        "income",
        "종합소득세",
        "소득마다 수입금액과 원천징수세액을 함께 넣는다. 사업소득은 업종코드로 단순·기준경비율을 찾아 소득금액을 계산한다.",
      ) +
      UI.layout(
        `
      <fieldset style="margin-bottom: 0; padding-bottom: 0;"></fieldset>  
      <details data-key="financialIncomes"><summary class="group-summary">금융소득</summary>
        ${line("income.int25", "이자 (비영업대금 25%)", "income.int25Wh")}
        ${line("income.int14", "이자 (14%)", "income.int14Wh")}
        ${line("income.divNoGu", "배당 (Gross-up 제외)", "income.divNoGuWh")}
        ${line("income.divGu", "배당 (Gross-up 대상)", "income.divGuWh")}
        <p class="note">이자·배당 합계가 2천만원을 넘으면 종합과세와 분리과세 중 큰 세액을 적용한다.</p></details>
      <fieldset><legend>사업소득</legend>${biz}<button class="btn add" type="button" data-act="add" data-list="income.biz">사업장 추가</button></fieldset>
      <details data-key="laborPensionsEtc"><summary class="group-summary">근로·연금·기타소득</summary>
        ${line("income.wage", "근로소득 총급여 (여러 곳이면 합계)", "income.wageWh")}
        ${line("income.pension", "총연금액 (공적연금 등)", "income.pensionWh")}
        ${line("income.other", "기타소득 수입금액", "income.otherWh", "income.otherExp", "기타소득 필요경비")}
        ${line("income.religion", "종교인 기타소득", "income.religionWh")}
        <p class="note">원천징수세액은 지방소득세를 뺀 소득세분만 넣는다. 원천징수된 지방소득세는 그 10%로 자동 계산한다. 근로소득은 연말정산 결정세액을 넣는다.</p></details>
      ${UI.group("소득공제", UI.count("income.persons", "기본공제 인원 (본인 포함)") + UI.count("income.elders", "경로우대 (70세 이상)") + UI.count("income.disabledPersons", "장애인") + UI.money("income.npension", "국민연금보험료") + UI.money("income.health", "건강보험료 (근로)") + UI.money("income.employ", "고용보험료 (근로)") + UI.money("income.housing", "주택자금공제") + UI.money("income.card", "신용카드 등 공제액") + UI.money("income.yellow", "소기업·소상공인 공제 (노란우산)"))}
      ${creditSection(s)}
      <fieldset style="border-top: 1px solid #ccc;margin-top: 1em;padding-top: 1em">
        <legend>기타 기납부세액</legend>
        <div class="grid">${UI.money("income.prepaid", "중간예납세액")}</div>
      </fieldset>
      ${separateSection(s)}
      ${UI.basis([
        "세율은 2023년 이후 귀속분 기본세율(과세표준 1,400만원 이하 6% ~ 10억원 초과 45%)을 쓴다.",
        "사업소득은 엑셀의 2025년 귀속 단순·기준경비율 1,542개 업종을 쓰고, 자가율(단순 +0.3%p, 기준 +0.4%p)과 기준경비율 배율 한도(복식 3.4배, 간편 2.8배)는 엑셀 수식과 같다. 장애인 우대율은 단순경비율에만 적용하고, 기준경비율의 배율 한도 계산에는 우대 전 단순경비율을 쓴다.",
        "원천징수세액은 엑셀 F열처럼 소득별로 입력하고 합계를 기납부세액으로 뺀다. 지방소득세 기납부분은 원천징수세액 합계의 10%다.",
        "금융소득은 이자·배당 합계가 2천만원을 넘을 때만 종합과세 비교를 한다. Gross-up 금액이 음수가 되지 않도록 했다.",
        "자녀세액공제는 2025년 귀속분부터 바뀐 금액(1명 25만원, 2명 55만원, 셋째부터 1명당 40만원)이다.",
        "연금계좌 세액공제에 한도(연금저축 600만원, 퇴직연금 합산 900만원)를 적용하고, 보장성보험료는 연 100만원 한도로 12%를 공제한다.",
        "세액공제는 항목마다 자동 계산값을 보여 주고 직접 고칠 수 있다. 목록에 없는 세액공제와 세액감면은 기타 세액공제·세액감면 칸에 넣는다.",
        "분리과세 소득은 분리과세 소득 결정세액 계산서 순서(총수입금액 − 필요경비 − 공제금액 = 과세표준, × 세율 = 산출세액, − 세액감면 = 결정세액)로 계산하고 지방소득세 10%를 따로 붙인다. 세율은 js/data/tax-tables.js 의 separate 항목에 있다.",
        "자동 계산하지 않는 것: 출산·입양, 혼인, 기장, 성실신고 세액공제, 월세 공제 한도, 주택임대 소형주택 감면액(직접 입력), 고배당기업 해당 여부 판정.",
      ])}`,
        "income",
      )
    );
  }

  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won,
      pct = U.pct;
    const whText = (v) => (v ? `원천징수 ${won(v)}` : "");
    const rows = [R("소득금액", "", "head")];
    console.log("state", s);
    console.log("sheet", r);
    if (r.finTotal) {
      const finWh = n(s.int25Wh) + n(s.int14Wh) + n(s.divNoGuWh) + n(s.divGuWh);
      rows.push(
        R(
          "금융소득",
          r.finIncome,
          "",
          [
            r.comp
              ? `종합과세 대상${r.grossUp ? `, Gross-up ${won(r.grossUp)} 포함` : ""}`
              : "2천만원 이하, 분리과세",
            whText(finWh),
          ]
            .filter(Boolean)
            .join(", "),
        ),
      );
    }
    r.biz.forEach((b, i) =>
      rows.push(
        R(
          `사업소득 ${i + 1}`,
          b.income,
          "",
          b.ok
            ? [
                `${b.method}, 수입 ${won(b.revenue)} − 경비 ${won(b.expense)}`,
                whText(b.wh),
              ]
                .filter(Boolean)
                .join(", ")
            : "업종코드를 확인한다",
        ),
      ),
    );
    if (r.gross)
      rows.push(
        R(
          "근로소득금액",
          r.wageIncome,
          "",
          [
            `총급여 ${won(r.gross)} − 근로소득공제 ${won(r.wageDed)}`,
            whText(n(s.wageWh)),
          ]
            .filter(Boolean)
            .join(", "),
        ),
      );
    if (r.pen)
      rows.push(
        R(
          "연금소득금액",
          r.penIncome,
          "",
          [`연금소득공제 ${won(r.penDed)}`, whText(n(s.pensionWh))]
            .filter(Boolean)
            .join(", "),
        ),
      );
    if (n(s.other))
      rows.push(R("기타소득금액", r.otherIncome, "", whText(n(s.otherWh))));
    if (r.rel)
      rows.push(
        R(
          "종교인 기타소득금액",
          r.relIncome,
          "",
          [`필요경비 ${won(r.relDed)}`, whText(n(s.religionWh))]
            .filter(Boolean)
            .join(", "),
        ),
      );
    rows.push(R("종합소득금액", r.E17, "sum"));
    rows.push(R("소득공제", r.D23, "in1"));
    rows.push(R("과세표준", Math.max(0, r.D33), "sum"));
    rows.push(R("산출세액", "", "head"));
    if (r.comp) {
      rows.push(
        R(
          "종합과세 방식",
          r.D36,
          "in1",
          "(과세표준 − 2천만) × 기본세율 + 2천만 × 14%",
        ),
      );
      rows.push(
        R(
          "분리과세 방식",
          r.D37,
          "in1",
          "금융외 과세표준 × 기본세율 + 금융소득 × 원천세율",
        ),
      );
    }
    rows.push(R("산출세액", r.D35, "sum", `적용 구간 세율 ${pct(r.rate)}`));
    if (r.specialTaxReduction.tax) {
      rows.push(
        R(
          "중소기업 특별세액감면",
          r.specialTaxReduction.tax,
          "in1",
          r.overridden.specialReduction
            ? `직접 수정 (자동 계산 ${won(r.specialTaxReduction.auto)})`
            : `감면소득 ${won(r.specialTaxReduction.amount)} × 감면율 ${pct(r.specialTaxReduction.rate)}`,
        ),
      );
    }
    r.extras
      .filter((e) => e.kind === "reduction")
      .forEach((e) =>
        rows.push(
          R(
            U.esc(e.name) || "세액감면",
            n(e.amount),
            "in1",
            "세액감면, 직접 입력",
          ),
        ),
      );
    CREDIT_ROWS.forEach(({ k, label }) => {
      if (r.cr[k])
        rows.push(
          R(
            label,
            r.cr[k],
            "in1",
            r.overridden[k]
              ? `직접 수정 (자동 계산 ${won(r.autoCr[k])})`
              : creditHint(k, r),
          ),
        );
    });

    r.extras
      .filter((e) => e.kind !== "reduction")
      .forEach((e) =>
        rows.push(
          R(U.esc(e.name) || "기타 세액공제", n(e.amount), "in1", "직접 입력"),
        ),
      );
    rows.push(R("결정세액", r.D54, "sum"));
    if (r.withheld || r.prepaid) {
      rows.push(R("기납부세액", "", "head"));
      // r.whItems
      //   .filter((w) => w.amount)
      //   .forEach((w) => rows.push(R(`원천징수 (${w.name})`, w.amount, "in1")));
      if (r.withheld) rows.push(R("원천징수세액", r.withheld, "in1"));
      if (r.prepaid) rows.push(R("중간예납세액", r.prepaid, "in1"));
    }
    rows.push(
      R("차감납부세액 (소득세)", r.D58, "sum" + (r.D58 < 0 ? " neg" : "")),
    );
    rows.push(
      R(
        "지방소득세",
        r.E58,
        r.E58 < 0 ? "neg" : "",
        r.withheld
          ? `결정세액의 10% − 원천징수분 ${won(fl(r.withheld * TAX.tables.LOCAL_RATE))}`
          : "결정세액의 10%",
      ),
    );
    if (r.sep.items.length) {
      rows.push(R("분리과세 소득", "", "head"));
      r.sep.items.forEach((it) => {
        const parts = [`수입 ${won(it.revenue)}`];
        if (it.expense)
          parts.push(
            `경비 ${won(it.expense)}${it.expNote ? ` (${it.expNote})` : ""}`,
          );
        if (it.deduction) parts.push(`공제 ${won(it.deduction)}`);
        rows.push(
          R(
            U.esc(it.name),
            it.decided,
            "",
            `${parts.join(" − ")}, 과세표준 ${won(it.base)} × ${it.rateLabel}${it.reduction ? `, 감면 ${won(it.reduction)}` : ""}`,
          ),
        );
      });
      rows.push(R("분리과세 결정세액", r.sep.decided, "sum"));
      if (r.sep.wh) rows.push(R("원천징수세액 (분리과세)", r.sep.wh, "in1"));
      if (r.sep.wh)
        rows.push(R("분리과세 소득세액", r.sep.decided - r.sep.wh, "sum"));
      rows.push(
        R(
          "분리과세 지방소득세",
          r.sep.localNet,
          r.sep.localNet < 0 ? "neg" : "",
          r.sep.wh
            ? `결정세액의 10% − 원천징수분 ${won(r.sep.whLocal)}`
            : "결정세액의 10%",
        ),
      );
    }
    const msgs = [];
    r.biz.forEach((b, i) => {
      if (!b.ok && s.biz[i].revenue)
        msgs.push(
          `사업장 ${i + 1}의 업종코드가 경비율 표에 없어 경비 0원으로 계산했다.`,
        );
    });
    if (r.sep.rentRev > TAX.tables.INCOME.rental.revenueLine)
      msgs.push(
        "주택임대 수입금액이 2천만원을 넘으면 분리과세를 선택할 수 없고 종합과세 대상이다.",
      );
    const refund = r.total < 0;
    return {
      html: UI.sheet({
        title: "종합소득세 계산서",
        cap: "소득세 + 지방소득세",
        rows,
        totalLabel: refund
          ? "환급 예상액 (지방소득세 포함)"
          : "총예상세액 (지방소득세 포함)",
        total: r.total,
        msgs,
      }),
      label: refund ? "환급 예상액" : "총예상세액",
      total: r.total,
      result: r,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.income = {
    calc,
    example,
    blank,
    form,
    sheet,
    newItem: (i, list) =>
      list === "income.extraCredits"
        ? newExtra()
        : list === "income.sepCustom"
          ? newSep(i)
          : newBiz(),
    sync,
    codeInfo,
    rateOf,
  };
})((globalThis.TAX = globalThis.TAX || {}));
