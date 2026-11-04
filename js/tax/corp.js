/* 법인세 (엑셀 「법인세」 시트) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui,
    T = () => TAX.tables.CORP;
  const { fl, pos, n } = U;

  /* ── 계산 ── */
  // 사업연도가 12개월 미만이면 연환산 후 세액을 월수로 안분한다 (엑셀 C11, C13 열)
  const annualTax = (base, months, table) => {
    if (!(base > 0) || !(months > 0)) return 0;
    const annual = (base * 12) / months;
    return fl((U.progressive(annual, table) * months) / 12);
  };

  function calc(st) {
    const t = T();
    const months = Math.min(12, Math.max(1, Math.floor(n(st.months)) || 12));
    const corType = st.size || "sme"; // 중소기업, 일반기업, 유예기간 경과 1~3년차, 유예기간 경과 4~5년차
    const sme = st.size !== "general";
    const small = !!st.smallCorp;
    // 소득금액 → 과세표준
    const B6 = n(st.netIncome) + n(st.addIncome) - n(st.deductIncome); // 차가감소득금액
    const B9 = B6 + n(st.donationExcess) - n(st.donationCarry); // 각 사업연도 소득금액
    const lossLimit = fl(pos(B9) * t.lossCap[sme ? "sme" : "general"]);
    const loss = Math.min(n(st.loss), lossLimit);
    const base = B9 - loss; // 과세표준
    const rateTable = small ? t.rateSmall : t.rate;
    const tax = annualTax(base, months, rateTable); // 산출세액
    const rate = U.rateOf((pos(base) * 12) / months, rateTable);

    // 공제감면 (최저한세 대상): 최저한세에 걸리면 뒤쪽 항목부터 배제한다
    const minItems = (st.minItems || []).map((it) => ({
      name: it.name || "공제감면",
      amount: n(it.amount),
      agri: !!it.agri,
    }));
    const minSum = minItems.reduce((s, it) => s + it.amount, 0);
    const minTax =
      st.applyMin === false
        ? 0
        : U.progressive(pos(base), t.minTax[st.size || "sme"]); // 최저한세액
    let cut =
      st.applyMin === false
        ? 0
        : Math.min(minSum, pos(minTax - (tax - minSum)));
    let left = cut;
    for (let i = minItems.length - 1; i >= 0; i--) {
      const c = Math.min(left, minItems[i].amount);
      minItems[i].excluded = c;
      left -= c;
    }
    let remain = tax;
    minItems.forEach((it) => {
      it.applied = Math.min(pos(remain), it.amount - (it.excluded || 0));
      remain -= it.applied;
    });

    // 공제감면 (최저한세 대상 외): 외국납부세액 + 사용자 추가 항목, 남은 세액 한도 안에서 순서대로
    const foreignLimit =
      n(st.foreignIncome) > 0 && base > 0
        ? fl((tax * n(st.foreignIncome)) / base)
        : null;
    const foreignTax =
      foreignLimit == null
        ? n(st.foreignTax)
        : Math.min(n(st.foreignTax), foreignLimit);
    const otherItems = [
      {
        name: "외국납부세액공제",
        amount: foreignTax,
        agri: false,
        foreign: true,
      },
      ...(st.otherItems || []).map((it) => ({
        name: it.name || "공제감면",
        amount: n(it.amount),
        agri: !!it.agri,
      })),
    ];
    otherItems.forEach((it) => {
      it.applied = Math.min(pos(remain), it.amount);
      remain -= it.applied;
    });

    const credits = [...minItems, ...otherItems].reduce(
      (s, it) => s + it.applied,
      0,
    );
    const penalty = n(st.penalty);
    const subtotal = tax - credits + penalty; // 가감계
    const net = subtotal - n(st.prepaid) - n(st.withheld) + n(st.addPay); // 차감납부할세액

    // 법인지방소득세: (과세표준 − 외국납부세액) 기준, 엑셀 E열
    const localBase = base - n(st.foreignTax);
    const localTax = annualTax(
      localBase,
      months,
      small ? t.localSmall : t.local,
    );
    const localWhAuto = fl(n(st.withheld) * TAX.tables.LOCAL_RATE);
    const localWh = st.localWh != null ? n(st.localWh) : localWhAuto;
    const localNet = localTax - localWh;

    // 농어촌특별세: 농특세 체크한 공제감면의 실제 적용액 − 감면분 추가납부세액
    const agriItems = [...minItems, ...otherItems].filter(
      (it) => it.agri && it.applied,
    );
    const agriBase = pos(
      agriItems.reduce((s, it) => s + it.applied, 0) - n(st.addPay),
    );
    const agriTax = fl(agriBase * t.agriRate);

    return {
      months,
      corType,
      sme,
      small,
      B6,
      B9,
      lossLimit,
      loss,
      base,
      tax,
      rate,
      minItems,
      minSum,
      minTax,
      cut,
      foreignLimit,
      foreignTax,
      otherItems,
      credits,
      penalty,
      subtotal,
      net,
      localBase,
      localTax,
      localWhAuto,
      localWh,
      localWhManual: st.localWh != null,
      localNet,
      agriItems,
      agriBase,
      agriTax,
      total: net + localNet + agriTax,
    };
  }

  /* ── 예시값 (엑셀) ── */
  const newRow = (name = "", agri = false) => ({ name, amount: 0, agri });
  const example = () => ({
    months: 12,
    size: "sme",
    smallCorp: false,
    applyMin: true,
    netIncome: 0,
    addIncome: 0,
    deductIncome: 0,
    donationExcess: 0,
    donationCarry: 0,
    loss: 0,
    minItems: [
      { name: "중소기업특별세액감면", amount: 0, agri: false },
      { name: "통합고용세액공제", amount: 0, agri: true },
      { name: "통합투자세액공제", amount: 0, agri: true },
    ],
    foreignTax: 0,
    foreignIncome: 0,
    otherItems: [{ name: "연구인력개발비세액공제", amount: 0, agri: false }],
    penalty: 0,
    prepaid: 0,
    withheld: 0,
    addPay: 0,
    localWh: 0,
  });
  const blank = () => ({
    months: 12,
    size: "sme",
    smallCorp: false,
    applyMin: false,
    netIncome: 0,
    addIncome: 0,
    deductIncome: 0,
    donationExcess: 0,
    donationCarry: 0,
    loss: 0,
    minItems: [newRow("", false)],
    foreignTax: 0,
    foreignIncome: 0,
    otherItems: [newRow("통합고용세액공제", true)],
    penalty: 0,
    prepaid: 0,
    withheld: 0,
    addPay: 0,
    localWh: null,
  });

  /* ── 화면 ── */
  // 공제감면 한 줄: [항목명] [금액] [농특세 체크] [삭제]
  const rowsHTML = (list, path, r) =>
    list
      .map((it, i) => {
        const P = `${path}.${i}`;
        const res =
          (path.endsWith("minItems") ? r.minItems : r.otherItems.slice(1))[i] ||
          {};
        const note = res.excluded
          ? `최저한세로 ${U.won(res.excluded)}원 배제`
          : "";
        return `<div class="line cline">
        ${UI.text(`${P}.name`, "항목명")}
        ${UI.money(`${P}.amount`, "공제·감면액")}
        <div class="f cside">${UI.chk(`${P}.agri`, "농특세 과세")}
          <small class="warnnote">${note}</small>
          <button class="linkbtn" type="button" data-act="del" data-list="${path}" data-i="${i}">이 줄 삭제</button></div>
      </div>`;
      })
      .join("");

  function form(s) {
    const r = calc(s);
    return (
      UI.intro(
        "corp",
        "법인세",
        "소득금액, 과세표준, 공제감면을 넣는다. 농특세 과세 항목은 체크하면 농어촌특별세 과세표준에 들어간다.",
      ) +
      UI.layout(
        `
      ${UI.group(
        "법인 구분",
        UI.count("corp.months", "사업연도 월수", "개월") +
          UI.sel("corp.size", "기업 구분", [
            ["sme", "중소기업"],
            ["defer_1_3", "유예기간 경과 1~3년차"],
            ["defer_4_5", "유예기간 경과 4~5년차"],
            ["general", "일반기업 (중견·대기업)"],
          ]) +
          UI.chk("corp.smallCorp", "성실신고확인대상 소규모 법인") +
          UI.chk("corp.applyMin", "최저한세 적용"),
        `<p class="note">기업 구분은 최저한세 세율(중소 7%, 일반 10~17%)과 이월결손금 공제한도(중소 100%, 일반 80%)에 쓰인다.</p>
         <p class="note">부동산임대·이자·배당수입 50%이상인 소규모법인에 대한 세율(20%부터시작)은 25년 귀속부터 적용하고, 25.2.28. 이후 개시사업연도 부터는 일반법인으로 취급(중소·중견배제)한다.</p>`,
      )}
      ${UI.group(
        "각 사업연도 소득금액",
        UI.smoney("corp.netIncome", "당기순이익") +
          UI.money("corp.addIncome", "익금산입·손금불산입") +
          UI.money("corp.deductIncome", "손금산입·익금불산입") +
          UI.money("corp.donationExcess", "기부금 한도초과액") +
          UI.money("corp.donationCarry", "기부금 한도초과 이월액 손금산입") +
          UI.money("corp.loss", "이월결손금"),
      )}
      <div class="separator"></div>
      <details data-key="minItems"><summary class="group-summary">공제감면 (최저한세 대상)</summary>
        ${rowsHTML(s.minItems, "corp.minItems", r)}
        <button class="btn add" type="button" data-act="add" data-list="corp.minItems">항목 추가</button>
        <p class="note">중소기업특별세액감면, 통합고용세액공제, 통합투자세액공제 등. 최저한세에 걸리면 아래쪽 항목부터 배제한다.</p>
      </details>
      <details data-key="otherItems"><summary class="group-summary">공제감면 (최저한세 대상 외)</summary>
        <div class="line">${UI.money("corp.foreignTax", "외국납부세액")}${UI.money("corp.foreignIncome", "국외원천소득 (한도 계산용)")}${UI.blankCell()}</div>
        ${rowsHTML(s.otherItems, "corp.otherItems", r)}
        <button class="btn add" type="button" data-act="add" data-list="corp.otherItems">항목 추가</button>
        <p class="note">국외원천소득을 넣으면 외국납부세액공제 한도범위내로 조정하고, 안넣으면 한도무시한다.</p>
        <p class="note">중소기업 연구인력개발비세액공제는 농특세 비과세 및 최저한세 적용대상이 아니다.</p>
      </details>
      ${UI.group(
        "가산세와 기납부세액",
        UI.money("corp.penalty", "가산세액") +
          UI.money("corp.prepaid", "중간예납세액") +
          UI.money("corp.withheld", "원천납부세액") +
          UI.money("corp.addPay", "감면분 추가납부세액") +
          localWhCell(r),
      )}
      ${UI.basis([
        "법인세율은 2026년 1월 1일 이후 개시하는 사업연도부터 과세표준 2억원 이하 10%, 200억원 이하 20%, 3,000억원 이하 22%, 초과 25%다.",
        "사업연도가 12개월 미만이면 과세표준을 연환산해 세율을 적용한 뒤 월수로 안분한다 (엑셀 연환산 열).",
        "최저한세는 공제감면 전 과세표준에 최저한세율을 곱한 금액이다. 산출세액에서 최저한세 대상 공제감면을 뺀 금액이 이보다 작으면 그 차액만큼 공제감면을 배제한다. 엑셀에는 없는 계산이다.",
        "이월결손금은 중소기업 소득의 100%, 일반기업 80%까지만 공제한다. 엑셀에는 없는 한도다.",
        "법인지방소득세는 (과세표준 − 외국납부세액)에 1~2.5% 세율을 적용한다. 원천납부분은 법인세 원천납부세액의 10%를 자동으로 넣고 직접 고칠 수 있다.",
        "농어촌특별세는 농특세 과세로 체크한 공제감면 중 실제로 적용된 금액(최저한세 배제분 제외)에서 감면분 추가납부세액을 뺀 금액의 20%다.",
        "반영하지 않은 것: 토지 등 양도소득 법인세, 미환류소득 법인세, 중소기업 졸업 유예기간 최저한세율(8%·9%), 공제감면 이월, 각 공제감면의 금액 계산.",
      ])}`,
        "corp",
      )
    );
  }
  function localWhCell(r) {
    return `<div class="f cr${r.localWhManual ? " manual" : ""}" data-crbox="corpLocalWh">
      <span class="l">법인지방소득세 원천납부세액</span>
      <span class="in"><input class="won" inputmode="numeric" autocomplete="off" data-p="corp.localWh" data-t="ovmoney" value="${r.localWh ? U.won(r.localWh) : ""}" placeholder="0"><i>원</i></span>
      <small data-crmsg="corpLocalWh">${localWhMsg(r)}</small></div>`;
  }
  const localWhMsg = (r) =>
    r.localWhManual
      ? `직접 입력, 자동 계산 ${U.won(r.localWhAuto)}원 <button class="linkbtn" type="button" data-act="auto" data-p="corp.localWh">자동값으로</button>`
      : "원천납부세액의 10%";

  // 계산 후 자동값 칸과 배제 안내 갱신
  function sync(r) {
    if (typeof document === "undefined") return;
    const box = document.querySelector('[data-crbox="corpLocalWh"]');
    if (box) {
      const input = box.querySelector("input");
      box.classList.toggle("manual", r.localWhManual);
      if (!r.localWhManual && document.activeElement !== input)
        input.value = r.localWh ? U.won(r.localWh) : "";
      box.querySelector("small").innerHTML = localWhMsg(r);
    }
    document
      .querySelectorAll('[data-list="corp.minItems"][data-act="del"]')
      .forEach((b) => {
        const it = r.minItems[+b.dataset.i];
        const note = b.parentElement.querySelector(".warnnote");
        if (note)
          note.textContent =
            it && it.excluded ? `최저한세로 ${U.won(it.excluded)}원 배제` : "";
      });
  }

  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won;
    const rows = [R("과세표준", "", "head")];
    rows.push(R("당기순이익", n(s.netIncome)));
    if (n(s.addIncome)) rows.push(R("(+)익금산입", n(s.addIncome), "in1"));
    if (n(s.deductIncome))
      rows.push(R("(-)손금산입", n(s.deductIncome), "in1"));
    rows.push(R("차가감소득금액", r.B6, "sum"));
    if (n(s.donationExcess))
      rows.push(R("기부금 한도초과액", n(s.donationExcess), "in1"));
    if (n(s.donationCarry))
      rows.push(R("기부금 이월액 손금산입", n(s.donationCarry), "in1"));
    rows.push(R("각 사업연도 소득금액", r.B9, "sum"));
    if (r.loss)
      rows.push(
        R(
          "이월결손금",
          r.loss,
          "in1",
          r.loss < n(s.loss) ? `한도 ${won(r.lossLimit)} 적용` : "",
        ),
      );
    rows.push(R("과세표준", r.base, "sum"));
    rows.push(R("법인세", "", "head"));
    rows.push(
      R(
        "산출세액",
        r.tax,
        "",
        `세율 ${U.pct(r.rate)}${r.months < 12 ? `, ${r.months}개월 연환산` : ""}${r.small ? ", 소규모 법인" : ""}`,
      ),
    );
    if (s.applyMin !== false)
      rows.push(
        R(
          "최저한세",
          r.minTax,
          "in1",
          `${r.corType === "sme" ? "중소기업 7%" : r.corType === "defer_1_3" ? "유예기간 경과 1~3년차 8%" : r.corType === "defer_4_5" ? "유예기간 경과 4~5년차 9%" : "일반기업 10~17%"}${r.cut ? `, 공제감면 ${won(r.cut)} 배제` : ", 배제 없음"}`,
        ),
      );
    [...r.minItems, ...r.otherItems].forEach((it) => {
      if (it.applied || it.amount)
        rows.push(
          R(
            U.esc(it.name),
            it.applied,
            "in1",
            [
              it.foreign && r.foreignLimit != null
                ? `한도 ${won(r.foreignLimit)}`
                : "",
              it.excluded ? `${won(it.excluded)} 배제` : "",
              it.agri ? "농특세 과세" : "",
            ]
              .filter(Boolean)
              .join(", "),
          ),
        );
    });
    if (r.penalty) rows.push(R("가산세", r.penalty, "in1"));
    rows.push(R("가감계", r.subtotal, "sum"));
    if (n(s.prepaid)) rows.push(R("중간예납세액", n(s.prepaid), "in1"));
    if (n(s.withheld)) rows.push(R("원천납부세액", n(s.withheld), "in1"));
    if (n(s.addPay)) rows.push(R("감면분 추가납부세액", n(s.addPay), "in1"));
    rows.push(R("차감납부할세액", r.net, "sum" + (r.net < 0 ? " neg" : "")));
    rows.push(R("법인지방소득세", "", "head"));
    rows.push(R("법인세 과세표준", r.base));
    rows.push(R("(-)외국납부세액", r.foreignTax, "in1"));
    rows.push(R("과세표준", r.localBase, "sum"));
    rows.push(R("산출세액", r.localTax, ""));
    if (r.localWh) rows.push(R("원천납부세액", r.localWh, "in1"));
    rows.push(
      R("차감납부세액", r.localNet, "sum" + (r.localNet < 0 ? " neg" : "")),
    );
    rows.push(R("농어촌특별세", "", "head"));
    rows.push(
      R(
        "과세표준",
        r.agriBase,
        "",
        r.agriItems.map((it) => U.esc(it.name)).join(", ") ||
          "농특세 과세 항목 없음",
      ),
    );
    rows.push(R("납부세액 (20%)", r.agriTax, "sum"));
    const msgs = [];
    if (r.cut)
      msgs.push(
        `최저한세 때문에 공제감면 ${won(r.cut)}원이 배제되었다. 배제분은 이월공제 대상인지 확인한다.`,
      );
    if (n(s.loss) > r.loss)
      msgs.push(
        `이월결손금은 소득의 ${r.sme ? "100" : "80"}%까지만 공제되어 ${won(n(s.loss) - r.loss)}원이 남는다.`,
      );
    return {
      html: UI.sheet({
        title: "법인세 계산서",
        cap: "법인세 + 법인지방소득세 + 농어촌특별세",
        rows,
        totalLabel: "총납부세액",
        total: r.total,
        msgs,
      }),
      label: "총납부세액",
      total: r.total,
      result: r,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.corp = {
    calc,
    example,
    blank,
    form,
    sheet,
    sync,
    newItem: (i, list) => newRow("", list === "corp.minItems"),
  };
})((globalThis.TAX = globalThis.TAX || {}));
