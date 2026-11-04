/* 양도소득세: 주식 (엑셀 「양도_주식」 시트) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui;
  const { fl, pos, n } = U;

  /* ── 계산 ── */
  // 세율 그룹: A 대주주·중소기업 외·1년 미만 30%, B 대주주 그 외 20/25%, C 소액·중소 10%, D 소액·중소 외 20%
  const classOf = (major, nonSme, short) =>
    major ? (nonSme && short ? "A" : "B") : nonSme ? "D" : "C";

  function calc(st) {
    const t = TAX.tables.STOCK;
    const items = (st.items || []).map((it, idx) => {
      const hold = U.datedifY(it.acqDate, it.saleDate);
      const cls = classOf(!!it.major, !!it.nonSme, hold === 0);
      const exp = n(it.fee) + n(it.txTax);
      const sale = U.isDate(it.saleDate) ? it.saleDate : "";
      return {
        idx,
        name: it.name || `종목${idx + 1}`,
        hold,
        cls,
        exp,
        income: n(it.salePrice) - n(it.acqPrice) - exp,
        sale,
        year: U.yearOf(sale),
      };
    });
    // 연도·세율 그룹별 합산 → 기본공제 연 1회 (먼저 양도한 그룹부터) → 그룹 세율
    const groups = [],
      byYear = {};
    items.forEach((r) => {
      (byYear[r.year] = byYear[r.year] || []).push(r);
    });
    Object.keys(byYear)
      .sort()
      .forEach((y) => {
        const cls = {};
        byYear[y].forEach((r) => {
          const g = (cls[r.cls] = cls[r.cls] || {
            year: +y,
            cls: r.cls,
            income: 0,
            first: r.sale,
          });
          g.income += r.income;
          if (r.sale && (!g.first || r.sale < g.first)) g.first = r.sale;
        });
        let left = t.basicDeduction;
        Object.values(cls)
          .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0))
          .forEach((g) => {
            const c = t.classes[g.cls];
            g.basic = Math.min(left, pos(g.income));
            left -= g.basic;
            g.taxable = pos(g.income) - g.basic;
            g.tax = U.progressive(g.taxable, c.table);
            g.label = c.label;
            g.rate = c.rateText;
            groups.push(g);
          });
      });
    const calcTax = groups.reduce((s, g) => s + g.tax, 0);
    const local = fl(calcTax * TAX.tables.LOCAL_RATE);
    return { items, groups, calcTax, local, total: calcTax + local };
  }

  /* ── 예시값 (엑셀) ── */
  const newItem = (i) => ({
    name: `종목${i}`,
    major: false,
    nonSme: true,
    acqDate: "",
    saleDate: U.today(),
    salePrice: 0,
    acqPrice: 0,
    fee: 0,
    txTax: 0,
  });
  const example = () => ({
    items: [
      {
        name: "종목1",
        major: true,
        nonSme: false,
        acqDate: "",
        saleDate: U.today(),
        salePrice: 0,
        acqPrice: 0,
        fee: 0,
        txTax: 0,
      },
    ],
  });
  const blank = () => ({ items: [newItem(1)] });

  /* ── 화면 ── */
  function form(s) {
    const items = s.items
      .map((it, i) => {
        const P = `stock.items.${i}`;
        return UI.item(
          it.name,
          "stock.items",
          i,
          `<div class="grid">
        ${UI.chk(`${P}.major`, "대주주")}${UI.chk(`${P}.nonSme`, "중소기업 외 법인")}
        ${UI.date(`${P}.acqDate`, "취득일")}${UI.date(`${P}.saleDate`, "양도일")}
        
        ${UI.money(`${P}.salePrice`, "양도가액")}${UI.money(`${P}.acqPrice`, "취득가액")}
        ${UI.money(`${P}.fee`, "거래수수료")}${UI.money(`${P}.txTax`, "증권거래세")}
      </div>`,
          `${P}.name`,
        );
      })
      .join("");
    return (
      UI.intro(
        "stock",
        "양도소득세, 주식",
        "대주주 상장주식과 비상장주식 양도를 계산한다. 대주주 해당 여부는 직접 판단해 표시한다.",
      ) +
      UI.layout(
        `
      <fieldset><legend>양도 종목</legend>${items}<button class="btn add" type="button" data-act="add" data-list="stock.items">종목 추가</button></fieldset>
      ${UI.basis([
        "세율은 대주주는 과세표준 3억원 이하 20%, 초과분 25%이고 중소기업 외 법인을 1년 미만 보유하면 30%다. 대주주가 아니면 중소기업 10%, 그 외 20%다.",
        "기본공제 250만원은 연도별 한 번만, 먼저 양도한 세율 그룹부터 뺀다.",
        "반영하지 않은 것: 국외주식, 대주주 판정(지분율·보유액), 세율 그룹 사이 양도차손 통산, 반기별 예정신고 기한.",
      ])}`,
        "stock",
      )
    );
  }

  // ── 계산서 ──
  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won;
    const rows = [R("종목별 양도소득", "", "head")];
    r.items.forEach((it) =>
      rows.push(
        R(
          U.esc(it.name),
          it.income,
          it.income < 0 ? "neg" : "",
          `${TAX.tables.STOCK.classes[it.cls].label}, 보유 ${it.hold}년, 경비 ${won(it.exp)}`,
        ),
      ),
    );
    r.groups.forEach((g) => {
      rows.push(
        R(
          `${g.year || "연도 미입력"}${g.year ? "년" : ""}, ${g.label}`,
          "",
          "head",
        ),
      );
      rows.push(R("양도소득 합계", g.income));
      if (g.basic) rows.push(R("기본공제", g.basic, "in1"));
      rows.push(R("과세표준", g.taxable, "sum"));
      rows.push(R("산출세액", g.tax, "", `세율 ${g.rate}`));
    });
    rows.push(R("합계", "", "head"));
    rows.push(R("산출세액", r.calcTax, "sum"));
    rows.push(R("지방소득세", r.local));
    return {
      html: UI.sheet({
        title: "양도소득세 계산서",
        cap: "주식, 연도·세율 그룹별 합산",
        rows,
        totalLabel: "총부담세액 (지방소득세 포함)",
        total: r.total,
      }),
      label: "총부담세액",
      total: r.total,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.stock = { calc, example, blank, form, sheet, newItem };
})((globalThis.TAX = globalThis.TAX || {}));
