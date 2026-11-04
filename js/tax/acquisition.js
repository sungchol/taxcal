/* 취득세 (첨부 「취득세율 정리」 기준, 지방세법 제11조·제13조·제13조의2) */
(function (TAX) {
  const U = TAX.util,
    UI = TAX.ui,
    T = () => TAX.tables.ACQ;
  const { pos, n } = U;
  const fl10 = (v) => Math.floor((v + 1e-7) / 10) * 10; // 10원 미만 절사

  const CAUSE = [
    ["buy", "유상취득 (매매·교환)"],
    ["new", "원시취득 (신축·보존등기)"],
    ["inherit", "상속"],
    ["gift", "증여 등 무상취득"],
    ["split", "공유물·합유물·총유물 분할"],
    ["provisional", "가등기"],
  ];
  const KIND = [
    ["house", "주택"],
    ["other", "주택 외 부동산 (토지·건물·상가 등)"],
    ["farm", "농지"],
  ];
  const METRO = [
    ["none", "해당 없음"],
    ["reg3", "설립 5년 미만 법인의 과밀억제권역 내 부동산 취득 (등록세분 3배)"],
    [
      "acq3",
      "과밀억제권역 본점·주사무소 신축·증축, 설립 5년 이상 (취득세분 3배)",
    ],
    ["both", "과밀억제권역 본점·주사무소 신축·증축, 설립 5년 미만 (모두 3배)"],
  ];

  /* ── 세율 판정 ── */
  // 개인 주택 유상취득 중과: 조정대상지역 2주택 8%·3주택 이상 12%, 그 외 지역 3주택 8%·4주택 이상 12%
  function houseHeavy(st) {
    const c = Math.max(1, Math.floor(Number(st.houseCount)) || 1);
    if (st.zone) {
      if (c === 2) return st.temp2 ? null : "heavy8";
      return c >= 3 ? "heavy12" : null;
    }
    if (c === 3) return "heavy8";
    return c >= 4 ? "heavy12" : null;
  }
  // 주택 유상취득 일반세율 (%): 6억~9억 구간은 소수점 다섯째 자리에서 반올림
  function houseRate(base) {
    const h = T().house;
    if (base <= h.low) return h.lowRate;
    if (base > h.high) return h.highRate;
    return Math.round(((base * 2) / 3e8 - 3) * 1e4) / 1e4;
  }

  // 결과: { mode: "house" | "split", acq, reg, rate, label, notes }
  function rule(st) {
    const t = T(),
      base = n(st.base),
      corp = st.owner === "corp",
      house = st.kind === "house",
      farm = st.kind === "farm";
    const notes = [];
    let r = null,
      label = "";
    const pick = (key, text) => {
      r = { ...t[key] };
      label = text;
    };
    switch (st.cause) {
      case "buy":
        if (house) {
          const heavy = corp ? "heavy12" : houseHeavy(st);
          if (heavy)
            pick(
              heavy,
              corp
                ? "법인 주택 취득 중과 12%"
                : `다주택 중과 ${heavy === "heavy8" ? "8%" : "12%"}`,
            );
          else
            return {
              mode: "house",
              rate: houseRate(base),
              label: "주택 유상취득 (1~3%)",
              notes,
            };
        } else if (farm) {
          if (st.selfFarm)
            pick("farmSelf", "농지 유상취득, 2년 이상 자경 1.5%");
          else pick("farmBuy", "농지 유상취득 3%");
        } else pick("general", "주택 외 유상취득 4%");
        break;
      case "new":
        pick("newBuild", "원시취득 2.8%");
        break;
      case "inherit":
        if (farm) pick("inheritFarm", "농지 상속 2.3%");
        else if (house && st.inheritOneHouse)
          pick("inheritOneHouse", "1가구 1주택 상속 특례 0.8%");
        else pick("inherit", "상속 2.8%");
        break;
      case "gift":
        if (house && st.giftZone && st.giftOver3 && !st.giftFamilyOneHouse)
          pick("heavy12", "조정대상지역 3억원 이상 주택 증여 중과 12%");
        else pick("gift", "증여 3.5%");
        break;
      case "split":
        pick("split", "공유물 등 분할 2.3%");
        break;
      case "provisional":
        pick("provisional", "가등기 0.2%");
        notes.push("가등기는 실제로는 등록면허세로 과세된다.");
        break;
      default:
        pick("general", "주택 외 유상취득 4%");
    }
    // 법인 과밀억제권역 중과 (주택은 13조의2 중과가 우선하므로 제외)
    if (
      corp &&
      !house &&
      st.metro &&
      st.metro !== "none" &&
      st.cause !== "provisional"
    ) {
      if (st.metro === "reg3" || st.metro === "both") r.reg *= 3;
      if (st.metro === "acq3" || st.metro === "both") r.acq *= 3;
      label += `, 과밀억제권역 중과 (${st.metro === "reg3" ? "등록세분" : st.metro === "acq3" ? "취득세분" : "취득·등록세분"} 3배)`;
    }
    return {
      mode: "split",
      acq: r.acq,
      reg: r.reg,
      rate: r.acq + r.reg,
      label,
      notes,
    };
  }

  /* ── 계산 ── */
  function calc(st) {
    const t = T(),
      base = n(st.base),
      ru = rule(st);
    const small = st.kind === "house" && !!st.small; // 85㎡ 이하 주택: 농특세 비과세
    let tax, agri, edu;
    if (ru.mode === "house") {
      tax = fl10((base * ru.rate) / 100);
      edu = fl10(tax * t.houseEduRatio);
      agri = small ? 0 : fl10((base * t.houseAgri) / 100);
    } else {
      tax = fl10((base * ru.rate) / 100);
      const agriFree =
        small || (st.cause === "buy" && st.kind === "farm" && st.selfFarm);
      agri = agriFree ? 0 : fl10((base * ru.acq * 0.1) / 100);
      edu = fl10((base * ru.reg * 0.2) / 100);
    }
    const reduction = Math.min(n(st.reduction), tax);
    const acqTax = tax - reduction;
    const total = acqTax + agri + edu;
    // 신고기한
    let deadline = null;
    if (U.isDate(st.date)) {
      if (st.cause === "inherit")
        deadline = U.monthEnd(st.date, t.reportMonths.inherit);
      else if (st.cause === "gift")
        deadline = U.monthEnd(st.date, t.reportMonths.gift);
      else deadline = U.iso(U.toUTC(st.date) + t.reportDays * 86400000);
    }
    return {
      base,
      ...ru,
      small,
      tax,
      reduction,
      acqTax,
      agri,
      edu,
      total,
      effective: base > 0 ? total / base : 0,
      deadline,
    };
  }

  /* ── 예시값 ── */
  const example = () => ({
    owner: "person",
    cause: "buy",
    kind: "house",
    date: U.today(),
    base: 0,
    small: false,
    houseCount: 1,
    zone: false,
    temp2: false,
    selfFarm: false,
    inheritOneHouse: false,
    giftZone: false,
    giftOver3: false,
    giftFamilyOneHouse: false,
    metro: "none",
    reduction: 0,
  });
  const blank = () => Object.assign(example(), { base: 0 });

  /* ── 화면 ── */
  function form(s) {
    const house = s.kind === "house",
      corp = s.owner === "corp";
    const cond = [];
    if (house)
      cond.push(
        UI.chk("acquisition.small", "전용면적 85㎡ 이하 (농특세 비과세)"),
      );
    if (house && s.cause === "buy" && !corp)
      cond.push(
        UI.sel(
          "acquisition.houseCount",
          "취득 후 1세대 주택 수",
          [
            ["1", "1주택"],
            ["2", "2주택"],
            ["3", "3주택"],
            ["4", "4주택 이상"],
          ].map(([k, v]) => [Number(k), v]),
        ) +
          UI.chk("acquisition.zone", "조정대상지역 내 주택", true) +
          (s.zone && Number(s.houseCount) === 2
            ? UI.chk("acquisition.temp2", "일시적 2주택 (중과 제외)")
            : ""),
      );
    if (house && s.cause === "gift")
      cond.push(
        UI.chk("acquisition.giftZone", "조정대상지역 내 주택") +
          UI.chk("acquisition.giftOver3", "시가표준액 3억원 이상") +
          UI.chk(
            "acquisition.giftFamilyOneHouse",
            "1세대 1주택자가 배우자·직계존비속에게 증여",
          ),
      );
    if (house && s.cause === "inherit")
      cond.push(
        UI.chk(
          "acquisition.inheritOneHouse",
          "상속으로 1가구 1주택이 됨 (세율 특례)",
        ),
      );
    if (s.kind === "farm" && s.cause === "buy")
      cond.push(
        UI.chk("acquisition.selfFarm", "2년 이상 자경 농민의 농지 취득"),
      );
    if (corp && !house)
      cond.push(
        `<div class="f wide">${UI.sel("acquisition.metro", "법인 과밀억제권역 중과", METRO)}</div>`,
      );

    return (
      UI.intro(
        "acquisition",
        "취득세",
        "취득자, 취득 원인, 물건 종류를 고르면 상황에 맞는 세율을 찾아 취득세, 농어촌특별세, 지방교육세를 계산한다.",
      ) +
      UI.layout(
        `
      ${UI.group(
        "취득 내용",
        UI.sel(
          "acquisition.owner",
          "취득자",
          [
            ["person", "개인"],
            ["corp", "법인"],
          ],
          true,
        ) +
          UI.sel("acquisition.cause", "취득 원인", CAUSE, true) +
          UI.sel("acquisition.kind", "물건 종류", KIND, true) +
          UI.date(
            "acquisition.date",
            "취득일",
            "잔금일, 상속개시일, 증여계약일 등",
          ) +
          UI.money(
            "acquisition.base",
            "과세표준 (취득가액)",
            s.cause === "inherit"
              ? "상속은 시가표준액"
              : s.cause === "gift"
                ? "증여는 시가인정액"
                : "사실상 취득가격",
          ),
      )}
      ${cond.length ? UI.group("과세 요건", cond.join("")) : ""}
      ${UI.group("감면", UI.money("acquisition.reduction", "취득세 감면세액 (생애최초 등)"), '<p class="note">감면세액은 취득세 본세에서만 뺀다. 감면에 붙는 농어촌특별세는 반영하지 않는다.</p>')}
      ${UI.basis([
        "세율은 종전 취득세분과 등록세분으로 나눠, 농어촌특별세는 취득세분의 10%, 지방교육세는 등록세분의 20%로 계산한다.",
        "주택 유상취득은 6억원 이하 1%, 9억원 초과 3%, 그 사이는 (취득가액 × 2/3억원 − 3)%다. 지방교육세는 취득세의 10%, 농어촌특별세는 과세표준의 0.2%다. 첨부 문서는 6억~9억 구간 교육세를 0.2%로 적었지만 법령대로 세율에 비례해 0.1~0.3%로 계산한다.",
        "다주택 중과는 조정대상지역 2주택 8%(일시적 2주택 제외)·3주택 이상 12%, 그 외 지역 3주택 8%·4주택 이상 12%다. 법인의 주택 취득은 12%다.",
        "증여는 3.5%이고, 조정대상지역 안 시가표준액 3억원 이상 주택은 12%다. 1세대 1주택자가 배우자나 직계존비속에게 증여하면 중과에서 빠진다.",
        "전용면적 85㎡ 이하 주택은 농어촌특별세를 매기지 않는다. 세액은 10원 미만을 버린다.",
        "신고기한은 유상·원시취득이 취득일부터 60일, 증여가 취득일이 속한 달 말일부터 3개월, 상속이 6개월이다.",
        "반영하지 않은 것: 시가표준액 1억원 이하 주택 등 중과 제외 주택, 주택 수 산정, 생애최초·지방 미분양 등 감면액 계산, 차량·회원권 등 부동산 외 과세대상, 사치성 재산 중과.",
      ])}`,
        "acquisition",
      )
    );
  }

  function sheet(s) {
    const r = calc(s),
      R = UI.R,
      won = U.won,
      pct = (v) => `${Math.round(v * 1e4) / 1e4}%`;
    const rows = [R("적용 기준", "", "head"), R(r.label, pct(r.rate))];
    if (r.mode === "split")
      rows.push(
        R(
          "세율 구성",
          "",
          "in1",
          `취득세분 ${pct(r.acq)} + 등록세분 ${pct(r.reg)}`,
        ),
      );
    rows.push(R("과세표준", r.base, "sum"));
    rows.push(R("세액", "", "head"));
    rows.push(R("취득세", r.tax, "", `과세표준 × ${pct(r.rate)}`));
    if (r.reduction) rows.push(R("감면세액", -r.reduction, "in1"));
    if (r.reduction) rows.push(R("납부할 취득세", r.acqTax, "sum"));
    rows.push(
      R(
        "농어촌특별세",
        r.agri,
        "",
        r.agri
          ? r.mode === "house"
            ? "과세표준 × 0.2%"
            : `과세표준 × ${pct(r.acq * 0.1)}`
          : r.small
            ? "85㎡ 이하 비과세"
            : "비과세",
      ),
    );
    rows.push(
      R(
        "지방교육세",
        r.edu,
        "",
        r.mode === "house" ? "취득세 × 10%" : `과세표준 × ${pct(r.reg * 0.2)}`,
      ),
    );
    rows.push(R("실효세율", pct(r.effective * 100), "in1"));
    if (r.deadline) rows.push(R("신고·납부기한", U.fmtDate(r.deadline), "in1"));
    const msgs = [...r.notes];
    if (
      s.cause === "buy" &&
      s.kind === "house" &&
      s.owner !== "corp" &&
      s.zone &&
      Number(s.houseCount) === 2 &&
      s.temp2
    )
      msgs.push(
        "일시적 2주택은 종전 주택을 기한 안에 처분하지 않으면 중과세율과의 차액이 추징된다.",
      );
    return {
      html: UI.sheet({
        title: "취득세 계산서",
        cap: "취득세 + 농어촌특별세 + 지방교육세",
        rows,
        totalLabel: "총납부세액",
        total: r.total,
        msgs,
      }),
      label: "총납부세액",
      total: r.total,
    };
  }

  TAX.views = TAX.views || {};
  TAX.views.acquisition = { calc, example, blank, form, sheet, rule };
})((globalThis.TAX = globalThis.TAX || {}));
