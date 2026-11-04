/* 양도소득세: 부동산 (엑셀 「양도_부동산」 시트) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui;
  const { fl, pos, n } = U;
  const EXPENSES = [
    ["acqTax", "취득세"],
    ["legal", "법무사 수수료"],
    ["bond", "채권 매각손실"],
    ["lawsuit", "소송·등기 비용"],
    ["brokerBuy", "중개수수료 (취득)"],
    ["brokerSell", "중개수수료 (양도)"],
    ["taxAgent", "세무사 비용"],
    ["etc", "기타 (자본적 지출 등)"],
  ];

  /* ── 계산 ── */
  function calcItem(it, idx) {
    const t = TAX.tables.REALTY;
    const hold = U.datedifY(it.acqDate, it.saleDate);
    const live =
      it.inDate && it.outDate ? U.datedifY(it.inDate, it.outDate) : 0;
    const isHouse = it.kind !== "other";
    const one = isHouse && !!it.oneHouse;
    const exp = U.sum(
      it,
      EXPENSES.map((e) => e[0]),
    );
    const gain = n(it.salePrice) - n(it.acqPrice) - exp;
    // 1세대 1주택 비과세 (12억 초과분은 비율로 과세)
    let nontax = 0;
    if (one && hold >= t.nontaxMinHold && gain > 0)
      nontax =
        n(it.salePrice) <= t.highPriceLine
          ? gain
          : fl((gain * t.highPriceLine) / n(it.salePrice));
    const gain2 = gain - nontax;
    // 다주택 중과 (유예 기간·경과조치 확인)
    const sale = U.isDate(it.saleDate) ? it.saleDate : "";
    const inGrace = sale && sale >= t.heavyGrace[0] && sale <= t.heavyGrace[1];
    const heavyAsked = isHouse && (it.heavy === "2" || it.heavy === "3");
    let heavy = heavyAsked,
      heavyNote = "";
    if (heavyAsked && inGrace && hold >= 2) {
      heavy = false;
      heavyNote = "중과 유예 기간(2022.5.10~2026.5.9) 양도로 기본세율 적용";
    } else if (heavyAsked && it.transition) {
      heavy = false;
      heavyNote = "경과조치 해당으로 중과 배제";
    }
    const add = heavy ? t.heavyAdd[it.heavy] : 0;
    // 장기보유특별공제
    const L = t.longTerm;
    let ltHold = 0,
      ltLive = 0,
      ltTable = "";
    if (!heavy && hold >= L.minHold) {
      if (one && live >= L.table2.minLive) {
        ltHold = Math.min(hold, L.table2.maxYears) * L.table2.hold;
        ltLive = Math.min(live, L.table2.maxYears, hold) * L.table2.live;
        ltTable = "표2";
      } else {
        ltHold = Math.min(hold, L.table1.maxYears) * L.table1.perYear;
        ltTable = "표1";
      }
    }
    const ltRate = Math.round((ltHold + ltLive) * 100) / 100;
    const ltd = gain2 > 0 ? fl(gain2 * ltRate) : 0;
    const income = gain2 - ltd;
    const st = isHouse ? t.shortTerm.house : t.shortTerm.other;
    const short = hold < 1 ? st[0] : hold < 2 ? st[1] : 0;
    return {
      idx,
      name: it.name || `물건${idx + 1}`,
      hold,
      live,
      one,
      exp,
      gain,
      nontax,
      gain2,
      ltHold,
      ltLive,
      ltRate,
      ltTable,
      ltd,
      income,
      heavy,
      heavyNote,
      add,
      short,
      sale,
      year: U.yearOf(sale),
      deadline: sale ? U.monthEnd(sale, t.reportMonths) : null,
    };
  }

  function calc(st) {
    const t = TAX.tables.REALTY,
      BASIC = TAX.tables.BASIC;
    const items = (st.items || []).map(calcItem);
    // 기본공제: 연도별 250만원, 먼저 양도한 자산부터 (소득세법 제103조)
    const years = {};
    items.forEach((r) => {
      (years[r.year] = years[r.year] || []).push(r);
    });
    Object.values(years).forEach((list) => {
      let left = t.basicDeduction;
      list
        .slice()
        .sort((a, b) =>
          a.sale < b.sale ? -1 : a.sale > b.sale ? 1 : a.idx - b.idx,
        )
        .forEach((r) => {
          r.basic = Math.min(left, pos(r.income));
          left -= r.basic;
        });
    });
    // 세율: 일반(중과 가산) 세액과 단기보유 세액 중 큰 것
    items.forEach((r) => {
      r.taxable = pos(r.income - r.basic);
      const general = U.progressive(r.taxable, BASIC, r.add);
      const shortTax = r.short ? fl(r.taxable * r.short) : 0;
      r.tax = Math.max(general, shortTax);
      r.rateLabel =
        r.taxable <= 0
          ? "-"
          : shortTax > general
            ? `${Math.round(r.short * 100)}% (단기보유)`
            : `${Math.round(U.rateOf(r.taxable, BASIC, r.add) * 100)}%${r.add ? ` (중과 +${Math.round(r.add * 100)}%p)` : ""}`;
    });
    // 비교과세: 같은 해 2건 이상이면 과세표준 합계 × 기본세율과 비교 (소득세법 제104조 제5항)
    let compare = 0;
    Object.values(years).forEach((list) => {
      if (list.filter((r) => r.taxable > 0).length < 2) return;
      const comb = U.progressive(
        list.reduce((s, r) => s + r.taxable, 0),
        BASIC,
      );
      const each = list.reduce((s, r) => s + r.tax, 0);
      if (comb > each) compare += comb - each;
    });
    // 가산세
    const mode = st.penaltyMode || "ontime";
    items.forEach((r) => {
      r.penReport = fl(r.tax * (TAX.tables.REPORT_PENALTY[mode] || 0));
      const li =
        mode !== "ontime"
          ? U.lateInterest(r.tax, r.deadline, st.payDate)
          : { amount: 0, days: 0 };
      r.penLate = li.amount;
      r.lateDays = li.days;
    });
    const total = (k) => items.reduce((s, r) => s + n(r[k]), 0);
    const calcTax = total("tax") + compare;
    const penalty = total("penReport") + total("penLate");
    const decided = calcTax + penalty;
    const local = fl(calcTax * TAX.tables.LOCAL_RATE);
    return {
      items,
      compare,
      calcTax,
      penalty,
      decided,
      local,
      total: decided + local,
    };
  }

  /* ── 예시값 (엑셀) ── */
  const newItem = (i) => ({
    name: `물건${i}`,
    kind: "house",
    oneHouse: false,
    heavy: "none",
    transition: false,
    acqDate: "",
    saleDate: U.today(),
    inDate: "",
    outDate: "",
    salePrice: 0,
    acqPrice: 0,
    acqTax: 0,
    legal: 0,
    bond: 0,
    lawsuit: 0,
    brokerBuy: 0,
    brokerSell: 0,
    taxAgent: 0,
    etc: 0,
  });
  const example = () => ({
    items: [
      Object.assign(newItem(1), {
        oneHouse: false,
        acqDate: "",
        saleDate: "2026-11-01",
        inDate: "",
        outDate: "",
        salePrice: 0,
        acqPrice: 0,
      }),
    ],
    penaltyMode: "ontime",
    payDate: U.today(),
  });
  const blank = () => ({
    items: [newItem(1)],
    penaltyMode: "ontime",
    payDate: U.today(),
  });

  /* ── 화면 ── */
  function form(s) {
    const items = s.items
      .map((it, i) => {
        const P = `realty.items.${i}`,
          house = it.kind !== "other";

        return UI.item(
          it.name,
          "realty.items",
          i,
          `<div class="grid">
          ${UI.sel(
            `${P}.kind`,
            "자산 종류",
            [
              ["house", "주택"],
              ["other", "주택 외 토지·건물"],
            ],
            true,
          )}
          ${
            house
              ? UI.sel(
                  `${P}.heavy`,
                  "다주택 중과 (조정대상지역)",
                  [
                    ["none", "해당 없음"],
                    ["2", "2주택 (+20%p)"],
                    ["3", "3주택 이상 (+30%p)"],
                  ],
                  true,
                )
              : ""
          }
          ${house ? UI.chk(`${P}.oneHouse`, "1세대 1주택", true) : ""}
          ${house && it.heavy !== "none" ? UI.chk(`${P}.transition`, "2026.5.9 이전 계약 경과조치 해당") : ""}
          ${UI.date(`${P}.acqDate`, "취득일")}
          ${UI.date(`${P}.saleDate`, "양도일", "잔금일과 등기접수일 중 빠른 날")}
          ${house && it.oneHouse ? UI.date(`${P}.inDate`, "입주일") + UI.date(`${P}.outDate`, "퇴거일 (또는 양도일)") : ""}
          ${UI.money(`${P}.salePrice`, "양도가액")}${UI.money(`${P}.acqPrice`, "취득가액")}
        </div>
        <div class="sub">필요경비</div>
        <div class="grid">${EXPENSES.map(([k, l]) => UI.money(`${P}.${k}`, l)).join("")}</div>`,
          `${P}.name`,
        );
      })
      .join("");
    return (
      UI.intro(
        "realty",
        "양도소득세, 부동산",
        "물건마다 취득·양도 정보를 넣는다. 같은 해에 여러 건을 팔면 기본공제는 한 번만 빼고 합산 비교과세를 한다.",
      ) +
      UI.layout(
        `
        <fieldset>
          <legend>양도 물건</legend>${items}
          <button class="btn add" type="button" data-act="add" data-list="realty.items">물건 추가</button>
        </fieldset>
        ${UI.group(
          "신고·납부",
          UI.sel(
            "realty.penaltyMode",
            "신고 상황",
            [
              ["ontime", "기한 내 신고·납부"],
              ["latepay", "기한 내 신고, 납부만 늦음"],
              ["none", "무신고 (20%)"],
              ["under", "과소신고 (10%)"],
              ["fraud", "부정 무신고·과소신고 (40%)"],
            ],
            true,
          ) +
            (s.penaltyMode !== "ontime"
              ? UI.date("realty.payDate", "실제 납부일 (또는 예정일)")
              : ""),
          '<p class="note">예정신고 기한은 양도일이 속한 달의 말일부터 2개월이다. 납부지연가산세는 기간별 이자율(0.03% → 0.025% → 0.022%)을 일수로 나눠 계산한다.</p>',
        )}
        ${UI.basis([
          "양도차익 → 1세대1주택 비과세 → 장기보유특별공제 → 기본공제 → 세율 순으로 계산한다. 12억원 초과 고가주택은 양도차익 × 12억/양도가액만큼 비과세한다.",
          "1세대 1주택 비과세는 2년 이상 보유한 경우에만 적용한다.",
          "1세대 1주택 장기보유특별공제는 2년 이상 거주했을 때만 표2(보유 연 4% + 거주 연 4%, 최대 80%)를 쓰고, 거주 2년 미만이면 표1(연 2%, 최대 30%)을 쓴다.",
          "보유 2년 미만 단기세율(주택 1년 미만 70%, 2년 미만 60%, 그 외 토지·건물 50%, 40%)을 일반·중과 세액과 비교해 큰 것을 쓴다.",
          "다주택 중과는 2026년 5월 9일 유예 종료를 반영했다. 2022.5.10~2026.5.9 사이 양도한 2년 이상 보유 주택은 기본세율과 장기보유특별공제를 적용한다.",
          "기본공제 250만원은 연도별 한 번만, 먼저 양도한 자산부터 뺀다. 같은 해 2건 이상이면 과세표준 합계에 기본세율을 적용한 세액과 비교한다.",
          "가산세를 결정세액에 더한다. 지방소득세는 엑셀처럼 산출세액의 10%다.",
          "반영하지 않은 것: 취득 당시 조정대상지역 2년 거주 요건, 일시적 2주택 등 비과세 특례, 양도차손 통산, 미등기·분양권·입주권, 감면.",
        ])}`,
        "realty",
      )
    );
  }

  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won,
      esc = U.esc;
    const rows = [],
      msgs = [];
    r.items.forEach((it) => {
      rows.push(R(esc(it.name), "", "head"));
      rows.push(
        R(
          "양도차익",
          it.gain,
          "",
          `보유 ${it.hold}년${it.one ? `, 거주 ${it.live}년` : ""}, 필요경비 ${won(it.exp)}`,
        ),
      );
      if (it.nontax) rows.push(R("1세대 1주택 비과세", it.nontax, "in1"));
      if (it.ltd)
        rows.push(
          R(
            "장기보유특별공제",
            it.ltd,
            "in1",
            `${it.ltTable} ${U.pct(it.ltRate)}${it.ltLive ? ` (보유 ${U.pct(it.ltHold)} + 거주 ${U.pct(it.ltLive)})` : ""}`,
          ),
        );
      if (it.basic) rows.push(R("기본공제", it.basic, "in1"));
      rows.push(R("과세표준", it.taxable, "sum"));
      rows.push(R("산출세액", it.tax, "", `세율 ${it.rateLabel}`));
      if (it.penReport) rows.push(R("신고불성실가산세", it.penReport, "in1"));
      if (it.penLate)
        rows.push(R("납부지연가산세", it.penLate, "in1", `${it.lateDays}일`));
      if (it.deadline)
        rows.push(R("예정신고 기한", U.fmtDate(it.deadline), "in1"));
      if (it.heavyNote) msgs.push(`${esc(it.name)}: ${it.heavyNote}.`);
      if (it.one && it.hold < 2)
        msgs.push(
          `${esc(it.name)}: 보유 2년 미만이라 1세대 1주택 비과세를 적용하지 않았다.`,
        );
      if (it.one && it.hold >= 3 && it.live < 2)
        msgs.push(
          `${esc(it.name)}: 거주 2년 미만이라 장기보유특별공제 표1을 적용했다.`,
        );
    });
    rows.push(R("합계", "", "head"));
    rows.push(
      R(
        "산출세액 합계",
        r.items.reduce((a, i) => a + i.tax, 0),
      ),
    );
    if (r.compare)
      rows.push(
        R(
          "비교과세 추가세액",
          r.compare,
          "",
          "과세표준 합계 × 기본세율이 더 크다",
        ),
      );
    if (r.penalty) rows.push(R("가산세", r.penalty));
    rows.push(R("결정세액", r.decided, "sum"));
    rows.push(R("지방소득세", r.local, "", "산출세액의 10%"));
    return {
      html: UI.sheet({
        title: "양도소득세 계산서",
        cap: "부동산, 물건별 계산 후 합산",
        rows,
        totalLabel: "총부담세액 (지방소득세 포함)",
        total: r.total,
        msgs,
      }),
      label: "총부담세액",
      total: r.total,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.realty = { calc, example, blank, form, sheet, newItem };
})((globalThis.TAX = globalThis.TAX || {}));
