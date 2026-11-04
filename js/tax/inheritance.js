/* 상속세 (엑셀 「상속세」 시트, 3가지 경우 비교) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui;
  const { fl, pos, n } = U;
  const K = {
    own: [
      ["realEstate", "부동산 (건물·주택)"],
      ["land", "토지"],
      ["stock", "주식"],
      ["car", "차량"],
      ["deposit", "예금·적금"],
      ["membership", "골프·콘도 회원권"],
      ["cash", "현금"],
      ["bizAsset", "사업용 자산"],
      ["otherAsset", "기타 자산"],
      ["etcAsset", "기타"],
    ],
    deemed: [
      ["insurance", "보험금"],
      ["retirement", "퇴직금"],
      ["trust", "신탁재산"],
      ["presumed", "추정상속재산"],
    ],
    gift: [
      ["giftSpouse", "배우자"],
      ["giftChild", "자녀"],
      ["giftOther", "상속인 외"],
    ],
    nontax: [
      ["forest", "금양임야 등"],
      ["heritage", "문화재"],
      ["nontaxEtc", "기타 비과세"],
    ],
    excluded: [
      ["publicDonation", "공익목적 출연"],
      ["publicTrust", "공익신탁"],
      ["excludedEtc", "기타 불산입"],
    ],
    debts: [
      ["publicCharge", "공과금"],
      ["funeral", "장례비"],
      ["finDebt", "금융채무"],
      ["deposit2", "전세보증금"],
      ["debtEtc", "기타 채무"],
    ],
  };
  const keys = (list) => list.map((x) => x[0]);
  let pick = 0; // 계산서에 펼칠 경우 번호

  /* ── 계산 ── */
  function calc(st) {
    const t = TAX.tables.INHERIT;
    const own = U.sum(st, keys(K.own));
    const deemed = U.sum(st, keys(K.deemed));
    const estate = own + deemed; // 상속재산 소계
    const giftAdd = U.sum(st, keys(K.gift));
    const gross = estate + giftAdd; // 총상속재산
    const nontax = U.sum(st, keys(K.nontax));
    const excluded = U.sum(st, keys(K.excluded));

    //const debts = U.sum(st, keys(K.debts));
    const funeralInput = n(st.funeral);
    const funeral = Math.min(Math.max(5e6, funeralInput), t.funeralCap); // 장례비 5백만~15백만원 범위로 조정
    const debts = U.sum(st, keys(K.debts)) - funeralInput + funeral; // 장례비조정

    const taxBase = pos(gross - nontax - excluded - debts); // 상속세 과세가액
    const children = Math.max(0, Math.floor(n(st.children)));
    const spouseAlive = st.spouse !== false;
    // 배우자 법정상속분 (엑셀: 배우자 1.5 : 자녀 1)
    const legalShare = spouseAlive
      ? fl(
          ((estate +
            n(st.giftSpouse) +
            n(st.giftChild) -
            debts +
            n(st.funeral)) *
            t.spouseShare) /
            (t.spouseShare + children * t.childShare),
        )
      : 0;
    // 금융재산 상속공제
    const F = t.finance;
    const finNet =
      n(st.deposit) +
      n(st.insurance) +
      (st.stockAsFin ? n(st.stock) : 0) -
      n(st.finDebt);
    const finDed =
      finNet <= 0
        ? 0
        : finNet <= F.full
          ? finNet
          : finNet <= F.flatUpTo
            ? F.flat
            : Math.min(fl(finNet * F.rate), F.cap);
    const cohab = Math.min(n(st.cohab), t.cohabCap);
    const appr = Math.min(n(st.appraisalDed), t.appraisalCap);
    const etcDed = n(st.etcDed);
    const limit = pos(
      taxBase - n(st.bequestOther) - n(st.renounced) - n(st.giftAddBase),
    ); // 상속공제 종합한도
    const scenarios = (st.spouseActual || [0, 0, 0]).map((actual) => {
      actual = n(actual);
      const spouseDed = !spouseAlive
        ? 0
        : actual < t.spouseMin
          ? t.spouseMin
          : Math.max(t.spouseMin, Math.min(actual, legalShare, t.spouseMax));
      const dedSum = t.lump + spouseDed + finDed + cohab + appr + etcDed;
      const ded = Math.min(dedSum, taxBase, limit);
      const taxable = pos(taxBase - ded);
      const tooSmall = taxable < t.minTaxable;
      const tax = tooSmall
        ? 0
        : U.progressive(taxable, TAX.tables.GIFT_INHERIT);
      const pre = n(st.paidGiftTax),
        shortRe = n(st.shortReinherit);
      const report = pos(fl((tax - pre - shortRe) * t.reportCredit));
      return {
        actual,
        spouseDed,
        lump: t.lump,
        dedSum,
        ded,
        taxable,
        tooSmall,
        rate: tooSmall ? 0 : U.rateOf(taxable, TAX.tables.GIFT_INHERIT),
        tax,
        pre,
        shortRe,
        report,
        decided: pos(tax - pre - shortRe - report),
      };
    });
    return {
      own,
      deemed,
      estate,
      giftAdd,
      gross,
      nontax,
      excluded,
      debts,
      taxBase,
      children,
      spouseAlive,
      legalShare,
      finNet,
      finDed,
      cohab,
      etcDed,
      appr,
      limit,
      scenarios,
      funeral,
      funeralInput,
      deadline: U.isDate(st.deathDate)
        ? U.monthEnd(st.deathDate, t.reportMonths)
        : null,
    };
  }

  // 계산 후 갱신이 필요한 값
  function sync(r) {
    if (typeof document === "undefined") return;
    //장례비공제설명 5백만~15백만원 범위내 값으로 변경
    const kr = document.querySelector(`[data-kr="inheritance.funeral"]`);
    if (kr)
      kr.textContent =
        r.funeral !== r.funeralInput
          ? `${U.korWon(r.funeral)} 적용 (500만~1,500만원 한도)`
          : U.korWon(r.funeral);
  }

  /* ── 예시값 (엑셀) ── */
  const example = () => {
    const e = {
      deathDate: "",
      spouse: true,
      children: 2,
      stockAsFin: false,
      cohab: 0,
      appraisalDed: 0,
      bequestOther: 0,
      renounced: 0,
      giftAddBase: 0,
      paidGiftTax: 0,
      shortReinherit: 0,
      spouseActual: [0, 0, 0],
    };
    Object.values(K).forEach((list) =>
      list.forEach(([k]) => {
        e[k] = 0;
      }),
    );
    e.funeral = 5000000;
    return e;
  };
  const blank = () => Object.assign(example(), { funeral: 0, children: 0 });

  /* ── 화면 ── */
  const moneys = (list, prefix = "inheritance.") =>
    list
      .map(([k, l]) =>
        UI.money(
          prefix + k,
          l,
          k === "funeral" ? "500만~1,000만원, 봉안 500만원 별도" : "",
        ),
      )
      .join("");

  function form(s) {
    return (
      UI.intro(
        "inheritance",
        "상속세",
        "상속재산과 공제 항목을 넣고, 배우자가 실제로 받을 몫을 세 가지 경우로 나눠 세액을 비교한다.",
      ) +
      UI.layout(
        `
      ${UI.group(
        "상속인",
        UI.date(
          "inheritance.deathDate",
          "상속개시일 (사망일)",
          "신고기한 계산용",
        ) +
          UI.sel(
            "inheritance.spouse",
            "배우자",
            [
              ["true", "있음"],
              ["false", "없음"],
            ],
            true,
          ) +
          UI.count("inheritance.children", "자녀 수"),
      )}
      ${UI.group("본래 상속재산", moneys(K.own))}
      ${UI.group2("간주·추정 상속재산", moneys(K.deemed))}
      ${UI.group2("사전증여재산 가산 (상속인 10년 내, 그외 5년 내 수증)", moneys(K.gift))}
      ${UI.group2("비과세·과세가액 불산입", moneys(K.nontax) + moneys(K.excluded))}
      ${UI.group("채무·공과금·장례비", moneys(K.debts))}
      ${UI.group(
        "상속공제",
        UI.chk(
          "inheritance.stockAsFin",
          "주식을 금융재산공제에 포함 (최대주주 보유분 제외)",
        ) +
          UI.money("inheritance.cohab", "동거주택 상속공제 (6억 한도)") +
          UI.money(
            "inheritance.appraisalDed",
            "감정평가수수료 공제 (500만 한도)",
          ) +
          UI.money("inheritance.etcDed", "기타 상속공제") +
          UI.money(
            "inheritance.bequestOther",
            "상속인 외 유증·사인증여 (한도 차감)",
          ) +
          UI.money(
            "inheritance.renounced",
            "상속포기로 다음 순위가 받은 재산 (한도 차감)",
          ) +
          UI.money(
            "inheritance.giftAddBase",
            "가산한 증여재산 과세표준 (한도 차감)",
          ),
        '<p class="note">일괄공제 5억원은 자동으로 들어간다. 금융재산공제는 예금·적금과 보험금에서 금융채무를 빼서 계산한다.</p>',
      )}
      ${
        s.spouse
          ? UI.group(
              "배우자 실제 상속분 비교",
              UI.money("inheritance.spouseActual.0", "경우 1") +
                UI.money("inheritance.spouseActual.1", "경우 2") +
                UI.money("inheritance.spouseActual.2", "경우 3"),
              '<p class="note">배우자공제는 실제 상속분이 5억원 미만이면 5억원, 그 이상이면 법정상속분과 30억원 한도 안에서 실제 상속분이다.</p>',
            )
          : ""
      }
      ${UI.group("세액공제", UI.money("inheritance.paidGiftTax", "기납부 증여세액") + UI.money("inheritance.shortReinherit", "단기재상속 세액공제"))}
      ${UI.basis([
        "총상속재산 → 과세가액 → 상속공제 → 과세표준 → 세액공제 순서. 세율은 10%~50% 5단계, 신고세액공제는 3%다.",
        "배우자공제 최저 5억원을 실제 상속분이 5억원 이상이고 법정상속분이 5억원 미만인 경우에도 보장한다.",
        "상속공제 합계는 과세가액과 공제한도 중 작은 금액을 넘지 못하며, 세 경우 모두에 같이 적용한다.",
        "2026년 세제개편안의 공제 확대와 유산취득세 전환은 국회를 통과하지 않아 반영하지 않았다.",
        "반영하지 않은 것: 기초·인적공제 선택(일괄공제 5억원 고정), 배우자 단독상속, 직계존속 법정지분, 가업·영농 상속공제, 세대생략 할증, 재산 평가.",
      ])}`,
        "inheritance",
      )
    );
  }

  // 상속세 계산서
  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won;

    if (pick >= r.scenarios.length) pick = 0;
    const sc = r.scenarios[pick];
    const pre = r.spouseAlive
      ? `<div class="chips" role="group" aria-label="비교 경우">${r.scenarios
          .map(
            (x, i) =>
              `<button type="button" data-act="pick" data-i="${i}" aria-pressed="${i === pick}">경우 ${i + 1}<b>${won(x.decided)}</b></button>`,
          )
          .join("")}</div>`
      : "";
    const rows = [
      R("총상속재산", r.gross, "sum"),
      R("본래 상속재산", r.own, "in1"),
      R("간주·추정 상속재산", r.deemed, "in1"),
      R("증여재산 가산", r.giftAdd, "in1"),
    ];
    if (r.nontax) rows.push(R("(-)비과세", r.nontax, "in1"));
    if (r.excluded) rows.push(R("(-)과세가액 불산입", r.excluded, "in1"));
    rows.push(R("(-)채무·공과금·장례비", r.debts, "in1"));
    rows.push(R("상속세 과세가액", r.taxBase, "sum"));
    rows.push(R("상속공제", "", "head"));
    rows.push(R("일괄공제", sc.lump, "in1"));
    if (r.spouseAlive)
      rows.push(
        R(
          "배우자 상속공제",
          sc.spouseDed,
          "in1",
          `실제 상속분 ${won(sc.actual)}, 법정상속분 ${won(r.legalShare)}`,
        ),
      );
    if (r.finDed)
      rows.push(
        R("금융재산 상속공제", r.finDed, "in1", `순금융재산 ${won(r.finNet)}`),
      );
    if (r.cohab) rows.push(R("동거주택 상속공제", r.cohab, "in1"));
    if (r.appr) rows.push(R("감정평가수수료", r.appr, "in1"));
    if (r.etcDed) rows.push(R("기타 상속공제", r.etcDed, "in1"));
    rows.push(
      R(
        "상속공제 적용액",
        sc.ded,
        "sum",
        sc.ded < sc.dedSum
          ? `공제 합계 ${won(sc.dedSum)} 중 한도 ${won(Math.min(r.taxBase, r.limit))}`
          : "",
      ),
    );
    rows.push(R("과세표준", sc.taxable, "sum"));
    rows.push(
      R(
        "산출세액",
        sc.tax,
        "",
        sc.tooSmall ? "과세표준 50만원 미만" : `세율 ${U.pct(sc.rate)}`,
      ),
    );
    if (sc.pre) rows.push(R("기납부 증여세액", sc.pre, "in1"));
    if (sc.shortRe) rows.push(R("단기재상속 세액공제", sc.shortRe, "in1"));
    if (sc.report) rows.push(R("신고세액공제 (3%)", sc.report, "in1"));
    if (r.deadline)
      rows.push(
        R(
          "신고기한",
          U.fmtDate(r.deadline),
          "in1",
          "상속개시일이 속한 달 말일부터 6개월",
        ),
      );
    const msgs = [];
    if (!r.gross)
      msgs.push(
        "상속재산을 입력하면 세액이 계산된다. 예시값은 장례비와 자녀 수만 들어 있다.",
      );
    if (r.spouseAlive && r.children === 0)
      msgs.push(
        "자녀가 없으면 법정상속분이 직계존속 유무에 따라 달라지고, 배우자 단독상속이면 일괄공제를 받을 수 없어 실제 세액과 차이가 날 수 있다.",
      );
    return {
      html: UI.sheet({
        title: "상속세 계산서",
        cap: r.spouseAlive ? `경우 ${pick + 1} 상세` : "배우자 없음",
        rows,
        totalLabel: "결정세액",
        total: sc.decided,
        msgs,
        pre,
      }),
      label: `결정세액${r.spouseAlive ? ` (경우 ${pick + 1})` : ""}`,
      total: sc.decided,
      result: r,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.inheritance = {
    calc,
    example,
    blank,
    form,
    sheet,
    setPick: (i) => {
      pick = i;
    },
    resetPick: () => {
      pick = 0;
    },
    sync,
  };
})((globalThis.TAX = globalThis.TAX || {}));
