/* 증여세 (엑셀 「증여세」 시트) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui;
  const { fl, pos, n } = U;
  const REL = {
    spouse: "배우자",
    child: "자녀(직계비속)",
    grand: "손자녀(세대생략)",
    parent: "부모(직계존속)",
    kin: "기타친족",
    other: "그 외",
  };
  const FROM_ASCENDANT = ["child", "grand", "great"]; // 직계존속에게서 받는 경우
  const SKIP = ["grand", "great"]; // 세대생략

  /* ── 계산 ── */
  function calc(st) {
    const t = TAX.tables.GIFT,
      D = t.deduction;
    const age = U.datedifY(st.birth, st.giftDate);
    const minor = U.isDate(st.birth) && age < t.minorAge;
    const value = n(st.value);
    const base = value + n(st.prior); // 증여세 과세가액 (10년 내 동일인 가산)
    const rel = st.rel || "child";
    let ded = 0,
      dedLabel = "증여재산공제 없음";
    if (rel === "spouse") {
      ded = Math.min(base, D.spouse);
      dedLabel = "증여재산공제 (배우자 6억)";
    } else if (FROM_ASCENDANT.includes(rel)) {
      ded = Math.min(base, minor ? D.linealMinor : D.lineal);
      dedLabel = `증여재산공제 (직계존속, ${minor ? "미성년 2천만" : "5천만"})`;
    } else if (rel === "parent") {
      ded = Math.min(base, D.lineal);
      dedLabel = "증여재산공제 (직계비속, 5천만)";
    } else if (rel === "kin") {
      ded = Math.min(base, D.kin);
      dedLabel = "증여재산공제 (기타친족 1천만)";
    }
    const marriageOk = FROM_ASCENDANT.includes(rel);
    const marriage = marriageOk
      ? Math.min(n(st.marriage), t.marriageCap, pos(base - ded))
      : 0;
    const taxable = pos(base - ded - marriage - n(st.appraisal));
    const tooSmall = taxable < t.minTaxable;
    const tax = tooSmall ? 0 : U.progressive(taxable, TAX.tables.GIFT_INHERIT);
    const surRate = SKIP.includes(rel)
      ? minor && base > t.skipHighLine
        ? t.skipSurchargeMinorHigh
        : t.skipSurcharge
      : 0;
    const surcharge = fl(tax * surRate);
    const sumTax = tax + surcharge;
    const paid = n(st.paidCredit);
    const credit = pos(fl((sumTax - paid) * t.reportCredit));
    const decided = pos(sumTax - paid - credit);
    const increase = decided - n(st.original);
    const penalty = n(st.penReport) + n(st.penLate);
    const I = t.installment;
    const install =
      decided >= I.half
        ? fl(decided / 2)
        : decided > I.over
          ? decided - I.over
          : 0;
    return {
      age,
      minor,
      value,
      base,
      ded,
      dedLabel,
      marriage,
      marriageOk,
      taxable,
      tooSmall,
      rate: tooSmall ? 0 : U.rateOf(taxable, TAX.tables.GIFT_INHERIT),
      tax,
      surRate,
      surcharge,
      sumTax,
      paid,
      credit,
      decided,
      increase,
      penalty,
      net: increase + penalty,
      install,
      payNow: decided - install,
      deadline: U.isDate(st.giftDate)
        ? U.monthEnd(st.giftDate, t.reportMonths)
        : null,
    };
  }

  /* ── 예시값 (엑셀) ── */
  const example = () => ({
    birth: "",
    giftDate: U.today(),
    rel: "child",
    value: 0,
    prior: 0,
    marriage: 0,
    appraisal: 0,
    paidCredit: 0,
    original: 0,
    penReport: 0,
    penLate: 0,
  });
  const blank = () =>
    Object.assign(example(), {
      birth: "",
      giftDate: U.today(),
      rel: "child",
      value: 0,
    });

  /* ── 화면 ── */
  function form(s) {
    return (
      UI.intro(
        "gift",
        "증여세",
        "수증자(받는 사람) 기준으로 작성. 10년 안에 동일인에게 받은 증여는 증여가산액에 넣고 해당부분 증여세 산출세액은 기납부세액공제에 입력.",
      ) +
      UI.layout(
        `
      ${UI.group("수증자와 증여", UI.date("gift.birth", "수증자 생년월일") + UI.date("gift.giftDate", "증여일") + UI.sel("gift.rel", "관계 (증여자 입장에서)", Object.entries(REL), true))}
      <p class="note">※ 기타친족은 2025년 3월 14일 이후 증여분부터 4촌 이내 혈족과 3촌 이내 인척이다.</p>
      <p class="note" style="margin-bottom: 10px;">※ 관계: 예) 아버지가 아들에게 증여한 경우 → 자녀</p>
      ${UI.group(
        "증여재산",
        UI.money("gift.value", "증여재산가액") +
          UI.money("gift.prior", "10년 내 동일인 증여가산액") +
          (FROM_ASCENDANT.includes(s.rel)
            ? UI.money("gift.marriage", "혼인·출산 증여재산공제 (최대 1억)")
            : "") +
          UI.money("gift.appraisal", "감정평가수수료"),
      )}
      ${UI.group2(
        "세액공제와 수정신고",
        UI.money("gift.paidCredit", "기납부세액공제") +
          UI.money("gift.original", "당초 신고세액") +
          UI.money("gift.penReport", "신고불성실가산세") +
          UI.money("gift.penLate", "납부지연가산세"),
        '<p class="note">수정신고가 아니면 당초 신고세액과 가산세는 비워 둔다.</p>',
      )}
      ${UI.basis([
        "세율은 과세표준 1억원 이하 10%부터 30억원 초과 50%까지 5단계이고 신고세액공제는 3%다.",
        "증여재산공제는 배우자 6억원, 직계존속에게 받으면 5천만원(미성년 2천만원), 직계비속에게 받으면 5천만원, 기타친족 1천만원, 그 외 0원이다.",
        "기타친족은 2025년 3월 14일 이후 증여분부터 4촌 이내 혈족과 3촌 이내 인척이다.",
        "혼인·출산 공제는 직계존속에게 받은 경우에만 1억원 한도로 적용한다. 세대생략 증여는 산출세액의 30%를, 미성년자가 20억원을 넘게 받으면 40%를 할증한다.",
        "과세표준이 50만원 미만이면 세액을 0원으로 본다. 분납은 결정세액 2천만원 이하이면 1천만원 초과분, 그보다 크면 절반까지다.",
        "반영하지 않은 것: 재산 평가, 부담부증여, 창업자금·가업승계 특례, 비거주자.",
      ])}`,
        "gift",
      )
    );
  }

  /// ── 계산서 ──
  function sheet(s) {
    const g = calc(s),
      R = UI.R;
    const rows = [
      R(
        "증여재산가액",
        g.value,
        "",
        U.isDate(s.birth)
          ? `수증자 만 ${g.age}세${g.minor ? ", 미성년" : ""}`
          : "",
      ),
    ];
    if (n(s.prior)) rows.push(R("증여재산가산액", n(s.prior), "in1"));
    rows.push(R("증여세 과세가액", g.base, "sum"));
    rows.push(R(g.dedLabel, g.ded, "in1"));
    if (g.marriage) rows.push(R("혼인·출산 공제", g.marriage, "in1"));
    if (n(s.appraisal)) rows.push(R("감정평가수수료", n(s.appraisal), "in1"));
    rows.push(R("과세표준", g.taxable, "sum"));
    rows.push(
      R(
        "산출세액",
        g.tax,
        "",
        g.tooSmall ? "과세표준 50만원 미만" : `세율 ${U.pct(g.rate)}`,
      ),
    );
    if (g.surcharge)
      rows.push(R("세대생략 할증", g.surcharge, "", U.pct(g.surRate)));
    rows.push(R("산출세액 계", g.sumTax, "sum"));
    if (g.paid) rows.push(R("기납부세액공제", g.paid, "in1"));
    if (g.credit) rows.push(R("신고세액공제 (3%)", g.credit, "in1"));
    rows.push(R("결정세액", g.decided, "sum"));
    if (g.install) {
      rows.push(R("분납 가능액", g.install, "in1"));
      rows.push(R("기한 내 납부액", g.payNow, "in1"));
    }
    if (n(s.original) || g.penalty) {
      rows.push(R("본세 증가분", g.increase, "", "결정세액 − 당초 신고세액"));
      rows.push(R("가산세", g.penalty, "in1"));
      rows.push(R("차감납부세액", g.net, "sum"));
    }
    if (g.deadline)
      rows.push(
        R(
          "신고기한",
          U.fmtDate(g.deadline),
          "in1",
          "증여일이 속한 달 말일부터 3개월",
        ),
      );
    const msgs = [];
    if (!g.marriageOk && n(s.marriage))
      msgs.push("혼인·출산 공제는 직계존속에게 받는 경우에만 적용된다.");
    return {
      html: UI.sheet({
        title: "증여세 계산서",
        cap: `수증자 : ${REL[s.rel]}`,
        rows,
        totalLabel: "결정세액",
        total: g.decided,
        msgs,
      }),
      label: "결정세액",
      total: g.decided,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.gift = { calc, example, blank, form, sheet, REL };
})((globalThis.TAX = globalThis.TAX || {}));
